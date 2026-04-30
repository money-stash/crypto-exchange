"""
Cashier (Автовыдача) router.

Superadmin endpoints  — /api/cashiers/
Cashier-self endpoints — /api/cashiers/me/...
"""
import asyncio
import bcrypt
import logging
from typing import Optional

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.models.support import Support
from app.services import cashier_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cashiers", tags=["cashiers"])

require_superadmin = require_roles("SUPERADMIN")
require_cashier_or_admin = require_roles("CASHIER", "SUPERADMIN")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CashierCreateRequest(BaseModel):
    login: str
    password: str
    commission_percent: float = 0.0
    team_id: Optional[int] = None


class CashierUpdateRequest(BaseModel):
    login: str
    password: Optional[str] = None
    commission_percent: Optional[float] = None
    is_active: Optional[bool] = None
    team_id: Optional[int] = None


class CardCreateRequest(BaseModel):
    card_number: str
    card_holder: Optional[str] = None
    bank_name: Optional[str] = None
    min_amount: float = 0
    max_amount: float = 999999
    total_volume_limit: float = 0   # 0 = unlimited
    interval_minutes: int = 0       # 0 = no cooldown


class CardUpdateRequest(BaseModel):
    card_number: Optional[str] = None
    card_holder: Optional[str] = None
    bank_name: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    total_volume_limit: Optional[float] = None
    interval_minutes: Optional[int] = None
    is_active: Optional[bool] = None


class ExtendLimitRequest(BaseModel):
    extra_volume: float  # how much to add to total_volume_limit


class IntervalSettingRequest(BaseModel):
    interval: int  # 0 = disabled; N = every N-th order to operator


class DepositTopupRequest(BaseModel):
    tx_hash: str
    coin: str = "BTC"


class DepositAdjustRequest(BaseModel):
    amount_rub: float   # positive = add, negative = subtract
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Superadmin — cashier accounts
# ---------------------------------------------------------------------------

