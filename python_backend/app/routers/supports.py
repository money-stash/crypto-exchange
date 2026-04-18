import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query
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
    rows = await db.execute(
        text("SELECT id, login, rating FROM supports WHERE role = 'OPERATOR' ORDER BY rating DESC LIMIT 10")
    )
    top = [{"id": r.id, "login": r.login, "username": r.login, "rating": r.rating} for r in rows]

    current_data = None
    if current_user.role == "OPERATOR":
        all_rows = await db.execute(
            text("SELECT id, login, rating FROM supports WHERE role = 'OPERATOR' ORDER BY rating DESC")
        )
        all_ops = list(all_rows)
        idx = next((i for i, r in enumerate(all_ops) if r.id == current_user.id), None)
        if idx is not None:
            op = all_ops[idx]
            current_data = {"id": op.id, "login": op.login, "username": op.login, "rating": op.rating, "position": idx + 1}

    return {"top": top, "current": current_data}


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
            s.can_write_chat, s.can_cancel_order, s.can_edit_requisites,
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

    deposit_paid = float(body.deposit_paid or 0)
    deposit_work = float(body.deposit_work if body.deposit_work is not None else (body.deposit or 0))

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
        rating=100,
        deposit=deposit_work,
        deposit_paid=deposit_paid,
        deposit_work=deposit_work,
        rate_percent=body.rate_percent,
    )
    db.add(support)
    await db.flush()
    return {"message": "Оператор создан", "id": support.id}


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
            s.can_write_chat, s.can_cancel_order, s.can_edit_requisites,
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
    support.deposit_paid = body.deposit_paid or 0
    deposit_work = body.deposit_work if body.deposit_work is not None else (body.deposit or 0)
    support.deposit_work = deposit_work
    support.deposit = deposit_work

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

    if body.deposit_paid is not None:
        support.deposit_paid = body.deposit_paid
    if body.deposit_work is not None or body.deposit is not None:
        dw = body.deposit_work if body.deposit_work is not None else body.deposit
        support.deposit_work = dw
        support.deposit = dw

    await db.commit()
    return {"message": "Deposits updated"}
