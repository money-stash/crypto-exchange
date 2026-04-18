"""Python port of OperatorDebtService.js"""
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import tron_service

logger = logging.getLogger(__name__)

USDT_COMPARE_TOLERANCE = 0.0001
REQUIRED_CONFIRMATIONS = 10
INTENT_TTL_MINUTES = int(os.getenv("USDT_INTENT_TTL_MINUTES", "20"))


def _round_usdt(value) -> float:
    return round(float(value or 0), 4)


def _round_rub(value) -> float:
    return round(float(value or 0), 2)


def _normalize_address(address: str) -> str:
    return str(address or "").strip().lower()


def _build_qr_payload(wallet: str, exact_usdt: float) -> str:
    amount = _round_usdt(exact_usdt)
    return f"tron:{wallet}?amount={amount}&token=USDT"


def _build_qr_url(payload: str) -> str:
    from urllib.parse import quote
    return f"https://api.qrserver.com/v1/create-qr-code/?size=240x240&data={quote(payload)}"


def _build_intent_response(row: dict) -> Optional[dict]:
    if not row:
        return None
    exact_usdt = float(row.get("exact_usdt") or 0)
    wallet = str(row.get("company_wallet") or "").strip()
    qr_payload = _build_qr_payload(wallet, exact_usdt)
    return {
        **row,
        "requested_usdt": float(row.get("requested_usdt") or 0),
        "exact_usdt": exact_usdt,
        "qr_payload": qr_payload,
        "qr_url": _build_qr_url(qr_payload),
    }


async def get_company_wallet(db: AsyncSession) -> str:
    row = await db.execute(
        text("SELECT `value` FROM system_settings WHERE `key` = 'company_usdt_wallet_trc20' LIMIT 1")
    )
    result = row.fetchone()
    return str(result[0] or "").strip() if result else ""


async def expire_intents_for_support(db: AsyncSession, support_id: int) -> None:
    await db.execute(
        text("""
            UPDATE operator_usdt_payment_intents
               SET status = 'EXPIRED'
             WHERE support_id = :sid
               AND status = 'OPEN'
               AND expires_at < NOW()
        """),
        {"sid": support_id},
    )


async def expire_all_open_intents(db: AsyncSession) -> None:
    await db.execute(
        text("""
            UPDATE operator_usdt_payment_intents
               SET status = 'EXPIRED'
             WHERE status = 'OPEN'
               AND expires_at < NOW()
        """)
    )