@router.get("/volume-summary")
async def get_volume_summary(
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Total volume capacity, used volume, and per-cashier breakdown."""
    rows = await db.execute(text("""
        SELECT
            s.id AS cashier_id,
            s.login,
            s.rate_percent AS commission_percent,
            s.is_active,
            COALESCE(SUM(cc.total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(cc.current_volume), 0)     AS current_volume,
            COUNT(cc.id)                             AS card_count,
            COALESCE(SUM(CASE WHEN cc.is_active = 1 THEN 1 ELSE 0 END), 0) AS active_cards
        FROM supports s
        LEFT JOIN cashier_cards cc ON cc.cashier_id = s.id
        WHERE s.role = 'CASHIER'
        GROUP BY s.id
        ORDER BY total_volume_limit DESC
    """))
    cashiers = [dict(r._mapping) for r in rows]

    total_limit = sum(float(c["total_volume_limit"] or 0) for c in cashiers)
    total_used = sum(float(c["current_volume"] or 0) for c in cashiers)

    return {
        "total_volume_limit": total_limit,
        "total_current_volume": total_used,
        "cashiers": cashiers,
    }


@router.get("/routing-setting")
async def get_routing_setting(
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text(
        "SELECT value FROM system_settings WHERE `key` = 'cashier_order_interval'"
    ))
    data = row.fetchone()
    return {"interval": int((data.value if data else None) or 0)}


@router.put("/routing-setting")
async def update_routing_setting(
    body: IntervalSettingRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    if body.interval < 0:
        raise HTTPException(400, "interval must be >= 0")
    await db.execute(text("""
        INSERT INTO system_settings (`key`, value)
        VALUES ('cashier_order_interval', :val)
        ON DUPLICATE KEY UPDATE value = :val
    """), {"val": str(body.interval)})
    return {"success": True, "interval": body.interval}


@router.get("/")
async def list_cashiers(
    search: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    where_parts = ["s.role = 'CASHIER'"]
    params: dict = {}
    if search:
        where_parts.append("s.login LIKE :search")
        params["search"] = f"%{search}%"

    where = " AND ".join(where_parts)
    params["limit"] = limit
    params["offset"] = (page - 1) * limit

    rows = await db.execute(text(f"""
        SELECT
            s.id, s.login, s.is_active, s.rate_percent AS commission_percent, s.created_at,
            s.team_id,
            COALESCE(s.deposit, 0)      AS deposit,
            COALESCE(s.deposit_work, 0) AS deposit_work,
            COALESCE(s.deposit_paid, 0) AS deposit_paid,
            COALESCE(SUM(cc.total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(cc.current_volume), 0)     AS current_volume,
            COUNT(cc.id)                             AS card_count,
            COALESCE(SUM(CASE WHEN cc.is_active = 1 THEN 1 ELSE 0 END), 0) AS active_cards,
            COALESCE(SUM(CASE WHEN cc.limit_reached_notified = 1 THEN 1 ELSE 0 END), 0) AS cards_at_limit
        FROM supports s
        LEFT JOIN cashier_cards cc ON cc.cashier_id = s.id
        WHERE {where}
        GROUP BY s.id
        ORDER BY s.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params)
    cashiers = [dict(r._mapping) for r in rows]

    count_row = await db.execute(text(
        f"SELECT COUNT(*) AS total FROM supports s WHERE {where}"
    ), {k: v for k, v in params.items() if k not in ("limit", "offset")})
    total = count_row.scalar()

    return {"cashiers": cashiers, "total": total, "pages": -(-total // limit), "page": page}


@router.post("/", status_code=201)
async def create_cashier(
    body: CashierCreateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(Support).where(Support.login == body.login)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Пользователь с таким логином уже существует")

    pass_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    cashier = Support(
        login=body.login,
        pass_hash=pass_hash,
        role="CASHIER",
        rate_percent=body.commission_percent,
        is_active=True,
        rating=100,
        team_id=body.team_id,
    )
    db.add(cashier)
    await db.flush()
    return {"message": "Кассир создан", "id": cashier.id}


# ---------------------------------------------------------------------------
# Cashier self — personal cabinet  (must be BEFORE /{cashier_id} routes)
# ---------------------------------------------------------------------------

@router.get("/me/stats")
async def get_my_stats(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "SUPERADMIN":
        raise HTTPException(403, "Use superadmin volume-summary endpoint")

    uid = current_user.id

    cards_row = await db.execute(text("""
        SELECT
            COUNT(*) AS total_cards,
            COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active_cards,
            COALESCE(SUM(total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(current_volume), 0)     AS current_volume,
            COALESCE(SUM(CASE WHEN limit_reached_notified = 1 THEN 1 ELSE 0 END), 0) AS cards_at_limit
        FROM cashier_cards WHERE cashier_id = :uid
    """), {"uid": uid})
    cards_stats = dict(cards_row.mappings().one())

    orders_row = await db.execute(text("""
        SELECT
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS total_completed,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS total_volume,
            COUNT(CASE WHEN status = 'COMPLETED' AND DATE(completed_at) = CURDATE() THEN 1 END) AS today_completed,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND DATE(completed_at) = CURDATE() THEN sum_rub END), 0) AS today_volume
        FROM orders
        WHERE support_id = :uid AND cashier_card_id IS NOT NULL
    """), {"uid": uid})
    orders_stats = dict(orders_row.mappings().one())

    return {
        **cards_stats,
        **orders_stats,
        "commission_percent": float(current_user.rate_percent or 0),
    }


@router.get("/me/cards")
async def get_my_cards(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text("""
        SELECT * FROM cashier_cards WHERE cashier_id = :uid ORDER BY created_at DESC
    """), {"uid": current_user.id})
    return [dict(r._mapping) for r in rows]


@router.post("/me/cards", status_code=201)
async def add_my_card(
    body: CardCreateRequest,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.min_amount < 0 or body.max_amount <= 0:
        raise HTTPException(400, "Некорректный диапазон сумм")
    if body.min_amount >= body.max_amount:
        raise HTTPException(400, "min_amount должен быть меньше max_amount")

    result = await db.execute(text("""
        INSERT INTO cashier_cards
            (cashier_id, card_number, card_holder, bank_name,
             min_amount, max_amount, total_volume_limit, interval_minutes)
        VALUES
            (:uid, :card_number, :card_holder, :bank_name,
             :min_amount, :max_amount, :total_volume_limit, :interval_minutes)
    """), {
        "uid": current_user.id,
        "card_number": body.card_number,
        "card_holder": body.card_holder,
        "bank_name": body.bank_name,
        "min_amount": body.min_amount,
        "max_amount": body.max_amount,
        "total_volume_limit": body.total_volume_limit,
        "interval_minutes": body.interval_minutes,
    })
    card_id = result.lastrowid
    return {"message": "Карта добавлена", "id": card_id}


@router.put("/me/cards/{card_id}")
async def update_my_card(
    card_id: int,
    body: CardUpdateRequest,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text(
        "SELECT * FROM cashier_cards WHERE id = :cid AND cashier_id = :uid"
    ), {"cid": card_id, "uid": current_user.id})
    card = row.mappings().one_or_none()
    if not card:
        raise HTTPException(404, "Карта не найдена")

    fields: list[str] = []
    params: dict = {"cid": card_id}

    if body.card_number is not None:
        fields.append("card_number = :card_number"); params["card_number"] = body.card_number
    if body.card_holder is not None:
        fields.append("card_holder = :card_holder"); params["card_holder"] = body.card_holder
    if body.bank_name is not None:
        fields.append("bank_name = :bank_name"); params["bank_name"] = body.bank_name
    if body.min_amount is not None:
        fields.append("min_amount = :min_amount"); params["min_amount"] = body.min_amount
    if body.max_amount is not None:
        fields.append("max_amount = :max_amount"); params["max_amount"] = body.max_amount
    if body.total_volume_limit is not None:
        fields.append("total_volume_limit = :total_volume_limit")
        params["total_volume_limit"] = body.total_volume_limit
    if body.interval_minutes is not None:
        fields.append("interval_minutes = :interval_minutes")
        params["interval_minutes"] = body.interval_minutes
    if body.is_active is not None:
        fields.append("is_active = :is_active"); params["is_active"] = body.is_active

    if fields:
        await db.execute(
            text(f"UPDATE cashier_cards SET {', '.join(fields)} WHERE id = :cid"), params
        )
    return {"message": "Карта обновлена"}


@router.delete("/me/cards/{card_id}")
async def delete_my_card(
    card_id: int,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text(
        "SELECT id FROM cashier_cards WHERE id = :cid AND cashier_id = :uid"
    ), {"cid": card_id, "uid": current_user.id})
    if not row.fetchone():
        raise HTTPException(404, "Карта не найдена")
    await db.execute(text("DELETE FROM cashier_cards WHERE id = :cid"), {"cid": card_id})
    return {"message": "Карта удалена"}


@router.patch("/me/cards/{card_id}/extend-limit")
async def extend_my_card_limit(
    card_id: int,
    body: ExtendLimitRequest,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.extra_volume <= 0:
        raise HTTPException(400, "extra_volume must be > 0")
    row = await db.execute(text(
        "SELECT id FROM cashier_cards WHERE id = :cid AND cashier_id = :uid"
    ), {"cid": card_id, "uid": current_user.id})
    if not row.fetchone():
        raise HTTPException(404, "Карта не найдена")
    await cashier_service.extend_card_limit(card_id, body.extra_volume, db)
    return {"message": "Лимит расширен"}


# ---------------------------------------------------------------------------
# Cashier deposit — self endpoints
# ---------------------------------------------------------------------------

DEPOSIT_COINS = ["BTC", "LTC", "USDT"]


async def _get_deposit_wallet(db, coin: str) -> str | None:
    row = await db.execute(
        text("SELECT value FROM system_settings WHERE `key` = :k"),
        {"k": f"cashier_deposit_wallet_{coin}"},
    )
    rec = row.fetchone()
    return (rec[0] or None) if rec else None


async def _get_coin_rate_rub(db, coin: str) -> float:
    row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = :coin"),
        {"coin": coin},
    )
    rec = row.mappings().one_or_none()
    if not rec:
        return 0.0
    return float(
        rec["manual_rate_rub"] if rec["is_manual"] and rec["manual_rate_rub"] else rec["rate_rub"]
    )


@router.get("/me/deposit")
async def get_my_deposit(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deposit balance + system deposit addresses for BTC / LTC / USDT TRC20."""
    uid = current_user.id

    dep_row = await db.execute(
        text("SELECT deposit, deposit_paid, deposit_work FROM supports WHERE id = :uid"),
        {"uid": uid},
    )
    dep = dep_row.mappings().one_or_none()
    deposit = float(dep["deposit"] or 0) if dep else 0.0
    deposit_paid = float(dep["deposit_paid"] or 0) if dep else 0.0
    deposit_work = float(dep["deposit_work"] or 0) if dep else 0.0
    available = max(0.0, deposit - deposit_work)

    wallets = {}
    rates = {}
    for coin in DEPOSIT_COINS:
        wallets[coin] = await _get_deposit_wallet(db, coin)
        rates[coin] = await _get_coin_rate_rub(db, coin)

    return {
        "deposit": deposit,
        "deposit_paid": deposit_paid,
        "deposit_work": deposit_work,
        "available": available,
        "wallets": wallets,   # {BTC: "addr", LTC: "addr", USDT: "addr"}
        "rates": rates,       # {BTC: 7000000.0, LTC: 8000.0, USDT: 90.0}
        # Legacy field kept for old clients
        "system_btc_address": wallets.get("BTC"),
        "btc_rate_rub": rates.get("BTC", 0.0),
    }


@router.get("/me/deposit/history")
async def get_my_deposit_history(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * limit
    try:
        rows = await db.execute(text("""
            SELECT * FROM cashier_deposits
            WHERE cashier_id = :uid
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """), {"uid": current_user.id, "limit": limit, "offset": offset})
        items = [dict(r._mapping) for r in rows]

        total_row = await db.execute(
            text("SELECT COUNT(*) FROM cashier_deposits WHERE cashier_id = :uid"),
            {"uid": current_user.id},
        )
        total = total_row.scalar()
    except Exception:
        # Table may not exist yet (migration not run)
        items = []
        total = 0
    return {"items": items, "total": total, "pages": max(1, -(-total // limit)), "page": page}


async def _verify_btc_ltc(tx_hash: str, system_address: str, coin: str) -> float:
    """Returns received amount in coin units via Blockstream/Litecoinspace."""
    if coin == "BTC":
        url = f"https://blockstream.info/api/tx/{tx_hash}"
    else:  # LTC
        url = f"https://litecoinspace.org/api/tx/{tx_hash}"

    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
    except Exception as e:
        raise HTTPException(502, f"Не удалось связаться с блокчейном: {e}")

    if resp.status_code == 404:
        raise HTTPException(400, "Транзакция не найдена в блокчейне. Проверьте хеш.")
    if not resp.is_success:
        raise HTTPException(502, "Ошибка при проверке транзакции в блокчейне")

    tx = resp.json()
    if not tx.get("status", {}).get("confirmed", False):
        raise HTTPException(400, "Транзакция ещё не подтверждена. Дождитесь хотя бы 1 подтверждения.")

    received = 0.0
    for vout in tx.get("vout", []):
        if vout.get("scriptpubkey_address") == system_address:
            received += vout.get("value", 0) / 1e8

    if received <= 0:
        raise HTTPException(
            400,
            f"В транзакции нет выплаты на адрес системы ({system_address}). "
            "Убедитесь, что вы отправили средства на правильный адрес."
        )
    return received


async def _verify_usdt_trc20(tx_hash: str, system_address: str) -> float:
    """Returns received USDT amount via TronScan."""
    from app.services.tron_service import inspect_usdt_transfer
    try:
        result = await inspect_usdt_transfer(tx_hash)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Ошибка TronScan: {e}")

    to_addr = (result.get("toAddress") or "").strip().lower()
    if to_addr != system_address.strip().lower():
        raise HTTPException(
            400,
            f"Получатель в транзакции ({result.get('toAddress')}) не совпадает с адресом системы ({system_address})."
        )
    if result.get("confirmations", 0) < 1:
        raise HTTPException(400, "Транзакция ещё не подтверждена. Дождитесь хотя бы 1 подтверждения.")

    return float(result["amountUsdt"])


@router.post("/me/deposit/topup")
async def topup_my_deposit(
    body: DepositTopupRequest,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Cashier submits a transaction hash to top up their deposit.
    Supported: BTC (Blockstream), LTC (Litecoinspace), USDT TRC20 (TronScan).
    """
    coin = body.coin.upper()
    if coin not in DEPOSIT_COINS:
        raise HTTPException(400, f"Неподдерживаемая монета. Допустимые: {', '.join(DEPOSIT_COINS)}")

    tx_hash = body.tx_hash.strip()
    # BTC/LTC hashes are lowercase hex 64 chars; USDT TRC20 are 64 uppercase hex
    if len(tx_hash) != 64:
        raise HTTPException(400, "Неверный формат хеша транзакции (должно быть 64 символа)")

    if coin in ("BTC", "LTC"):
        tx_hash = tx_hash.lower()

    # Check not already used
    dup = await db.execute(
        text("SELECT id, status FROM cashier_deposits WHERE tx_hash = :tx"),
        {"tx": tx_hash},
    )
    existing = dup.mappings().one_or_none()
    if existing:
        if existing["status"] == "CONFIRMED":
            raise HTTPException(400, "Эта транзакция уже была зачтена")
        elif existing["status"] == "PENDING":
            raise HTTPException(400, "Эта транзакция уже ожидает подтверждения")

    # Get system deposit address
    system_address = await _get_deposit_wallet(db, coin)
    if not system_address:
        raise HTTPException(500, f"Адрес депозита {coin} не настроен. Обратитесь к администратору.")

    # Verify on blockchain
    if coin in ("BTC", "LTC"):
        received_amount = await _verify_btc_ltc(tx_hash, system_address, coin)
    else:  # USDT
        received_amount = await _verify_usdt_trc20(tx_hash, system_address)

    # Get coin rate in RUB
    coin_rate_rub = await _get_coin_rate_rub(db, coin)
    if coin_rate_rub <= 0:
        raise HTTPException(500, f"Курс {coin} не найден. Повторите позже.")

    amount_rub = round(received_amount * coin_rate_rub, 2)

    # Save deposit record
    if existing and existing["status"] == "REJECTED":
        await db.execute(text("""
            UPDATE cashier_deposits SET
                cashier_id = :uid, coin = :coin,
                amount_coin = :amount, btc_rate_rub = :rate, amount_rub = :rub,
                status = 'CONFIRMED', reject_reason = NULL, confirmed_at = NOW()
            WHERE tx_hash = :tx
        """), {"uid": current_user.id, "coin": coin, "amount": received_amount,
               "rate": coin_rate_rub, "rub": amount_rub, "tx": tx_hash})
    else:
        await db.execute(text("""
            INSERT INTO cashier_deposits
                (cashier_id, tx_hash, coin, amount_coin, btc_rate_rub, amount_rub, status, confirmed_at)
            VALUES
                (:uid, :tx, :coin, :amount, :rate, :rub, 'CONFIRMED', NOW())
        """), {"uid": current_user.id, "tx": tx_hash, "coin": coin,
               "amount": received_amount, "rate": coin_rate_rub, "rub": amount_rub})

    await db.execute(
        text("UPDATE supports SET deposit = deposit + :amount WHERE id = :uid"),
        {"amount": amount_rub, "uid": current_user.id},
    )
    await db.commit()

    decimals = 2 if coin == "USDT" else 8
    return {
        "success": True,
        "coin": coin,
        "received_amount": round(received_amount, decimals),
        "coin_rate_rub": coin_rate_rub,
        "credited_rub": amount_rub,
        "message": f"Депозит пополнен на {amount_rub:,.2f} ₽  ({received_amount:.{decimals}f} {coin} × {coin_rate_rub:,.2f} ₽/{coin})",
    }


# ---------------------------------------------------------------------------
# Cashier self — simplified orders (no client data)
# ---------------------------------------------------------------------------

@router.get("/me/orders")
async def get_my_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    card_id: Optional[int] = None,
    status: Optional[str] = None,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Full order list for cashier: date, card, sum, rate, sum in USD, status."""
    uid = current_user.id
    params: dict = {"uid": uid, "limit": limit, "offset": (page - 1) * limit}
    where = "o.cashier_card_id IN (SELECT id FROM cashier_cards WHERE cashier_id = :uid)"
    if card_id:
        where += " AND o.cashier_card_id = :card_id"
        params["card_id"] = card_id
    if status:
        where += " AND o.status = :status"
        params["status"] = status.upper()

    # Get USDT rate for USD equivalent calculation
    usdt_row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'")
    )
    usdt_rec = usdt_row.mappings().one_or_none()
    usdt_rate = 0.0
    if usdt_rec:
        usdt_rate = float(
            usdt_rec["manual_rate_rub"]
            if usdt_rec["is_manual"] and usdt_rec["manual_rate_rub"]
            else usdt_rec["rate_rub"]
        )

    rows = await db.execute(text(f"""
        SELECT
            o.id,
            o.unique_id,
            o.coin,
            o.dir,
            o.amount_coin,
            o.sum_rub,
            o.rate_rub,
            o.status,
            o.created_at,
            o.completed_at,
            cc.card_number,
            cc.bank_name,
            cc.id AS card_id
        FROM orders o
        LEFT JOIN cashier_cards cc ON cc.id = o.cashier_card_id
        WHERE {where}
        ORDER BY o.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params)

    orders = []
    for r in rows:
        d = dict(r._mapping)
        sum_rub = float(d.get("sum_rub") or 0)
        d["sum_usd"] = round(sum_rub / usdt_rate, 2) if usdt_rate > 0 else None
        # Mask full card number
        cn = d.pop("card_number") or ""
        d["card_masked"] = f"****{cn[-4:]}" if len(cn) >= 4 else cn
        orders.append(d)

    count_row = await db.execute(
        text(f"SELECT COUNT(*) FROM orders o WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count_row.scalar() or 0
    return {"orders": orders, "total": total, "pages": max(1, -(-total // limit)), "page": page}


@router.post("/me/orders/{order_id}/confirm")
async def confirm_order_payment(
    order_id: int,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cashier confirms that payment arrived on their card (AWAITING_CONFIRM → AWAITING_HASH)."""
    # Verify this order belongs to cashier's card
    row = await db.execute(text("""
        SELECT o.* FROM orders o
        JOIN cashier_cards cc ON cc.id = o.cashier_card_id AND cc.cashier_id = :uid
        WHERE o.id = :oid
        LIMIT 1
    """), {"uid": current_user.id, "oid": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Заявка не найдена или не принадлежит вашей карте")
    order = dict(order)

    if order["status"] != "AWAITING_CONFIRM":
        raise HTTPException(400, f"Неверный статус: {order['status']}. Ожидается: AWAITING_CONFIRM")

    sum_rub = float(order.get("sum_rub") or 0)

    # Freeze cashier deposit
    dep_row = await db.execute(
        text("SELECT deposit, deposit_work FROM supports WHERE id = :uid"),
        {"uid": current_user.id},
    )
    dep = dep_row.mappings().one_or_none()
    if dep:
        available = float(dep["deposit"] or 0) - float(dep["deposit_work"] or 0)
        if available < sum_rub:
            raise HTTPException(
                400,
                f"Недостаточно средств в депозите. Доступно: {available:.2f} ₽, нужно: {sum_rub:.2f} ₽"
            )
        await db.execute(
            text("UPDATE supports SET deposit_work = deposit_work + :amount WHERE id = :uid"),
            {"amount": sum_rub, "uid": current_user.id},
        )

    # Move to AWAITING_HASH
    await db.execute(
        text("""
            UPDATE orders SET status = 'AWAITING_HASH',
                sla_user_paid_at = COALESCE(sla_user_paid_at, NOW()),
                updated_at = NOW()
            WHERE id = :id
        """),
        {"id": order_id},
    )
    await db.commit()

    # Emit socket
    from app.routers.orders import ORDER_SELECT
    import app.socket.socket_service as sio
    updated_row = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated_row.mappings().one())
    await sio.emit_order_status_changed({
        "orderId": order_id,
        "oldStatus": "AWAITING_CONFIRM",
        "newStatus": "AWAITING_HASH",
        "order": updated_order,
    })
    await sio.emit_order_updated(updated_order)

    # Trigger auto-send crypto if applicable
    auto_send_triggered = False
    if order.get("dir") == "BUY" and order.get("user_crypto_address") and float(order.get("amount_coin") or 0) > 0:
        try:
            import asyncio
            from app.services.crypto_wallet_service import get_active_mnemonic, SUPPORTED_COINS
            from app.routers.deals import _auto_send_crypto
            coin = order["coin"]
            if coin in SUPPORTED_COINS:
                mnemonic = await get_active_mnemonic(coin, db)
                if mnemonic:
                    tg_row = await db.execute(
                        text("SELECT u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
                        {"id": order_id},
                    )
                    tg_rec = tg_row.fetchone()
                    asyncio.create_task(_auto_send_crypto(
                        order_id=order_id,
                        coin=coin,
                        mnemonic=mnemonic,
                        to_address=order["user_crypto_address"],
                        amount=float(order["amount_coin"]),
                        bot_id=order.get("bot_id"),
                        tg_id=int(tg_rec.tg_id) if tg_rec else None,
                        unique_id=order.get("unique_id"),
                    ))
                    auto_send_triggered = True
        except Exception as e:
            logger.warning(f"[cashier confirm] Auto-send failed for order {order_id}: {e}")

    return {"success": True, "orderDetails": updated_order, "autoSendTriggered": auto_send_triggered}


# ---------------------------------------------------------------------------
# Cashier self — payment history per card
# ---------------------------------------------------------------------------

@router.get("/me/cards/{card_id}/history")
async def get_my_card_history(
    card_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """All completed orders for a specific cashier card."""
    card_row = await db.execute(
        text("SELECT * FROM cashier_cards WHERE id = :cid AND cashier_id = :uid"),
        {"cid": card_id, "uid": current_user.id},
    )
    card = card_row.mappings().one_or_none()
    if not card:
        raise HTTPException(404, "Карта не найдена")
    card = dict(card)

    params: dict = {"cid": card_id, "limit": limit, "offset": (page - 1) * limit}
    rows = await db.execute(text("""
        SELECT
            o.id,
            o.unique_id,
            o.coin,
            o.dir,
            o.amount_coin,
            o.sum_rub,
            o.completed_at,
            o.created_at
        FROM orders o
        WHERE o.cashier_card_id = :cid AND o.status = 'COMPLETED'
        ORDER BY o.completed_at DESC
        LIMIT :limit OFFSET :offset
    """), params)
    items = [dict(r._mapping) for r in rows]

    total_row = await db.execute(
        text("SELECT COUNT(*), COALESCE(SUM(sum_rub), 0), COALESCE(SUM(amount_coin), 0) FROM orders WHERE cashier_card_id = :cid AND status = 'COMPLETED'"),
        {"cid": card_id},
    )
    total_data = total_row.fetchone()
    total = total_data[0] or 0
    total_sum_rub = float(total_data[1] or 0)
    total_amount_coin = float(total_data[2] or 0)

    cn = card.get("card_number") or ""
    return {
        "card": {
            "id": card["id"],
            "card_masked": f"****{cn[-4:]}" if len(cn) >= 4 else cn,
            "bank_name": card.get("bank_name"),
            "card_holder": card.get("card_holder"),
            "current_volume": float(card.get("current_volume") or 0),
            "total_volume_limit": float(card.get("total_volume_limit") or 0),
        },
        "history": items,
        "total": total,
        "total_sum_rub": total_sum_rub,
        "total_amount_coin": total_amount_coin,
        "pages": max(1, -(-total // limit)),
        "page": page,
    }


# ---------------------------------------------------------------------------
# Cashier self — chat with manager
# ---------------------------------------------------------------------------

async def _cashier_manager_id(db: AsyncSession, cashier_id: int) -> int:
    """Get assigned manager for cashier, fallback to first SUPERADMIN."""
    row = await db.execute(
        text("SELECT manager_id FROM supports WHERE id = :id AND role = 'CASHIER'"),
        {"id": cashier_id},
    )
    rec = row.fetchone()
    if rec and rec[0]:
        return int(rec[0])
    fallback = await db.execute(text(
        "SELECT id FROM supports WHERE role IN ('MANAGER','SUPERADMIN') AND is_active = 1 ORDER BY id ASC LIMIT 1"
    ))
    f = fallback.fetchone()
    if f:
        return int(f[0])
    raise HTTPException(409, "Нет доступных менеджеров")


@router.get("/me/chat/unread")
async def get_my_chat_unread(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("""
        SELECT COUNT(*) FROM operator_manager_messages
        WHERE operator_id = :uid AND is_read_by_operator = 0
          AND sender_type IN ('MANAGER', 'SUPERADMIN')
    """), {"uid": current_user.id})
    return {"count": row.scalar() or 0}


@router.get("/me/chat")
async def get_my_chat(
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    manager_id = await _cashier_manager_id(db, current_user.id)
    rows = await db.execute(text("""
        SELECT omm.id, omm.operator_id AS cashier_id, omm.manager_id,
               omm.sender_type, omm.sender_id, omm.message,
               omm.created_at, omm.is_read_by_operator AS is_read_by_cashier,
               omm.is_read_by_manager,
               s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.operator_id = :uid
        ORDER BY omm.created_at ASC, omm.id ASC
        LIMIT :limit OFFSET :offset
    """), {"uid": current_user.id, "limit": limit, "offset": offset})
    return {"messages": [dict(r._mapping) for r in rows], "manager_id": manager_id}


@router.post("/me/chat")
async def send_to_manager(
    body: dict,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    text_msg = (body.get("message") or "").strip()
    if not text_msg:
        raise HTTPException(400, "Сообщение не может быть пустым")

    manager_id = await _cashier_manager_id(db, current_user.id)

    result = await db.execute(text("""
        INSERT INTO operator_manager_messages
            (operator_id, manager_id, sender_type, sender_id, message,
             is_read_by_operator, is_read_by_manager)
        VALUES (:uid, :mid, 'CASHIER', :sid, :msg, 1, 0)
    """), {"uid": current_user.id, "mid": manager_id, "sid": current_user.id, "msg": text_msg})
    await db.commit()
    msg_id = result.lastrowid

    row = await db.execute(text("""
        SELECT omm.id, omm.operator_id AS cashier_id, omm.manager_id,
               omm.sender_type, omm.sender_id, omm.message,
               omm.created_at, omm.is_read_by_operator AS is_read_by_cashier,
               omm.is_read_by_manager, s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.id = :id
    """), {"id": msg_id})
    msg = dict(row.fetchone()._mapping)

    import app.socket.socket_service as sio
    await sio.emit_operator_manager_message(current_user.id, manager_id, msg)
    return msg


@router.post("/me/chat/read")
async def mark_my_chat_read(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        UPDATE operator_manager_messages
        SET is_read_by_operator = 1
        WHERE operator_id = :uid AND is_read_by_operator = 0
          AND sender_type IN ('MANAGER', 'SUPERADMIN')
    """), {"uid": current_user.id})
    await db.commit()
    return {"success": True, "marked": result.rowcount}


# ---------------------------------------------------------------------------
# Superadmin/Manager — cashier chat
# ---------------------------------------------------------------------------

require_manager_or_admin = require_roles("SUPERADMIN", "MANAGER")


@router.get("/chats")
async def list_cashier_chats(
    current_user: Support = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all cashier-manager chat threads (for manager panel)."""
    rows = await db.execute(text("""
        SELECT
            c.id AS cashier_id,
            c.login AS cashier_login,
            c.is_active,
            m.id AS manager_id,
            m.login AS manager_login,
            lm.message AS last_message,
            lm.sender_type AS last_sender_type,
            lm.created_at AS last_message_at,
            COALESCE(agg.unread_for_manager, 0) AS unread_for_manager,
            COALESCE(agg.unread_for_cashier, 0) AS unread_for_cashier
        FROM supports c
        LEFT JOIN supports m ON m.id = c.manager_id
        LEFT JOIN (
            SELECT
                mm.operator_id,
                MAX(mm.id) AS last_id,
                SUM(CASE WHEN mm.is_read_by_manager = 0 AND mm.sender_type = 'CASHIER' THEN 1 ELSE 0 END) AS unread_for_manager,
                SUM(CASE WHEN mm.is_read_by_operator = 0 AND mm.sender_type IN ('MANAGER','SUPERADMIN') THEN 1 ELSE 0 END) AS unread_for_cashier
            FROM operator_manager_messages mm
            GROUP BY mm.operator_id
        ) agg ON agg.operator_id = c.id
        LEFT JOIN operator_manager_messages lm ON lm.id = agg.last_id
        WHERE c.role = 'CASHIER'
        ORDER BY unread_for_manager DESC, lm.created_at DESC, c.login ASC
    """))
    return {"chats": [dict(r._mapping) for r in rows]}


# ---------------------------------------------------------------------------
# Cashier Teams management  (MUST be before /{cashier_id} catch-all)
# ---------------------------------------------------------------------------

class TeamCreateRequest(BaseModel):
    name: str
    bot_token: Optional[str] = None

class TeamUpdateRequest(BaseModel):
    name: Optional[str] = None
    bot_token: Optional[str] = None


@router.get("/teams")
async def list_teams(
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text("""
        SELECT t.id, t.name, t.bot_token, t.deposit, t.deposit_work, t.deposit_paid, t.created_at,
               COUNT(s.id) AS member_count
        FROM cashier_teams t
        LEFT JOIN supports s ON s.team_id = t.id AND s.role = 'CASHIER'
        GROUP BY t.id
        ORDER BY t.created_at DESC
    """))
    return {"teams": [dict(r._mapping) for r in rows]}


@router.post("/teams", status_code=201)
async def create_team(
    body: TeamCreateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text(
        "INSERT INTO cashier_teams (name, bot_token) VALUES (:name, :token)"
    ), {"name": body.name, "token": body.bot_token or None})
    await db.commit()
    team_id = result.lastrowid

    if body.bot_token:
        from bot.cashier_bot_manager import cashier_bot_manager
        asyncio.create_task(cashier_bot_manager.start_bot(team_id, body.bot_token))

    return {"message": "Команда создана", "id": team_id}


@router.put("/teams/{team_id}")
async def update_team(
    team_id: int,
    body: TeamUpdateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    fields, params = [], {"tid": team_id}
    if body.name is not None:
        fields.append("name = :name"); params["name"] = body.name
    if body.bot_token is not None:
        fields.append("bot_token = :token"); params["token"] = body.bot_token or None
    if fields:
        await db.execute(text(f"UPDATE cashier_teams SET {', '.join(fields)} WHERE id = :tid"), params)
        await db.commit()

    if body.bot_token is not None:
        from bot.cashier_bot_manager import cashier_bot_manager
        if body.bot_token:
            asyncio.create_task(cashier_bot_manager.start_bot(team_id, body.bot_token))
        else:
            asyncio.create_task(cashier_bot_manager.stop_bot(team_id))

    return {"message": "Команда обновлена"}


@router.delete("/teams/{team_id}")
async def delete_team(
    team_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    from bot.cashier_bot_manager import cashier_bot_manager
    asyncio.create_task(cashier_bot_manager.stop_bot(team_id))
    await db.execute(text("DELETE FROM cashier_teams WHERE id = :id"), {"id": team_id})
    await db.commit()
    return {"message": "Команда удалена"}


@router.get("/teams/{team_id}/members")
async def get_team_members(
    team_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text("""
        SELECT id, login, is_active, rate_percent AS commission_percent,
               tg_id, created_at
        FROM supports
        WHERE team_id = :tid AND role = 'CASHIER'
        ORDER BY created_at DESC
    """), {"tid": team_id})
    return {"members": [dict(r._mapping) for r in rows]}


# ---------------------------------------------------------------------------
# Superadmin — individual cashier management (/{cashier_id} AFTER /me/... and /teams/...)
# ---------------------------------------------------------------------------

@router.get("/{cashier_id}")
async def get_cashier(
    cashier_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("""
        SELECT
            s.id, s.login, s.is_active, s.rate_percent AS commission_percent, s.created_at,
            COALESCE(SUM(cc.total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(cc.current_volume), 0)     AS current_volume,
            COUNT(cc.id) AS card_count
        FROM supports s
        LEFT JOIN cashier_cards cc ON cc.cashier_id = s.id
        WHERE s.id = :id AND s.role = 'CASHIER'
        GROUP BY s.id
    """), {"id": cashier_id})
    cashier = row.mappings().one_or_none()
    if not cashier:
        raise HTTPException(404, "Кассир не найден")
    return dict(cashier)


@router.put("/{cashier_id}")
async def update_cashier(
    cashier_id: int,
    body: CashierUpdateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Support).where(Support.id == cashier_id, Support.role == "CASHIER")
    )
    cashier = result.scalar_one_or_none()
    if not cashier:
        raise HTTPException(404, "Кассир не найден")

    dup = await db.execute(
        select(Support.id).where(Support.login == body.login, Support.id != cashier_id)
    )
    if dup.scalar_one_or_none():
        raise HTTPException(400, "Логин уже занят")

    cashier.login = body.login
    if body.commission_percent is not None:
        cashier.rate_percent = body.commission_percent
    if body.is_active is not None:
        cashier.is_active = body.is_active
    if body.team_id is not None:
        cashier.team_id = body.team_id or None
    if body.password and body.password.strip():
        if len(body.password) < 6:
            raise HTTPException(400, "Пароль должен содержать минимум 6 символов")
        cashier.pass_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    return {"message": "Данные кассира обновлены"}


@router.delete("/{cashier_id}")
async def delete_cashier(
    cashier_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Support).where(Support.id == cashier_id, Support.role == "CASHIER")
    )
    cashier = result.scalar_one_or_none()
    if not cashier:
        raise HTTPException(404, "Кассир не найден")
    await db.delete(cashier)
    return {"message": "Кассир удалён"}


@router.get("/{cashier_id}/cards")
async def get_cashier_cards(
    cashier_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text("""
        SELECT * FROM cashier_cards WHERE cashier_id = :id ORDER BY created_at DESC
    """), {"id": cashier_id})
    return [dict(r._mapping) for r in rows]


@router.get("/{cashier_id}/deposit")
async def get_cashier_deposit(
    cashier_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("SELECT deposit, deposit_paid, deposit_work FROM supports WHERE id = :id AND role = 'CASHIER'"),
        {"id": cashier_id},
    )
    dep = row.mappings().one_or_none()
    if not dep:
        raise HTTPException(404, "Кассир не найден")

    deposit = float(dep["deposit"] or 0)
    deposit_paid = float(dep["deposit_paid"] or 0)
    deposit_work = float(dep["deposit_work"] or 0)

    try:
        history_rows = await db.execute(text("""
            SELECT * FROM cashier_deposits WHERE cashier_id = :id ORDER BY created_at DESC LIMIT 20
        """), {"id": cashier_id})
        history = [dict(r._mapping) for r in history_rows]
    except Exception:
        history = []

    return {
        "deposit": deposit,
        "deposit_paid": deposit_paid,
        "deposit_work": deposit_work,
        "available": max(0.0, deposit - deposit_work),
        "history": history,
    }


@router.post("/{cashier_id}/deposit/adjust")
async def admin_adjust_cashier_deposit(
    cashier_id: int,
    body: DepositAdjustRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Manually add or subtract from cashier's deposit balance."""
    row = await db.execute(
        text("SELECT id FROM supports WHERE id = :id AND role = 'CASHIER'"),
        {"id": cashier_id},
    )
    if not row.fetchone():
        raise HTTPException(404, "Кассир не найден")

    if body.amount_rub == 0:
        raise HTTPException(400, "Сумма не может быть 0")

    if body.amount_rub > 0:
        await db.execute(
            text("UPDATE supports SET deposit = deposit + :amount WHERE id = :uid"),
            {"amount": body.amount_rub, "uid": cashier_id},
        )
        # Record as manual top-up in history
        note = body.note or "Ручное пополнение администратором"
        await db.execute(text("""
            INSERT INTO cashier_deposits
                (cashier_id, tx_hash, coin, amount_coin, btc_rate_rub, amount_rub, status, confirmed_at)
            VALUES
                (:uid, :tx, 'MANUAL', 0, 0, :rub, 'CONFIRMED', NOW())
        """), {
            "uid": cashier_id,
            "tx": f"manual_{cashier_id}_{note[:30].replace(' ', '_')}_{int(__import__('time').time())}",
            "rub": body.amount_rub,
        })
    else:
        # Subtract — clamp at 0
        await db.execute(
            text("UPDATE supports SET deposit = GREATEST(0, deposit + :amount) WHERE id = :uid"),
            {"amount": body.amount_rub, "uid": cashier_id},
        )

    return {"success": True, "adjusted_rub": body.amount_rub}


@router.get("/{cashier_id}/chat")
async def get_cashier_chat(
    cashier_id: int,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: Support = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manager reads chat with a specific cashier."""
    rows = await db.execute(text("""
        SELECT omm.id, omm.operator_id AS cashier_id, omm.manager_id,
               omm.sender_type, omm.sender_id, omm.message,
               omm.created_at, omm.is_read_by_operator AS is_read_by_cashier,
               omm.is_read_by_manager, s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.operator_id = :cid
        ORDER BY omm.created_at ASC, omm.id ASC
        LIMIT :limit OFFSET :offset
    """), {"cid": cashier_id, "limit": limit, "offset": offset})
    return {"messages": [dict(r._mapping) for r in rows]}


@router.post("/{cashier_id}/chat")
async def send_to_cashier(
    cashier_id: int,
    body: dict,
    current_user: Support = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manager sends a message to a cashier."""
    text_msg = (body.get("message") or "").strip()
    if not text_msg:
        raise HTTPException(400, "Сообщение не может быть пустым")

    result = await db.execute(text("""
        INSERT INTO operator_manager_messages
            (operator_id, manager_id, sender_type, sender_id, message,
             is_read_by_operator, is_read_by_manager)
        VALUES (:cid, :mid, :stype, :sid, :msg, 0, 1)
    """), {
        "cid": cashier_id,
        "mid": current_user.id,
        "stype": "SUPERADMIN" if current_user.role == "SUPERADMIN" else "MANAGER",
        "sid": current_user.id,
        "msg": text_msg,
    })
    await db.commit()
    msg_id = result.lastrowid

    row = await db.execute(text("""
        SELECT omm.id, omm.operator_id AS cashier_id, omm.manager_id,
               omm.sender_type, omm.sender_id, omm.message,
               omm.created_at, omm.is_read_by_operator AS is_read_by_cashier,
               omm.is_read_by_manager, s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.id = :id
    """), {"id": msg_id})
    msg = dict(row.fetchone()._mapping)

    import app.socket.socket_service as sio
    await sio.emit_operator_manager_message(cashier_id, current_user.id, msg)
    return msg


@router.post("/{cashier_id}/chat/read")
async def mark_cashier_chat_read(
    cashier_id: int,
    current_user: Support = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        UPDATE operator_manager_messages
        SET is_read_by_manager = 1
        WHERE operator_id = :cid AND is_read_by_manager = 0 AND sender_type = 'CASHIER'
    """), {"cid": cashier_id})
    await db.commit()
    return {"success": True, "marked": result.rowcount}


@router.patch("/{cashier_id}/cards/{card_id}/extend-limit")
async def admin_extend_card_limit(
    cashier_id: int,
    card_id: int,
    body: ExtendLimitRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    if body.extra_volume <= 0:
        raise HTTPException(400, "extra_volume must be > 0")
    row = await db.execute(text(
        "SELECT id FROM cashier_cards WHERE id = :cid AND cashier_id = :uid"
    ), {"cid": card_id, "uid": cashier_id})
    if not row.fetchone():
        raise HTTPException(404, "Карта не найдена")
    await cashier_service.extend_card_limit(card_id, body.extra_volume, db)
    return {"message": "Лимит расширен"}


# ---------------------------------------------------------------------------
# Team members management
# ---------------------------------------------------------------------------

@router.get("/{cashier_id}/members")
async def get_cashier_members(
    cashier_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text(
        "SELECT id, tg_id, username, joined_at FROM cashier_members "
        "WHERE cashier_id = :cid ORDER BY joined_at DESC"
    ), {"cid": cashier_id})
    return {"members": [dict(r._mapping) for r in rows]}


@router.delete("/{cashier_id}/members/{tg_id}")
async def remove_cashier_member(
    cashier_id: int,
    tg_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text(
        "DELETE FROM cashier_members WHERE cashier_id = :cid AND tg_id = :tid"
    ), {"cid": cashier_id, "tid": tg_id})
    if result.rowcount == 0:
        raise HTTPException(404, "Участник не найден")
    await db.commit()
    return {"message": "Участник удалён"}


@router.get("/me/members")
async def get_my_members(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text(
        "SELECT id, tg_id, username, joined_at FROM cashier_members "
        "WHERE cashier_id = :cid ORDER BY joined_at DESC"
    ), {"cid": current_user.id})
    return {"members": [dict(r._mapping) for r in rows]}


