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
    commission_percent: float = 0.0  # % of volume the cashier keeps


class CashierUpdateRequest(BaseModel):
    login: str
    password: Optional[str] = None
    commission_percent: Optional[float] = None
    is_active: Optional[bool] = None


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
            SUM(CASE WHEN cc.is_active = 1 THEN 1 ELSE 0 END) AS active_cards
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
            COALESCE(s.deposit, 0)      AS deposit,
            COALESCE(s.deposit_work, 0) AS deposit_work,
            COALESCE(s.deposit_paid, 0) AS deposit_paid,
            COALESCE(SUM(cc.total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(cc.current_volume), 0)     AS current_volume,
            COUNT(cc.id)                             AS card_count,
            SUM(CASE WHEN cc.is_active = 1 THEN 1 ELSE 0 END) AS active_cards,
            SUM(CASE WHEN cc.limit_reached_notified = 1 THEN 1 ELSE 0 END) AS cards_at_limit
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
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_cards,
            COALESCE(SUM(total_volume_limit), 0) AS total_volume_limit,
            COALESCE(SUM(current_volume), 0)     AS current_volume,
            SUM(CASE WHEN limit_reached_notified = 1 THEN 1 ELSE 0 END) AS cards_at_limit
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

@router.get("/me/deposit")
async def get_my_deposit(
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get current deposit balance, frozen amount, and system BTC address for top-up."""
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

    # System BTC address for top-up
    addr_row = await db.execute(
        text("SELECT value FROM system_settings WHERE `key` = 'crypto_wallet_address_BTC'")
    )
    addr_rec = addr_row.fetchone()
    system_address = addr_rec[0] if addr_rec else None

    # Current BTC rate in RUB
    rate_row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'BTC'")
    )
    rate_rec = rate_row.mappings().one_or_none()
    btc_rate_rub = 0.0
    if rate_rec:
        btc_rate_rub = float(
            rate_rec["manual_rate_rub"]
            if rate_rec["is_manual"] and rate_rec["manual_rate_rub"]
            else rate_rec["rate_rub"]
        )

    return {
        "deposit": deposit,
        "deposit_paid": deposit_paid,
        "deposit_work": deposit_work,
        "available": available,
        "system_btc_address": system_address,
        "btc_rate_rub": btc_rate_rub,
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


@router.post("/me/deposit/topup")
async def topup_my_deposit(
    body: DepositTopupRequest,
    current_user: Support = Depends(require_cashier_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Cashier submits a BTC transaction hash to top up their deposit.
    Backend verifies on blockchain that the TX has an output to the system address,
    then credits the deposit in RUB at the current BTC rate.
    """
    coin = body.coin.upper()
    if coin != "BTC":
        raise HTTPException(400, "Поддерживается только BTC")

    tx_hash = body.tx_hash.strip().lower()
    if len(tx_hash) != 64:
        raise HTTPException(400, "Неверный формат хеша транзакции")

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
        # REJECTED — allow retry

    # Get system address
    addr_row = await db.execute(
        text("SELECT value FROM system_settings WHERE `key` = 'crypto_wallet_address_BTC'")
    )
    addr_rec = addr_row.fetchone()
    if not addr_rec or not addr_rec[0]:
        raise HTTPException(500, "Системный BTC адрес не настроен. Обратитесь к администратору.")
    system_address = addr_rec[0]

    # Verify on blockchain (Blockstream API)
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: _requests.get(
                f"https://blockstream.info/api/tx/{tx_hash}", timeout=15
            ),
        )
    except Exception as e:
        raise HTTPException(502, f"Не удалось связаться с блокчейном: {e}")

    if resp.status_code == 404:
        raise HTTPException(400, "Транзакция не найдена в блокчейне. Проверьте хеш.")
    if not resp.ok:
        raise HTTPException(502, "Ошибка при проверке транзакции в блокчейне")

    tx = resp.json()
    if not tx.get("status", {}).get("confirmed", False):
        raise HTTPException(400, "Транзакция ещё не подтверждена. Дождитесь хотя бы 1 подтверждения.")

    # Sum outputs to system address
    received_btc = 0.0
    for vout in tx.get("vout", []):
        if vout.get("scriptpubkey_address") == system_address:
            received_btc += vout.get("value", 0) / 1e8

    if received_btc <= 0:
        raise HTTPException(
            400,
            f"В транзакции нет выплаты на адрес системы ({system_address}). "
            "Убедитесь, что вы отправили средства на правильный адрес."
        )

    # Get current BTC rate
    rate_row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'BTC'")
    )
    rate_rec = rate_row.mappings().one_or_none()
    if not rate_rec:
        raise HTTPException(500, "Курс BTC не найден. Повторите позже.")
    btc_rate_rub = float(
        rate_rec["manual_rate_rub"]
        if rate_rec["is_manual"] and rate_rec["manual_rate_rub"]
        else rate_rec["rate_rub"]
    )
    if btc_rate_rub <= 0:
        raise HTTPException(500, "Некорректный курс BTC. Повторите позже.")

    amount_rub = round(received_btc * btc_rate_rub, 2)

    # Insert or update deposit record
    if existing and existing["status"] == "REJECTED":
        await db.execute(text("""
            UPDATE cashier_deposits SET
                cashier_id = :uid, coin = :coin,
                amount_coin = :btc, btc_rate_rub = :rate, amount_rub = :rub,
                status = 'CONFIRMED', reject_reason = NULL, confirmed_at = NOW()
            WHERE tx_hash = :tx
        """), {
            "uid": current_user.id, "coin": coin,
            "btc": received_btc, "rate": btc_rate_rub, "rub": amount_rub,
            "tx": tx_hash,
        })
    else:
        await db.execute(text("""
            INSERT INTO cashier_deposits
                (cashier_id, tx_hash, coin, amount_coin, btc_rate_rub, amount_rub, status, confirmed_at)
            VALUES
                (:uid, :tx, :coin, :btc, :rate, :rub, 'CONFIRMED', NOW())
        """), {
            "uid": current_user.id, "tx": tx_hash, "coin": coin,
            "btc": received_btc, "rate": btc_rate_rub, "rub": amount_rub,
        })

    # Credit deposit
    await db.execute(
        text("UPDATE supports SET deposit = deposit + :amount WHERE id = :uid"),
        {"amount": amount_rub, "uid": current_user.id},
    )

    return {
        "success": True,
        "received_btc": received_btc,
        "btc_rate_rub": btc_rate_rub,
        "credited_rub": amount_rub,
        "message": f"Депозит пополнен на {amount_rub:.2f} ₽ ({received_btc:.8f} BTC × {btc_rate_rub:.2f} ₽/BTC)",
    }


# ---------------------------------------------------------------------------
# Superadmin — individual cashier management (/{cashier_id} AFTER /me/...)
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
