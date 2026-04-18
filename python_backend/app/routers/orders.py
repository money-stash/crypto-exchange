from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import logging, os, shutil, uuid

from app.database import get_db
from app.middleware.auth import get_current_user, require_auth
from app.models.support import Support
import app.socket.socket_service as sio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/orders", tags=["orders"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _order_where(role: str, user_id: int, filters: dict) -> tuple[str, dict]:
    """Собирает WHERE-клаузу и параметры под роль и фильтры фронтенда."""
    parts = ["1=1"]
    params: dict = {}

    # Ограничения по роли
    if role == "OPERATOR":
        parts.append("o.support_id = :uid")
        params["uid"] = user_id
    elif role == "EX_ADMIN":
        parts.append("o.bot_id IN (SELECT id FROM bots WHERE owner_id = :uid)")
        params["uid"] = user_id
    # SUPERADMIN / MANAGER видят всё

    # Фильтры из запроса
    if filters.get("status") and filters["status"] != "all":
        parts.append("o.status = :status")
        params["status"] = filters["status"]
    if filters.get("dir"):
        parts.append("o.dir = :dir")
        params["dir"] = filters["dir"].upper()
    if filters.get("coin"):
        parts.append("o.coin = :coin")
        params["coin"] = filters["coin"].upper()
    if filters.get("bot_id"):
        parts.append("o.bot_id = :bot_id")
        params["bot_id"] = int(filters["bot_id"])
    if filters.get("support_id"):
        parts.append("o.support_id = :support_id")
        params["support_id"] = int(filters["support_id"])
    if filters.get("search"):
        parts.append("(o.unique_id LIKE :search OR u.username LIKE :search OR u.tg_id LIKE :search)")
        params["search"] = f"%{filters['search']}%"
    if filters.get("date_from"):
        parts.append("o.created_at >= :date_from")
        params["date_from"] = filters["date_from"]
    if filters.get("date_to"):
        parts.append("o.created_at <= :date_to")
        params["date_to"] = filters["date_to"]

    return " AND ".join(parts), params


ORDER_SELECT = """
    SELECT
        o.*,
        u.tg_id, u.username AS user_username,
        s.login AS support_login,
        b.name AS bot_name,
        (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') AS unread_messages
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN supports s ON s.id = o.support_id
    LEFT JOIN bots b ON b.id = o.bot_id
"""


# ---------------------------------------------------------------------------
# GET /available/support  — ДО /:id
# ---------------------------------------------------------------------------