async def get_aggregate_debt(db: AsyncSession, support_id: int) -> dict:
    row = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(d.usdt_due), 0)              AS usdt_due_total,
                COALESCE(SUM(d.usdt_paid), 0)             AS usdt_paid_total,
                COALESCE(SUM(d.usdt_due - d.usdt_paid), 0) AS usdt_open_total,
                COALESCE(SUM(d.sum_rub_locked), 0)        AS rub_locked_total,
                COALESCE(SUM(d.rub_released), 0)          AS rub_released_total,
                COALESCE(SUM(d.sum_rub_locked - d.rub_released), 0) AS rub_open_total
            FROM operator_usdt_debts d
            LEFT JOIN orders o ON o.id = d.order_id
            WHERE d.support_id = :sid
              AND d.status IN ('OPEN', 'PARTIALLY_PAID')
              AND (o.id IS NULL OR o.status <> 'CANCELLED')
        """),
        {"sid": support_id},
    )
    totals = dict(row.mappings().one())
    wallet = await get_company_wallet(db)
    return {
        "support_id": support_id,
        "company_wallet": wallet,
        "usdt_due_total": float(totals.get("usdt_due_total") or 0),
        "usdt_paid_total": float(totals.get("usdt_paid_total") or 0),
        "usdt_open_total": float(totals.get("usdt_open_total") or 0),
        "rub_locked_total": float(totals.get("rub_locked_total") or 0),
        "rub_released_total": float(totals.get("rub_released_total") or 0),
        "rub_open_total": float(totals.get("rub_open_total") or 0),
    }


async def create_payment_intent(db: AsyncSession, support_id: int, requested_usdt: float) -> dict:
    await expire_intents_for_support(db, support_id)

    aggregate = await get_aggregate_debt(db, support_id)
    max_payable = float(aggregate.get("usdt_open_total") or 0)

    if max_payable <= 0:
        raise ValueError("No open USDT debt")

    requested = float(requested_usdt)
    if not (requested > 0):
        raise ValueError("requested_usdt must be positive")

    base = _round_usdt(min(requested, max_payable))
    if base <= 0:
        raise ValueError("Requested amount is too small")

    wallet = aggregate.get("company_wallet", "")
    if not wallet:
        raise ValueError("Company USDT wallet is not configured")

    expires_at = datetime.utcnow() + timedelta(minutes=INTENT_TTL_MINUTES)
    result = await db.execute(
        text("""
            INSERT INTO operator_usdt_payment_intents
              (support_id, requested_usdt, exact_usdt, company_wallet, status, expires_at, created_at)
            VALUES (:sid, :req, :req, :wallet, 'OPEN', :exp, NOW())
        """),
        {"sid": support_id, "req": requested, "wallet": wallet, "exp": expires_at},
    )
    intent_id = result.lastrowid

    unique_tail = ((intent_id % 900) + 100) / 10000
    exact = _round_usdt(base - unique_tail)
    if exact <= 0 or exact > max_payable:
        micro = ((intent_id % 9) + 1) / 10000
        exact = _round_usdt(min(max_payable, base + micro))
    if exact <= 0:
        raise ValueError("Unable to generate exact USDT amount for intent")

    await db.execute(
        text("UPDATE operator_usdt_payment_intents SET exact_usdt = :exact WHERE id = :id"),
        {"exact": exact, "id": intent_id},
    )
    await db.commit()

    row = await db.execute(
        text("SELECT * FROM operator_usdt_payment_intents WHERE id = :id LIMIT 1"),
        {"id": intent_id},
    )
    intent_row = dict(row.mappings().one())
    return _build_intent_response(intent_row)


async def get_intent_with_payment(db: AsyncSession, support_id: int, intent_id: int) -> dict:
    row = await db.execute(
        text("""
            SELECT i.*,
                   p.id              AS payment_id,
                   p.tx_hash         AS payment_tx_hash,
                   p.status          AS payment_status,
                   p.confirmations   AS payment_confirmations,
                   p.actual_amount_usdt AS payment_actual_amount_usdt,
                   p.reject_reason   AS payment_reject_reason,
                   p.created_at      AS payment_created_at,
                   p.confirmed_at    AS payment_confirmed_at
              FROM operator_usdt_payment_intents i
              LEFT JOIN operator_usdt_payments p ON p.intent_id = i.id
             WHERE i.id = :iid
               AND i.support_id = :sid
             ORDER BY p.created_at DESC
             LIMIT 1
        """),
        {"iid": intent_id, "sid": support_id},
    )
    row_data = row.fetchone()
    if not row_data:
        return {"intent": None, "payment": None}

    r = dict(row_data._mapping)
    intent = _build_intent_response({
        "id": r["id"],
        "support_id": r["support_id"],
        "requested_usdt": r["requested_usdt"],
        "exact_usdt": r["exact_usdt"],
        "company_wallet": r["company_wallet"],
        "status": r["status"],
        "expires_at": r["expires_at"],
        "created_at": r["created_at"],
        "consumed_at": r.get("consumed_at"),
    })

    payment = None
    if r.get("payment_id"):
        actual = r.get("payment_actual_amount_usdt")
        payment = {
            "id": r["payment_id"],
            "tx_hash": r["payment_tx_hash"],
            "status": r["payment_status"],
            "confirmations": int(r.get("payment_confirmations") or 0),
            "actual_amount_usdt": float(actual) if actual is not None else None,
            "reject_reason": r.get("payment_reject_reason"),
            "created_at": r.get("payment_created_at"),
            "confirmed_at": r.get("payment_confirmed_at"),
        }

    return {"intent": intent, "payment": payment}


async def _find_matching_transfer(intent: dict) -> Optional[dict]:
    expected_amount = float(intent.get("exact_usdt") or 0)
    wallet = str(intent.get("company_wallet") or "").strip()
    if not expected_amount or not wallet:
        return None

    created_at = intent.get("created_at")
    expires_at = intent.get("expires_at")
    since_ms = 0
    expires_ms = None
    created_ms = None

    if created_at:
        try:
            created_ms = int(created_at.timestamp() * 1000) if hasattr(created_at, "timestamp") else int(datetime.fromisoformat(str(created_at)).timestamp() * 1000)
            since_ms = max(0, created_ms - 5 * 60 * 1000)
        except Exception:
            pass
    if expires_at:
        try:
            expires_ms = int(expires_at.timestamp() * 1000) if hasattr(expires_at, "timestamp") else int(datetime.fromisoformat(str(expires_at)).timestamp() * 1000)
        except Exception:
            pass

    transfers = await tron_service.list_recent_usdt_transfers(wallet, since_ms=since_ms, limit=300)
    normalized_wallet = _normalize_address(wallet)

    candidates = []
    for tx in transfers:
        if abs(float(tx.get("amountUsdt") or 0) - expected_amount) > USDT_COMPARE_TOLERANCE:
            continue
        if normalized_wallet and _normalize_address(tx.get("toAddress") or "") != normalized_wallet:
            continue
        ts = tx.get("timestampMs")
        if created_ms and ts and ts < created_ms:
            continue
        if expires_ms and ts and ts > expires_ms:
            continue
        candidates.append(tx)

    candidates.sort(key=lambda t: t.get("timestampMs") or 0)
    return candidates[0] if candidates else None


async def _try_auto_match_intent(db: AsyncSession, support_id: int, intent_id: int) -> dict:
    result = await get_intent_with_payment(db, support_id, intent_id)
    intent = result.get("intent")
    payment = result.get("payment")

    if not intent:
        raise ValueError("Payment intent not found")
    if payment:
        return result

    if str(intent.get("status") or "").upper() != "OPEN":
        return result

    expires_at = intent.get("expires_at")
    if expires_at:
        try:
            exp_ts = expires_at.timestamp() if hasattr(expires_at, "timestamp") else datetime.fromisoformat(str(expires_at)).timestamp()
            if exp_ts < datetime.utcnow().timestamp():
                await db.execute(
                    text("UPDATE operator_usdt_payment_intents SET status='EXPIRED' WHERE id=:id AND status='OPEN'"),
                    {"id": intent_id},
                )
                await db.commit()
                return await get_intent_with_payment(db, support_id, intent_id)
        except Exception:
            pass

    try:
        tx = await _find_matching_transfer(intent)
    except Exception as e:
        logger.warning(f"[DEBT] Intent {intent_id} transfer scan failed: {e}")
        return result

    if not tx or not tx.get("txHash"):
        return result

    try:
        await _validate_and_create_payment(db, support_id, intent_id, tx["txHash"], float(intent.get("requested_usdt") or 0))
    except Exception as e:
        if "Duplicate entry" not in str(e) and "UNIQUE" not in str(e).upper():
            raise

    return await get_intent_with_payment(db, support_id, intent_id)


async def get_intent_status(db: AsyncSession, support_id: int, intent_id: int) -> dict:
    await expire_intents_for_support(db, support_id)
    return await _try_auto_match_intent(db, support_id, intent_id)


async def _validate_and_create_payment(
    db: AsyncSession, support_id: int, intent_id: int, tx_hash: str, declared_amount_usdt: float = None
) -> dict:
    await expire_intents_for_support(db, support_id)

    row = await db.execute(
        text("SELECT * FROM operator_usdt_payment_intents WHERE id=:id AND support_id=:sid LIMIT 1"),
        {"id": intent_id, "sid": support_id},
    )
    intent_row = row.fetchone()
    if not intent_row:
        raise ValueError("Payment intent not found")
    intent = dict(intent_row._mapping)

    if str(intent.get("status") or "").upper() != "OPEN":
        raise ValueError("Payment intent is not active")

    expires_at = intent.get("expires_at")
    if expires_at:
        try:
            exp_ts = expires_at.timestamp() if hasattr(expires_at, "timestamp") else datetime.fromisoformat(str(expires_at)).timestamp()
            if exp_ts < datetime.utcnow().timestamp():
                await db.execute(
                    text("UPDATE operator_usdt_payment_intents SET status='EXPIRED' WHERE id=:id"),
                    {"id": intent_id},
                )
                await db.commit()
                raise ValueError("Payment intent has expired")
        except ValueError:
            raise
        except Exception:
            pass

    clean_hash = str(tx_hash or "").strip()
    if not clean_hash:
        raise ValueError("tx_hash is required")

    tx = None
    reject_reason = None
    try:
        tx = await tron_service.inspect_usdt_transfer(clean_hash)
    except Exception as e:
        reject_reason = f"inspect_failed:{e}"

    if tx and not reject_reason:
        expected_address = _normalize_address(str(intent.get("company_wallet") or ""))
        if not expected_address or _normalize_address(tx.get("toAddress") or "") != expected_address:
            reject_reason = "recipient_mismatch"

    if tx and not reject_reason:
        expected_amount = float(intent.get("exact_usdt") or 0)
        if abs(float(tx.get("amountUsdt") or 0) - expected_amount) > USDT_COMPARE_TOLERANCE:
            reject_reason = "amount_mismatch"

    if reject_reason:
        status = "REJECTED"
    elif tx and int(tx.get("confirmations") or 0) >= REQUIRED_CONFIRMATIONS:
        status = "CONFIRMED"
    else:
        status = "PENDING"

    confirmed_at = datetime.utcnow() if status == "CONFIRMED" else None

    ins = await db.execute(
        text("""
            INSERT INTO operator_usdt_payments
              (support_id, intent_id, tx_hash, declared_amount_usdt, actual_amount_usdt,
               confirmations, to_address, from_address, status, reject_reason, network, created_at, confirmed_at)
            VALUES (:sid, :iid, :txhash, :decl, :actual, :conf, :to_addr, :from_addr,
                    :status, :reason, 'TRC20', NOW(), :confirmed_at)
        """),
        {
            "sid": support_id,
            "iid": intent_id,
            "txhash": clean_hash,
            "decl": declared_amount_usdt,
            "actual": _round_usdt(tx["amountUsdt"]) if tx else None,
            "conf": int(tx.get("confirmations") or 0) if tx else 0,
            "to_addr": tx.get("toAddress") if tx else None,
            "from_addr": tx.get("fromAddress") if tx else None,
            "status": status,
            "reason": reject_reason,
            "confirmed_at": confirmed_at,
        },
    )
    payment_id = ins.lastrowid

    if status != "REJECTED":
        await db.execute(
            text("UPDATE operator_usdt_payment_intents SET status='CONSUMED', consumed_at=NOW() WHERE id=:id"),
            {"id": intent_id},
        )

    if status == "CONFIRMED":
        await _allocate_confirmed_payment(db, payment_id)

    await db.commit()

    row2 = await db.execute(text("SELECT * FROM operator_usdt_payments WHERE id=:id LIMIT 1"), {"id": payment_id})
    return dict(row2.mappings().one())


async def _allocate_confirmed_payment(db: AsyncSession, payment_id: int) -> bool:
    row = await db.execute(text("SELECT * FROM operator_usdt_payments WHERE id=:id LIMIT 1"), {"id": payment_id})
    payment_row = row.fetchone()
    if not payment_row:
        return False
    payment = dict(payment_row._mapping)

    remaining = _round_usdt(float(payment.get("actual_amount_usdt") or 0))
    if remaining <= 0:
        return False

    debt_rows = await db.execute(
        text("""
            SELECT d.*
              FROM operator_usdt_debts d
              LEFT JOIN orders o ON o.id = d.order_id
             WHERE d.support_id = :sid
               AND d.status IN ('OPEN', 'PARTIALLY_PAID')
               AND (o.id IS NULL OR o.status <> 'CANCELLED')
             ORDER BY d.created_at ASC, d.id ASC
        """),
        {"sid": payment["support_id"]},
    )
    debts = [dict(r._mapping) for r in debt_rows]

    for debt in debts:
        if remaining <= 0:
            break
        usdt_due = float(debt.get("usdt_due") or 0)
        usdt_paid = float(debt.get("usdt_paid") or 0)
        debt_remaining = usdt_due - usdt_paid
        if debt_remaining <= 0:
            continue

        applied = min(remaining, debt_remaining)
        sum_rub_locked = float(debt.get("sum_rub_locked") or 0)
        rub_released = float(debt.get("rub_released") or 0)
        rub_remaining = max(0.0, sum_rub_locked - rub_released)

        delta_rub = _round_rub((sum_rub_locked * applied) / usdt_due) if usdt_due > 0 else 0
        if applied + USDT_COMPARE_TOLERANCE >= debt_remaining:
            delta_rub = _round_rub(rub_remaining)
        else:
            delta_rub = min(_round_rub(rub_remaining), delta_rub)

        new_usdt_paid = _round_usdt(usdt_paid + applied)
        new_rub_released = _round_rub(rub_released + delta_rub)

        if new_usdt_paid + USDT_COMPARE_TOLERANCE >= usdt_due:
            new_status = "PAID"
        elif new_usdt_paid <= 0:
            new_status = "OPEN"
        else:
            new_status = "PARTIALLY_PAID"

        await db.execute(
            text("""
                UPDATE operator_usdt_debts
                   SET usdt_paid = :up, rub_released = :rr, status = :st, updated_at = NOW()
                 WHERE id = :id
            """),
            {"up": new_usdt_paid, "rr": new_rub_released, "st": new_status, "id": debt["id"]},
        )
        await db.execute(
            text("""
                INSERT INTO operator_usdt_payment_allocations
                  (payment_id, debt_id, usdt_applied, rub_released, created_at)
                VALUES (:pid, :did, :usdt, :rub, NOW())
            """),
            {"pid": payment_id, "did": debt["id"], "usdt": _round_usdt(applied), "rub": _round_rub(delta_rub)},
        )
        remaining = _round_usdt(remaining - applied)

    return True


async def get_payments_history(db: AsyncSession, support_id: Optional[int] = None, limit: int = 500) -> list[dict]:
    await expire_all_open_intents(db)
    safe_limit = max(1, min(limit, 500))

    if support_id:
        where_p = "WHERE p.support_id = :sid"
        where_i_extra = "AND i.support_id = :sid"
        params: dict = {"sid": support_id}
    else:
        where_p = ""
        where_i_extra = ""
        params = {}

    params["lim"] = safe_limit

    payments = await db.execute(
        text(f"""
            SELECT
                'PAYMENT' AS history_type,
                p.id AS history_id,
                p.support_id,
                s.login AS support_login,
                NULL AS support_name,
                p.intent_id,
                i.requested_usdt,
                i.exact_usdt,
                i.company_wallet,
                i.expires_at,
                i.status AS intent_status,
                p.tx_hash,
                p.declared_amount_usdt,
                p.actual_amount_usdt,
                p.confirmations,
                p.to_address,
                p.from_address,
                p.status AS payment_status,
                p.reject_reason,
                p.created_at,
                p.confirmed_at
            FROM operator_usdt_payments p
            LEFT JOIN operator_usdt_payment_intents i ON i.id = p.intent_id
            LEFT JOIN supports s ON s.id = p.support_id
            {where_p}
            ORDER BY p.created_at DESC
            LIMIT :lim
        """),
        params,
    )
    intents = await db.execute(
        text(f"""
            SELECT
                'INTENT' AS history_type,
                i.id AS history_id,
                i.support_id,
                s.login AS support_login,
                NULL AS support_name,
                i.id AS intent_id,
                i.requested_usdt,
                i.exact_usdt,
                i.company_wallet,
                i.expires_at,
                i.status AS intent_status,
                NULL AS tx_hash,
                NULL AS declared_amount_usdt,
                NULL AS actual_amount_usdt,
                NULL AS confirmations,
                NULL AS to_address,
                NULL AS from_address,
                NULL AS payment_status,
                NULL AS reject_reason,
                i.created_at,
                NULL AS confirmed_at
            FROM operator_usdt_payment_intents i
            LEFT JOIN operator_usdt_payments p ON p.intent_id = i.id
            LEFT JOIN supports s ON s.id = i.support_id
            WHERE p.id IS NULL
              AND i.status IN ('OPEN', 'EXPIRED', 'CANCELLED')
              {where_i_extra}
            ORDER BY i.created_at DESC
            LIMIT :lim
        """),
        params,
    )

    rows = [dict(r._mapping) for r in payments] + [dict(r._mapping) for r in intents]
    now_ts = datetime.utcnow().timestamp()

    for row in rows:
        payment_status = str(row.get("payment_status") or "").upper()
        intent_status = str(row.get("intent_status") or "").upper()
        if row["history_type"] == "PAYMENT":
            history_status = payment_status or "UNKNOWN"
        elif intent_status == "OPEN":
            expires_at = row.get("expires_at")
            is_expired = False
            if expires_at:
                try:
                    exp_ts = expires_at.timestamp() if hasattr(expires_at, "timestamp") else datetime.fromisoformat(str(expires_at)).timestamp()
                    is_expired = exp_ts < now_ts
                except Exception:
                    pass
            history_status = "EXPIRED" if is_expired else "WAITING_PAYMENT"
        else:
            history_status = intent_status or "UNKNOWN"

        row["history_status"] = history_status
        for field in ("requested_usdt", "exact_usdt", "declared_amount_usdt", "actual_amount_usdt"):
            if row.get(field) is not None:
                row[field] = float(row[field])
        if row.get("confirmations") is not None:
            row["confirmations"] = int(row["confirmations"])

    rows.sort(key=lambda r: r.get("created_at") or datetime.min, reverse=True)
    return rows[:safe_limit]


async def write_off_debt_by_superadmin(
    db: AsyncSession, support_id: int, requested_usdt: Optional[float] = None, actor_id: Optional[int] = None
) -> dict:
    await expire_intents_for_support(db, support_id)

    aggregate_before = await get_aggregate_debt(db, support_id)
    open_usdt = float(aggregate_before.get("usdt_open_total") or 0)
    if open_usdt <= 0:
        raise ValueError("No open USDT debt to write off")

    target_usdt = open_usdt
    if requested_usdt is not None:
        target_usdt = min(float(requested_usdt), open_usdt)
    target_usdt = _round_usdt(target_usdt)
    if target_usdt <= 0:
        raise ValueError("requested_usdt is too small")

    remaining = target_usdt
    written_off_rub = 0.0
    debts_affected = 0

    debt_rows = await db.execute(
        text("""
            SELECT d.*
              FROM operator_usdt_debts d
              LEFT JOIN orders o ON o.id = d.order_id
             WHERE d.support_id = :sid
               AND d.status IN ('OPEN', 'PARTIALLY_PAID')
               AND (o.id IS NULL OR o.status <> 'CANCELLED')
             ORDER BY d.created_at ASC, d.id ASC
        """),
        {"sid": support_id},
    )
    debts = [dict(r._mapping) for r in debt_rows]

    for debt in debts:
        if remaining <= 0:
            break
        usdt_due = float(debt.get("usdt_due") or 0)
        usdt_paid = float(debt.get("usdt_paid") or 0)
        debt_remaining = usdt_due - usdt_paid
        if debt_remaining <= 0:
            continue

        applied = min(remaining, debt_remaining)
        if applied <= 0:
            continue

        sum_rub_locked = float(debt.get("sum_rub_locked") or 0)
        rub_released = float(debt.get("rub_released") or 0)
        rub_remaining = max(0.0, sum_rub_locked - rub_released)

        delta_rub = _round_rub((sum_rub_locked * applied) / usdt_due) if usdt_due > 0 else 0
        if applied + USDT_COMPARE_TOLERANCE >= debt_remaining:
            delta_rub = _round_rub(rub_remaining)
        else:
            delta_rub = min(_round_rub(rub_remaining), delta_rub)

        new_usdt_paid = _round_usdt(usdt_paid + applied)
        new_rub_released = _round_rub(rub_released + delta_rub)

        if new_usdt_paid + USDT_COMPARE_TOLERANCE >= usdt_due:
            new_status = "PAID"
        elif new_usdt_paid <= 0:
            new_status = "OPEN"
        else:
            new_status = "PARTIALLY_PAID"

        await db.execute(
            text("""
                UPDATE operator_usdt_debts
                   SET usdt_paid=:up, rub_released=:rr, status=:st, updated_at=NOW()
                 WHERE id=:id
            """),
            {"up": new_usdt_paid, "rr": new_rub_released, "st": new_status, "id": debt["id"]},
        )
        remaining = _round_usdt(remaining - applied)
        written_off_rub = _round_rub(written_off_rub + delta_rub)
        debts_affected += 1

    # Cancel open intents
    await db.execute(
        text("""
            UPDATE operator_usdt_payment_intents
               SET status='CANCELLED', consumed_at=NOW()
             WHERE support_id=:sid AND status='OPEN'
        """),
        {"sid": support_id},
    )
    await db.commit()

    aggregate_after = await get_aggregate_debt(db, support_id)
    written_off_usdt = _round_usdt(target_usdt - remaining)

    return {
        "support_id": support_id,
        "actor_id": actor_id,
        "requested_usdt": target_usdt,
        "written_off_usdt": written_off_usdt,
        "written_off_rub": written_off_rub,
        "debts_affected": debts_affected,
        "debt_before": aggregate_before,
        "debt_after": aggregate_after,
    }
