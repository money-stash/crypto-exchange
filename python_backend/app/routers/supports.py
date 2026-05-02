import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.services import operator_debt_service as debt_svc

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.models.support import Support
from app.schemas.supports import (
    SupportCreateRequest,
    SupportUpdateRequest,
    StatusUpdateRequest,
    MaxOrdersUpdateRequest,
    DepositUpdateRequest,
)

router = APIRouter(prefix="/api/supports", tags=["supports"])

require_superadmin = require_roles("SUPERADMIN")
require_manager_up = require_roles("SUPERADMIN", "MANAGER")


def _normalize_chat_language(value: Optional[str], fallback: str = "RU") -> Optional[str]:
    if not value:
        return fallback
    v = value.strip().upper()
    return v if v in ("RU", "EN") else None


def _normalize_flag(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return 1 if value else 0
    s = str(value).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return 1
    if s in ("0", "false", "no", "off"):
        return 0
    return None


# ---------------------------------------------------------------------------
# GET /rating/top  — ДО /:id чтобы не перехватывалось
# ---------------------------------------------------------------------------

@router.get("/rating/top")
async def get_operators_rating(
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _RATING_SQL = """
        SELECT
            s.id, s.login, s.rating, s.created_at,
            COUNT(o.id) AS orders_count,
            COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) AS completed_count,
            SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub ELSE 0 END) AS total_volume_rub,
            AVG(CASE
                WHEN o.sla_requisites_setup_at IS NOT NULL AND o.sla_started_at IS NOT NULL
                THEN TIMESTAMPDIFF(SECOND, o.sla_started_at, o.sla_requisites_setup_at)
            END) AS avg_setup_seconds,
            AVG(CASE
                WHEN o.status = 'COMPLETED' AND o.completed_at IS NOT NULL AND o.sla_user_paid_at IS NOT NULL
                THEN TIMESTAMPDIFF(SECOND, o.sla_user_paid_at, o.completed_at)
            END) AS avg_close_seconds
        FROM supports s
        LEFT JOIN orders o ON o.support_id = s.id
        WHERE s.role = 'OPERATOR'
        GROUP BY s.id, s.login, s.rating, s.created_at
        ORDER BY s.rating DESC
    """

    rows = await db.execute(text(_RATING_SQL + " LIMIT 10"))

    def _format_op(r, position=None):
        d = {
            "id": r.id,
            "login": r.login,
            "username": r.login,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "orders_count": int(r.orders_count or 0),
            "completed_count": int(r.completed_count or 0),
            "total_volume_rub": float(r.total_volume_rub or 0),
            "avg_setup_seconds": float(r.avg_setup_seconds) if r.avg_setup_seconds else None,
            "avg_close_seconds": float(r.avg_close_seconds) if r.avg_close_seconds else None,
            "rating": {
                "overall_rating": float(r.rating or 0),
                "speed_rating": float(r.rating or 0),
                "user_rating": float(r.rating or 0),
                "orders_count": int(r.orders_count or 0),
                "details": {"orders_with_ratings": 0},
            },
        }
        if position is not None:
            d["position"] = position
        return d

    top_rows = list(rows)
    top = [_format_op(r) for r in top_rows]

    current_data = None
    if current_user.role == "OPERATOR":
        all_rows = await db.execute(text(_RATING_SQL))
        all_ops = list(all_rows)
        idx = next((i for i, r in enumerate(all_ops) if r.id == current_user.id), None)
        if idx is not None:
            current_data = _format_op(all_ops[idx], position=idx + 1)

    return {"top": top, "current": current_data}


# ---------------------------------------------------------------------------
# GET /:id/operator-orders  — список сделок оператора
# ---------------------------------------------------------------------------

@router.get("/{support_id}/operator-orders")
async def get_operator_orders(
    support_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    date_from: Optional[str] = Query(None),  # YYYY-MM-DD
    date_to: Optional[str] = Query(None),    # YYYY-MM-DD
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    # Build date range condition using full datetime to avoid DATE() timezone shift
    from datetime import datetime, timedelta
    date_parts = []
    date_from_dt: Optional[str] = None
    date_to_dt:   Optional[str] = None
    if date_from:
        date_from_dt = date_from + " 00:00:00"
        date_parts.append("o.completed_at >= :date_from_dt")
    if date_to:
        # include the full date_to day
        dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
        date_to_dt = dt_to.strftime("%Y-%m-%d 00:00:00")
        date_parts.append("o.completed_at < :date_to_dt")
    period_cond = " AND ".join(date_parts) if date_parts else "1=1"

    offset = (page - 1) * limit

    # BB rate (RUB per USDT)
    usdt_row = await db.execute(text(
        "SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'"
    ))
    usdt_rec = usdt_row.mappings().one_or_none()
    bb_rate = 0.0
    if usdt_rec:
        bb_rate = float(
            usdt_rec["manual_rate_rub"]
            if usdt_rec["is_manual"] and usdt_rec["manual_rate_rub"]
            else usdt_rec["rate_rub"] or 0
        )

    # Purchase rates per coin (USDT per 1 coin)
    try:
        purch_rows = await db.execute(text("""
            SELECT p.coin, p.amount_usdt / p.amount_coin AS usdt_per_coin, p.usdt_rate_rub
            FROM crypto_purchases p
            INNER JOIN (
                SELECT coin, MAX(created_at) AS max_ts FROM crypto_purchases GROUP BY coin
            ) latest ON latest.coin = p.coin AND latest.max_ts = p.created_at
        """))
        purchase_rates: dict = {
            r["coin"]: {"usdt_per_coin": float(r["usdt_per_coin"] or 0), "usdt_rate_rub": float(r["usdt_rate_rub"] or bb_rate)}
            for r in purch_rows.mappings()
        }
    except Exception:
        purchase_rates = {}

    # Operator role + cashier fee
    sup_row = await db.execute(
        text("SELECT role, rate_percent FROM supports WHERE id = :id"), {"id": support_id}
    )
    sup = sup_row.mappings().one_or_none()
    sup_role = (sup["role"] if sup else None) or "OPERATOR"
    cashier_fee_pct = float(sup["rate_percent"] if sup else 0) or 0.0

    # ── Total volume (all time, only completed)
    total_vol_row = await db.execute(
        text("SELECT COALESCE(SUM(sum_rub), 0) FROM orders WHERE support_id = :sid AND status = 'COMPLETED'"),
        {"sid": support_id},
    )
    total_volume_rub = float(total_vol_row.scalar() or 0)

    # Shared params dict for date-range queries
    date_params: dict = {"sid": support_id}
    if date_from_dt:
        date_params["date_from_dt"] = date_from_dt
    if date_to_dt:
        date_params["date_to_dt"] = date_to_dt

    # ── Aggregates for period (by dir+coin) — for profit summary
    period_where = f"o.support_id = :sid AND o.status = 'COMPLETED' AND {period_cond}"
    agg_rows = await db.execute(
        text(f"""
            SELECT o.dir, o.coin,
                   SUM(o.sum_rub)      AS sum_rub_total,
                   SUM(o.amount_coin)  AS amount_coin_total
            FROM orders o
            WHERE {period_where}
            GROUP BY o.dir, o.coin
        """),
        date_params,
    )
    period_volume_rub = 0.0
    period_profit_usdt = 0.0
    for agg in agg_rows.mappings():
        s_rub = float(agg["sum_rub_total"] or 0)
        a_coin = float(agg["amount_coin_total"] or 0)
        period_volume_rub += s_rub
        if agg["dir"] == "BUY":
            pr = purchase_rates.get(agg["coin"], {})
            usdt_per_coin = pr.get("usdt_per_coin", 0)
            purch_usdt_rate = pr.get("usdt_rate_rub", bb_rate) or bb_rate
            payout_usdt = a_coin * usdt_per_coin
            if sup_role == "CASHIER":
                received_usdt = s_rub * (1.0 - cashier_fee_pct / 100.0) / purch_usdt_rate if purch_usdt_rate > 0 else 0.0
            else:
                received_usdt = s_rub / bb_rate if bb_rate > 0 else 0.0
            period_profit_usdt += received_usdt - payout_usdt

    # ── Paginated order list
    page_params = {**date_params, "lim": limit, "off": offset}
    rows = await db.execute(text(f"""
        SELECT
            o.id, o.unique_id, o.dir, o.coin,
            o.sum_rub, o.amount_coin, o.rate_rub,
            o.status, o.created_at, o.completed_at,
            CASE
                WHEN o.completed_at IS NOT NULL AND o.sla_started_at IS NOT NULL
                THEN TIMESTAMPDIFF(SECOND, o.sla_started_at, o.completed_at)
            END AS close_seconds
        FROM orders o
        WHERE {period_where}
        ORDER BY o.completed_at DESC
        LIMIT :lim OFFSET :off
    """), page_params)

    count_row = await db.execute(
        text(f"SELECT COUNT(id) FROM orders o WHERE {period_where}"),
        date_params,
    )
    total = count_row.scalar() or 0

    orders = []
    for r in rows:
        coin = r.coin
        sum_rub = float(r.sum_rub or 0)
        amount_coin = float(r.amount_coin or 0)

        pr = purchase_rates.get(coin, {})
        usdt_per_coin = pr.get("usdt_per_coin", 0)
        purch_usdt_rate = pr.get("usdt_rate_rub", bb_rate) or bb_rate
        payout_usdt = amount_coin * usdt_per_coin

        if r.dir == "BUY":
            if sup_role == "CASHIER":
                received_usdt = sum_rub * (1.0 - cashier_fee_pct / 100.0) / purch_usdt_rate if purch_usdt_rate > 0 else 0.0
            else:
                received_usdt = sum_rub / bb_rate if bb_rate > 0 else 0.0
            profit_usdt = round(received_usdt - payout_usdt, 4)
        else:
            profit_usdt = None

        orders.append({
            "id": r.id,
            "unique_id": r.unique_id,
            "dir": r.dir,
            "coin": coin,
            "sum_rub": sum_rub,
            "amount_coin": amount_coin,
            "rate_rub": float(r.rate_rub or 0),
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "close_seconds": int(r.close_seconds) if r.close_seconds is not None else None,
            "profit_usdt": profit_usdt,
        })

    return {
        "orders": orders,
        "total": total,
        "pages": -(-total // limit),
        "page": page,
        "stats": {
            "total_volume_rub": total_volume_rub,
            "period_volume_rub": period_volume_rub,
            "period_profit_usdt": round(period_profit_usdt, 4),
            "bb_rate": round(bb_rate, 2),
        },
    }


# ---------------------------------------------------------------------------
# GET /me/debt
# ---------------------------------------------------------------------------

@router.get("/me/debt")
async def get_my_debt(
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    return await debt_svc.get_aggregate_debt(db, current_user.id)


# ---------------------------------------------------------------------------
# POST /me/debt/intents
# ---------------------------------------------------------------------------

@router.post("/me/debt/intents", status_code=201)
async def create_my_debt_intent(
    body: dict,
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    requested = body.get("requested_usdt")
    if requested is None:
        raise HTTPException(400, "requested_usdt is required")
    try:
        intent = await debt_svc.create_payment_intent(db, current_user.id, float(requested))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return intent


# ---------------------------------------------------------------------------
# GET /me/debt/intents/{intent_id}
# ---------------------------------------------------------------------------

@router.get("/me/debt/intents/{intent_id}")
async def get_my_debt_intent_status(
    intent_id: int,
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await debt_svc.get_intent_status(db, current_user.id, intent_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---------------------------------------------------------------------------
# POST /me/debt/payments  (ручной ввод tx_hash оператором)
# ---------------------------------------------------------------------------

@router.post("/me/debt/payments", status_code=201)
async def create_my_debt_payment(
    body: dict,
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    intent_id = body.get("intent_id")
    tx_hash = body.get("tx_hash")
    if not intent_id or not tx_hash:
        raise HTTPException(400, "intent_id and tx_hash are required")
    try:
        payment = await debt_svc._validate_and_create_payment(
            db, current_user.id, int(intent_id), str(tx_hash),
            float(body["declared_amount_usdt"]) if body.get("declared_amount_usdt") else None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return payment


# ---------------------------------------------------------------------------
# GET /me/debt/payments
# ---------------------------------------------------------------------------

@router.get("/me/debt/payments")
async def get_my_debt_payments(
    limit: int = Query(500, ge=1, le=500),
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    return await debt_svc.get_payments_history(db, support_id=current_user.id, limit=limit)


# ---------------------------------------------------------------------------
# GET /debt/payments/history  (менеджер/суперадмин)
# ---------------------------------------------------------------------------

@router.get("/debt/payments/history")
async def get_debt_payments_history(
    limit: int = Query(500, ge=1, le=500),
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    return await debt_svc.get_payments_history(db, support_id=None, limit=limit)


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get("/")
async def get_supports(
    search: str = Query(""),
    status: str = Query("all"),
    role: str = Query("all"),
    sortBy: str = Query("created_at"),
    sortOrder: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    sort_map = {
        "created_at": "s.created_at",
        "rating": "s.rating",
        "rate_percent": "s.rate_percent",
    }
    sort_field = sort_map.get(sortBy, "s.created_at")
    sort_dir = "DESC" if sortOrder.lower() == "desc" else "ASC"
    offset = (page - 1) * limit

    where_parts = ["1=1"]
    params: dict = {}

    if search:
        where_parts.append("(s.login LIKE :search)")
        params["search"] = f"%{search}%"
    if status == "active":
        where_parts.append("s.is_active = 1")
    elif status == "offline":
        where_parts.append("s.is_active = 0")
    if role != "all":
        where_parts.append("s.role = :role")
        params["role"] = role

    where = " AND ".join(where_parts)

    query = text(f"""
        SELECT
            s.id, s.login, s.role, s.manager_id, s.chat_language,
            s.can_write_chat, s.can_cancel_order, s.can_edit_requisites, s.can_use_coupons,
            s.is_active, s.active_limit, s.rate_percent, s.rating,
            s.deposit, s.deposit_paid, s.deposit_work, s.created_at,
            COALESCE(os.orders_count, 0) AS orders_count,
            COALESCE(os.completed_orders, 0) AS completed_orders,
            COALESCE(os.cancelled_orders, 0) AS cancelled_orders
        FROM supports s
        LEFT JOIN (
            SELECT support_id,
                COUNT(id) AS orders_count,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
                COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_orders
            FROM orders WHERE support_id IS NOT NULL GROUP BY support_id
        ) os ON s.id = os.support_id
        WHERE {where}
        ORDER BY {sort_field} {sort_dir}
        LIMIT :limit OFFSET :offset
    """)
    params["limit"] = limit
    params["offset"] = offset

    count_query = text(f"SELECT COUNT(DISTINCT s.id) AS total FROM supports s WHERE {where}")

    rows = await db.execute(query, params)
    count_row = await db.execute(count_query, {k: v for k, v in params.items() if k not in ("limit", "offset")})

    supports = [dict(r._mapping) for r in rows]
    total = count_row.scalar()

    for s in supports:
        flat = float(s.get("rating") or 0)
        s["rating"] = {"overall_rating": flat, "speed_rating": flat, "user_rating": flat}

    return {
        "supports": supports,
        "total": total,
        "pages": -(-total // limit),  # ceil division
        "currentPage": page,
    }


# ---------------------------------------------------------------------------
# POST /
# ---------------------------------------------------------------------------

@router.post("/", status_code=201)
async def create_support(
    body: SupportCreateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    chat_language = _normalize_chat_language(body.chat_language, "RU")
    if not chat_language:
        raise HTTPException(400, "chat_language must be RU or EN")

    can_write = _normalize_flag(body.can_write_chat)
    can_cancel = _normalize_flag(body.can_cancel_order)
    can_edit = _normalize_flag(body.can_edit_requisites)
    if None in (can_write, can_cancel, can_edit):
        raise HTTPException(400, "Permission flags must be boolean values")

    deposit = float(body.deposit or body.deposit_work or 0)

    existing = await db.execute(select(Support).where(Support.login == body.login))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Оператор с таким login уже существует")

    pass_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    support = Support(
        login=body.login,
        pass_hash=pass_hash,
        role=body.role.upper(),
        chat_language=chat_language,
        can_write_chat=can_write,
        can_cancel_order=can_cancel,
        can_edit_requisites=can_edit,
        can_use_coupons=_normalize_flag(getattr(body, 'can_use_coupons', 0)),
        rating=100,
        deposit=deposit,
        deposit_paid=0,
        deposit_work=0,
        rate_percent=body.rate_percent,
    )
    db.add(support)
    await db.flush()
    return {"message": "Оператор создан", "id": support.id}


# ---------------------------------------------------------------------------
# PATCH /:id/salary
# ---------------------------------------------------------------------------

class SalaryUpdateRequest(BaseModel):
    daily_rate_usd: float = 0.0
    per_order_rate_usd: float = 0.0

@router.patch("/{support_id}/salary")
async def update_operator_salary(
    support_id: int,
    body: SalaryUpdateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(text("""
        UPDATE supports SET daily_rate_usd = :daily, per_order_rate_usd = :per_order
        WHERE id = :id
    """), {"daily": body.daily_rate_usd, "per_order": body.per_order_rate_usd, "id": support_id})
    await db.commit()
    return {"success": True, "daily_rate_usd": body.daily_rate_usd, "per_order_rate_usd": body.per_order_rate_usd}


# ---------------------------------------------------------------------------
# GET /:id
# ---------------------------------------------------------------------------

@router.get("/{support_id}")
async def get_support_by_id(
    support_id: int,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("""
        SELECT
            s.id, s.login, s.role, s.manager_id, s.chat_language,
            s.can_write_chat, s.can_cancel_order, s.can_edit_requisites, s.can_use_coupons,
            s.is_active, s.active_limit, s.rate_percent, s.rating,
            s.deposit, s.deposit_paid, s.deposit_work, s.created_at,
            COALESCE(os.current_orders, 0) AS current_orders,
            COALESCE(os.orders_count, 0) AS orders_count,
            COALESCE(os.completed_orders, 0) AS completed_orders,
            COALESCE(os.cancelled_orders, 0) AS cancelled_orders,
            CASE
                WHEN s.is_active = 0 THEN 'offline'
                WHEN COALESCE(os.current_orders, 0) >= s.active_limit THEN 'busy'
                ELSE 'active'
            END AS status
        FROM supports s
        LEFT JOIN (
            SELECT support_id,
                COUNT(CASE WHEN status IN ('QUEUED','PAYMENT_PENDING','AWAITING_CONFIRM','AWAITING_HASH') THEN 1 END) AS current_orders,
                COUNT(id) AS orders_count,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
                COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_orders
            FROM orders WHERE support_id IS NOT NULL GROUP BY support_id
        ) os ON s.id = os.support_id
        WHERE s.id = :id
    """), {"id": support_id})

    support = row.mappings().one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")
    s = dict(support)
    flat = float(s.get("rating") or 0)
    s["rating"] = {"overall_rating": flat, "speed_rating": flat, "user_rating": flat}
    return s


# ---------------------------------------------------------------------------
# GET /:id/credentials
# ---------------------------------------------------------------------------

@router.get("/{support_id}/credentials")
async def get_credentials(
    support_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Support.login, Support.role).where(Support.id == support_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Оператор не найден")
    return {"login": row.login, "password": "**скрыт**", "role": row.role}


# ---------------------------------------------------------------------------
# GET /:id/debt
# ---------------------------------------------------------------------------

@router.get("/{support_id}/debt")
async def get_support_debt(
    support_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    return await debt_svc.get_aggregate_debt(db, support_id)


# ---------------------------------------------------------------------------
# POST /:id/debt/write-off
# ---------------------------------------------------------------------------

@router.post("/{support_id}/debt/write-off")
async def write_off_support_debt(
    support_id: int,
    body: Optional[dict] = None,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    requested = (body or {}).get("requested_usdt")
    try:
        return await debt_svc.write_off_debt_by_superadmin(
            db, support_id,
            requested_usdt=float(requested) if requested is not None else None,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# POST /:id/debt/intents
# ---------------------------------------------------------------------------

@router.post("/{support_id}/debt/intents", status_code=201)
async def create_support_debt_intent(
    support_id: int,
    body: dict,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    requested = body.get("requested_usdt")
    if requested is None:
        raise HTTPException(400, "requested_usdt is required")
    try:
        return await debt_svc.create_payment_intent(db, support_id, float(requested))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# GET /:id/debt/intents/{intent_id}
# ---------------------------------------------------------------------------

@router.get("/{support_id}/debt/intents/{intent_id}")
async def get_support_debt_intent_status(
    support_id: int,
    intent_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await debt_svc.get_intent_status(db, support_id, intent_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---------------------------------------------------------------------------
# GET /:id/debt/payments
# ---------------------------------------------------------------------------

@router.get("/{support_id}/debt/payments")
async def get_support_debt_payments(
    support_id: int,
    limit: int = Query(500, ge=1, le=500),
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    return await debt_svc.get_payments_history(db, support_id=support_id, limit=limit)


# ---------------------------------------------------------------------------
# PUT /:id
# ---------------------------------------------------------------------------

@router.put("/{support_id}")
async def update_support(
    support_id: int,
    body: SupportUpdateRequest,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Support).where(Support.id == support_id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")

    # Проверка уникальности login
    dup = await db.execute(
        select(Support.id).where(Support.login == body.login, Support.id != support_id)
    )
    if dup.scalar_one_or_none():
        raise HTTPException(400, "Оператор с таким логином уже существует")

    support.login = body.login
    support.role = body.role.upper()
    if body.deposit is not None or body.deposit_work is not None:
        support.deposit = float(body.deposit if body.deposit is not None else body.deposit_work)

    if body.rate_percent is not None:
        support.rate_percent = body.rate_percent
    if body.chat_language is not None:
        lang = _normalize_chat_language(body.chat_language, None)
        if not lang:
            raise HTTPException(400, "chat_language must be RU or EN")
        support.chat_language = lang
    if body.can_write_chat is not None:
        support.can_write_chat = _normalize_flag(body.can_write_chat)
    if body.can_cancel_order is not None:
        support.can_cancel_order = _normalize_flag(body.can_cancel_order)
    if body.can_edit_requisites is not None:
        support.can_edit_requisites = _normalize_flag(body.can_edit_requisites)
    if body.can_use_coupons is not None:
        support.can_use_coupons = _normalize_flag(body.can_use_coupons)

    if body.password and body.password.strip():
        if len(body.password) < 6:
            raise HTTPException(400, "Пароль должен содержать минимум 6 символов")
        support.pass_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
        await db.commit()
        return {"message": "Данные оператора и пароль обновлены"}

    await db.commit()
    return {"message": "Данные оператора обновлены"}


# ---------------------------------------------------------------------------
# DELETE /:id
# ---------------------------------------------------------------------------

@router.delete("/{support_id}")
async def delete_support(
    support_id: int,
    current_user: Support = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Support).where(Support.id == support_id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")
    if support.id == current_user.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    await db.delete(support)
    await db.commit()
    return {"message": "Оператор удалён"}


# ---------------------------------------------------------------------------
# PATCH /:id/status
# ---------------------------------------------------------------------------

@router.patch("/{support_id}/status")
async def update_support_status(
    support_id: int,
    body: StatusUpdateRequest,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Support).where(Support.id == support_id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")
    support.is_active = body.status != "offline"
    await db.commit()
    return {"message": "Статус обновлен"}


# ---------------------------------------------------------------------------
# PATCH /:id/max-orders
# ---------------------------------------------------------------------------

@router.patch("/{support_id}/max-orders")
async def update_max_orders(
    support_id: int,
    body: MaxOrdersUpdateRequest,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    if not (1 <= body.maxOrders <= 50):
        raise HTTPException(400, "Максимум заказов должен быть от 1 до 50")
    result = await db.execute(select(Support).where(Support.id == support_id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")
    support.active_limit = body.maxOrders
    await db.commit()
    return {"message": "Лимит заказов обновлен"}


# ---------------------------------------------------------------------------
# PATCH /:id/deposit
# ---------------------------------------------------------------------------

@router.patch("/{support_id}/deposit")
async def update_deposit(
    support_id: int,
    body: DepositUpdateRequest,
    current_user: Support = Depends(require_manager_up),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Support).where(Support.id == support_id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(404, "Оператор не найден")

    if body.deposit is not None or body.deposit_work is not None:
        support.deposit = float(body.deposit if body.deposit is not None else body.deposit_work)

    await db.commit()
    return {"message": "Deposits updated"}


# ---------------------------------------------------------------------------
# Operator crypto deposit — self-service (same flow as cashier deposit)
# ---------------------------------------------------------------------------

class OperatorDepositTopupRequest(BaseModel):
    tx_hash: str
    coin: str = "USDT"


@router.get("/me/deposit")
async def get_my_deposit(
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    from app.routers.cashiers import _get_deposit_wallet, _get_coin_rate_rub, DEPOSIT_COINS

    dep_row = await db.execute(
        text("SELECT deposit, deposit_paid, deposit_work FROM supports WHERE id = :uid"),
        {"uid": current_user.id},
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
        "wallets": wallets,
        "rates": rates,
    }


@router.get("/me/deposit/history")
async def get_my_deposit_history(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Support = Depends(require_roles("OPERATOR")),
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
        items = []
        total = 0
    return {"items": items, "total": total, "pages": max(1, -(-total // limit)), "page": page}


@router.post("/me/deposit/topup")
async def topup_my_deposit(
    body: OperatorDepositTopupRequest,
    current_user: Support = Depends(require_roles("OPERATOR")),
    db: AsyncSession = Depends(get_db),
):
    from app.routers.cashiers import (
        DEPOSIT_COINS, _get_deposit_wallet, _get_coin_rate_rub,
        _verify_btc_ltc, _verify_usdt_trc20,
    )

    coin = body.coin.upper()
    if coin not in DEPOSIT_COINS:
        raise HTTPException(400, f"Неподдерживаемая монета. Допустимые: {', '.join(DEPOSIT_COINS)}")

    tx_hash = body.tx_hash.strip()
    if len(tx_hash) != 64:
        raise HTTPException(400, "Неверный формат хеша транзакции (должно быть 64 символа)")

    if coin in ("BTC", "LTC"):
        tx_hash = tx_hash.lower()

    dup = await db.execute(
        text("SELECT id, status, cashier_id FROM cashier_deposits WHERE tx_hash = :tx"),
        {"tx": tx_hash},
    )
    existing = dup.mappings().one_or_none()
    if existing:
        if existing["status"] == "CONFIRMED":
            raise HTTPException(400, "Эта транзакция уже была зачтена")
        elif existing["status"] == "PENDING":
            raise HTTPException(400, "Эта транзакция уже ожидает подтверждения")
        elif existing["status"] == "REJECTED" and int(existing["cashier_id"]) != current_user.id:
            raise HTTPException(400, "Этот хеш транзакции уже был использован другим пользователем")

    system_address = await _get_deposit_wallet(db, coin)
    if not system_address:
        raise HTTPException(500, f"Адрес депозита {coin} не настроен. Обратитесь к администратору.")

    if coin in ("BTC", "LTC"):
        received_amount = await _verify_btc_ltc(tx_hash, system_address, coin)
    else:
        received_amount = await _verify_usdt_trc20(tx_hash, system_address)

    coin_rate_rub = await _get_coin_rate_rub(db, coin)
    if coin_rate_rub <= 0:
        raise HTTPException(500, f"Курс {coin} не найден. Повторите позже.")

    amount_rub = round(received_amount * coin_rate_rub, 2)

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