@router.get("/available/support")
async def get_available_orders(
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    where = "o.status = 'QUEUED' AND o.support_id IS NULL"
    params: dict = {}

    if current_user.role == "EX_ADMIN":
        where += " AND o.bot_id IN (SELECT id FROM bots WHERE owner_id = :uid)"
        params["uid"] = current_user.id

    rows = await db.execute(text(f"{ORDER_SELECT} WHERE {where} ORDER BY o.created_at ASC LIMIT 50"), params)
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# GET /stats/operator
# ---------------------------------------------------------------------------

@router.get("/stats/operator")
async def get_operator_stats(
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("OPERATOR", "SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Access denied")

    uid = current_user.id
    row = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed,
            COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled,
            COUNT(CASE WHEN status IN ('QUEUED','PAYMENT_PENDING','AWAITING_CONFIRM','AWAITING_HASH') THEN 1 END) AS active
        FROM orders WHERE support_id = :uid
    """), {"uid": uid})
    stats = dict(row.mappings().one())

    support = await db.execute(text("SELECT rating, deposit, deposit_paid, deposit_work FROM supports WHERE id = :uid"), {"uid": uid})
    sup = dict(support.mappings().one())
    return {**stats, **sup}


# ---------------------------------------------------------------------------
# GET /stats/operator/chart
# ---------------------------------------------------------------------------

@router.get("/stats/operator/chart")
async def get_operator_chart_data(
    days: int = Query(7, ge=1, le=365),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("OPERATOR", "SUPERADMIN"):
        raise HTTPException(403, "Access denied")

    rows = await db.execute(text("""
        SELECT
            DATE(completed_at) AS date,
            COUNT(*) AS completed,
            SUM(sum_rub) AS volume_rub
        FROM orders
        WHERE support_id = :uid
          AND status = 'COMPLETED'
          AND completed_at >= DATE_SUB(NOW(), INTERVAL :days DAY)
        GROUP BY DATE(completed_at)
        ORDER BY date ASC
    """), {"uid": current_user.id, "days": days})
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get("/")
async def get_orders(
    status: Optional[str] = None,
    dir: Optional[str] = None,
    coin: Optional[str] = None,
    bot_id: Optional[int] = None,
    support_id: Optional[int] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sortBy: str = Query("created_at"),
    sortOrder: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    filters = {k: v for k, v in {
        "status": status, "dir": dir, "coin": coin,
        "bot_id": bot_id, "support_id": support_id,
        "search": search, "date_from": date_from, "date_to": date_to,
    }.items() if v is not None}

    where, params = _order_where(current_user.role, current_user.id, filters)
    sort_field = "o.created_at" if sortBy == "created_at" else f"o.{sortBy}"
    sort_dir = "DESC" if sortOrder.lower() == "desc" else "ASC"
    params.update({"limit": limit, "offset": (page - 1) * limit})

    rows = await db.execute(
        text(f"{ORDER_SELECT} WHERE {where} ORDER BY {sort_field} {sort_dir} LIMIT :limit OFFSET :offset"),
        params,
    )
    count_row = await db.execute(
        text(f"SELECT COUNT(*) AS total FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    orders = [dict(r._mapping) for r in rows]
    total = count_row.scalar()

    return {"orders": orders, "total": total, "pages": -(-total // limit), "page": page}


# ---------------------------------------------------------------------------
# GET /:id
# ---------------------------------------------------------------------------

@router.get("/{order_id}")
async def get_order_details(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id}
    )
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    order = dict(order)

    if current_user.role == "OPERATOR" and order.get("support_id") != current_user.id:
        raise HTTPException(403, "Access denied")

    return order


# ---------------------------------------------------------------------------
# POST /:id/cancel
# ---------------------------------------------------------------------------

@router.post("/{order_id}/cancel")
async def cancel_order(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    order = dict(order)

    if current_user.role == "OPERATOR":
        if not current_user.can_cancel_order:
            raise HTTPException(403, "Оператору запрещено отменять сделки")
        if order.get("support_id") != current_user.id:
            raise HTTPException(403, "Access denied")
        if order.get("status") == "AWAITING_HASH":
            raise HTTPException(403, "После подтверждения оплаты оператором отмена заявки недоступна")

    await db.execute(
        text("UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = :id"),
        {"id": order_id},
    )
    updated = await db.execute(
        text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id}
    )
    updated_order = dict(updated.mappings().one())
    await sio.emit_order_status_changed({
        "orderId": order_id,
        "oldStatus": order["status"],
        "newStatus": "CANCELLED",
        "order": updated_order,
    })
    return {"success": True, "message": "Order cancelled", "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# POST /:id/take
# ---------------------------------------------------------------------------

@router.post("/{order_id}/take")
async def take_order(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id FOR UPDATE"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    order = dict(order)

    if order["status"] != "QUEUED":
        raise HTTPException(400, "Invalid order status")
    if order.get("support_id") is not None:
        raise HTTPException(409, "Order is already assigned")

    # Проверка лимита активных заявок
    active_count_row = await db.execute(text("""
        SELECT COUNT(*) AS cnt FROM orders
        WHERE support_id = :uid AND status IN ('QUEUED','PAYMENT_PENDING','AWAITING_CONFIRM','AWAITING_HASH')
    """), {"uid": current_user.id})
    active_count = active_count_row.scalar()
    if active_count >= (current_user.active_limit or 4):
        raise HTTPException(400, "Active limit exceeded")

    await db.execute(
        text("UPDATE orders SET support_id = :uid, status = 'QUEUED', updated_at = NOW() WHERE id = :id"),
        {"uid": current_user.id, "id": order_id},
    )
    await db.commit()  # commit before socket emit to avoid race condition

    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated.mappings().one())

    await sio.emit_order_taken(updated_order)
    await sio.emit_order_updated(updated_order)

    # Notify user in Telegram
    try:
        from bot.manager import bot_manager
        tg_row = await db.execute(
            text("SELECT u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
            {"id": order_id},
        )
        tg_data = tg_row.fetchone()
        bot_id = updated_order.get("bot_id")
        unique_id = updated_order.get("unique_id")
        if tg_data and bot_id:
            await bot_manager.send_message(
                bot_id,
                int(tg_data.tg_id),
                f"✅ <b>Ваша заявка #{unique_id} принята оператором!</b>\n\n"
                f"Вы можете задавать вопросы прямо здесь — оператор ответит вам в ближайшее время.",
                parse_mode="HTML",
            )
    except Exception as e:
        logger.warning(f"Failed to notify user after order {order_id} taken: {e}")

    return {"success": True, "message": "Order assigned successfully"}


# ---------------------------------------------------------------------------
# POST /:id/requisites
# ---------------------------------------------------------------------------

@router.post("/{order_id}/requisites")
async def set_order_requisites(
    order_id: int,
    body: dict,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")

    fields = []
    params: dict = {"id": order_id}

    if body.get("card_number"):
        fields.append("exch_card_number = :card_number"); params["card_number"] = body["card_number"]
    if body.get("card_holder"):
        fields.append("exch_card_holder = :card_holder"); params["card_holder"] = body["card_holder"]
    if body.get("bank_name"):
        fields.append("exch_bank_name = :bank_name"); params["bank_name"] = body["bank_name"]
    if body.get("crypto_address"):
        fields.append("exch_crypto_address = :crypto_address"); params["crypto_address"] = body["crypto_address"]
    if body.get("sbp_phone"):
        fields.append("exch_sbp_phone = :sbp_phone"); params["sbp_phone"] = body["sbp_phone"]
    if body.get("req_id"):
        fields.append("req_id = :req_id"); params["req_id"] = body["req_id"]
    if body.get("label"):
        fields.append("support_note = :label"); params["label"] = body["label"]

    if fields:
        fields.append("sla_requisites_setup_at = NOW()")
        fields.append("updated_at = NOW()")
        await db.execute(text(f"UPDATE orders SET {', '.join(fields)} WHERE id = :id"), params)

    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated.mappings().one())
    await sio.emit_order_updated(updated_order)

    return {"success": True, "message": "Requisites updated successfully"}


# ---------------------------------------------------------------------------
# GET /:id/messages
# ---------------------------------------------------------------------------

@router.get("/{order_id}/messages")
async def get_messages(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("SELECT * FROM deal_messages WHERE order_id = :id ORDER BY created_at ASC"),
        {"id": order_id},
    )
    messages = [dict(r._mapping) for r in rows]

    # Помечаем как прочитанные
    await db.execute(
        text("UPDATE deal_messages SET is_read = 1 WHERE order_id = :id AND sender_type = 'USER' AND is_read = 0"),
        {"id": order_id},
    )
    return messages


# ---------------------------------------------------------------------------
# POST /:id/messages
# ---------------------------------------------------------------------------

UPLOAD_DIR = "uploads/chats"

@router.post("/{order_id}/messages")
async def send_message(
    order_id: int,
    request: Request,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "OPERATOR" and not current_user.can_write_chat:
        raise HTTPException(403, "Оператору запрещено писать в чат")

    content_type = request.headers.get("content-type", "")
    attachment_path = None
    text_msg = ""

    if "multipart/form-data" in content_type:
        form = await request.form()
        text_msg = (form.get("message") or "").strip()
        attachment = form.get("attachment")
        if attachment and hasattr(attachment, "filename"):
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            ext = os.path.splitext(attachment.filename or "")[1]
            filename = f"order-chat-{uuid.uuid4().hex}{ext}"
            file_path = os.path.join(UPLOAD_DIR, filename)
            with open(file_path, "wb") as f:
                shutil.copyfileobj(attachment.file, f)
            attachment_path = f"/uploads/chats/{filename}"
    else:
        # JSON body: {"message": "text"}
        try:
            body = await request.json()
            text_msg = (body.get("message") or "").strip()
        except Exception:
            text_msg = ""

    if not text_msg and not attachment_path:
        raise HTTPException(400, "Сообщение не может быть пустым")

    display_message = text_msg or ("Изображение" if attachment_path else "Файл")

    result = await db.execute(text("""
        INSERT INTO deal_messages (order_id, sender_type, sender_id, message, attachments_path, created_at)
        VALUES (:order_id, 'OPERATOR', :sender_id, :message, :att, NOW())
    """), {"order_id": order_id, "sender_id": current_user.id, "message": display_message, "att": attachment_path})

    msg_id = result.lastrowid
    await db.commit()  # commit before socket emit

    row = await db.execute(text("SELECT * FROM deal_messages WHERE id = :id"), {"id": msg_id})
    msg = dict(row.mappings().one())

    order_row = await db.execute(
        text("SELECT o.bot_id, o.support_id, u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
        {"id": order_id},
    )
    order_info = dict(order_row.mappings().one())

    try:
        await sio.emit_order_message({**msg, "bot_id": order_info.get("bot_id"), "support_id": order_info.get("support_id")})
    except Exception as e:
        logger.warning(f"Failed to emit order:message for order {order_id}: {e}")

    # Forward operator message to user in Telegram
    try:
        from bot.manager import bot_manager
        bot_id = order_info.get("bot_id")
        tg_id = order_info.get("tg_id")
        if bot_id and tg_id and text_msg:
            operator_login = current_user.login or "Оператор"
            await bot_manager.send_message(
                bot_id,
                int(tg_id),
                f"💬 <b>{operator_login}:</b> {text_msg}",
                parse_mode="HTML",
            )
    except Exception as e:
        logger.warning(f"Failed to forward operator message to user for order {order_id}: {e}")

    return msg


# ---------------------------------------------------------------------------
# PATCH /:id/amount  — оператор/менеджер изменяет сумму сделки
# ---------------------------------------------------------------------------

@router.patch("/{order_id}/amount")
async def update_order_amount(
    order_id: int,
    body: dict,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    order = dict(order)

    if order["status"] in ("COMPLETED", "CANCELLED"):
        raise HTTPException(400, "Нельзя изменить сумму завершённой или отменённой заявки")

    if current_user.role == "OPERATOR" and order.get("support_id") != current_user.id:
        raise HTTPException(403, "Access denied")

    rate_rub = float(order.get("rate_rub") or 0)
    if rate_rub <= 0:
        raise HTTPException(400, "Курс заявки недоступен для пересчёта")

    old_sum_rub = float(order.get("sum_rub") or 0)
    old_amount_coin = float(order.get("amount_coin") or 0)
    coin = order.get("coin", "")

    new_sum_rub: float | None = None
    new_amount_coin: float | None = None

    if "sum_rub" in body and body["sum_rub"] is not None:
        new_sum_rub = float(body["sum_rub"])
        if new_sum_rub <= 0:
            raise HTTPException(400, "Сумма должна быть больше нуля")
        new_amount_coin = round(new_sum_rub / rate_rub, 8)
    elif "amount_coin" in body and body["amount_coin"] is not None:
        new_amount_coin = float(body["amount_coin"])
        if new_amount_coin <= 0:
            raise HTTPException(400, "Количество монет должно быть больше нуля")
        new_sum_rub = round(new_amount_coin * rate_rub, 2)
    else:
        raise HTTPException(400, "Необходимо передать sum_rub или amount_coin")

    await db.execute(
        text("UPDATE orders SET sum_rub = :sum_rub, amount_coin = :amount_coin, updated_at = NOW() WHERE id = :id"),
        {"sum_rub": new_sum_rub, "amount_coin": new_amount_coin, "id": order_id},
    )

    # Уведомление в чат
    notify_text = (
        f"⚙️ Оператор изменил сумму сделки:\n"
        f"{old_sum_rub:,.2f} RUB → {new_sum_rub:,.2f} RUB\n"
        f"{old_amount_coin:.8f} {coin} → {new_amount_coin:.8f} {coin}"
    )
    msg_result = await db.execute(text("""
        INSERT INTO deal_messages (order_id, sender_type, sender_id, message, is_read, created_at)
        VALUES (:order_id, 'OPERATOR', :sender_id, :message, 0, NOW())
    """), {"order_id": order_id, "sender_id": current_user.id, "message": notify_text})
    msg_id = msg_result.lastrowid

    await db.commit()

    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated.mappings().one())

    msg_row = await db.execute(text("SELECT * FROM deal_messages WHERE id = :id"), {"id": msg_id})
    msg = dict(msg_row.mappings().one())

    await sio.emit_order_updated(updated_order)
    try:
        await sio.emit_order_message({**msg, "bot_id": order.get("bot_id"), "support_id": order.get("support_id")})
    except Exception as e:
        logger.warning(f"Failed to emit order:message for amount change on order {order_id}: {e}")

    # Отправляем уведомление пользователю в Telegram
    try:
        from bot.manager import bot_manager
        tg_row = await db.execute(
            text("SELECT u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
            {"id": order_id},
        )
        tg_data = tg_row.fetchone()
        bot_id = order.get("bot_id")
        if tg_data and bot_id:
            await bot_manager.send_message(
                bot_id,
                int(tg_data.tg_id),
                f"⚙️ <b>Оператор изменил сумму вашей заявки #{order.get('unique_id')}:</b>\n"
                f"{old_sum_rub:,.2f} RUB → {new_sum_rub:,.2f} RUB\n"
                f"{old_amount_coin:.8f} {coin} → {new_amount_coin:.8f} {coin}",
                parse_mode="HTML",
            )
    except Exception as e:
        logger.warning(f"Failed to notify user about amount change for order {order_id}: {e}")

    return {"success": True, "order": updated_order, "message": msg}


# ---------------------------------------------------------------------------
# POST /:id/messages/read
# ---------------------------------------------------------------------------

@router.post("/{order_id}/messages/read")
async def mark_messages_read(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("UPDATE deal_messages SET is_read = 1 WHERE order_id = :id AND sender_type = 'USER' AND is_read = 0"),
        {"id": order_id},
    )
    return {"success": True, "marked": result.rowcount}
