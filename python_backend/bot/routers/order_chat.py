"""
Order chat mode — user messages while in an active order go to deal_messages.
Supports text, photos, and PDF documents.
"""
import logging
import os
import uuid

from aiogram import Router, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from sqlalchemy import text

from app.database import AsyncSessionLocal
import app.socket.socket_service as sio
from bot.states.order_states import OrderChatStates

router = Router()
logger = logging.getLogger(__name__)

UPLOAD_DIR = "uploads/chats"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_DOCUMENT_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}


async def _get_active_order(db, tg_id: int, order_id: int):
    row = await db.execute(
        text("""
            SELECT o.id, o.status, o.bot_id, o.support_id, o.unique_id,
                   u.id AS user_id
            FROM orders o
            JOIN users u ON u.tg_id = :tg_id
            WHERE o.id = :order_id AND o.user_id = u.id
            LIMIT 1
        """),
        {"tg_id": tg_id, "order_id": order_id},
    )
    return row.fetchone()


async def _save_and_emit(db, order, text_msg: str, attachment_path: str | None):
    """Insert into deal_messages and emit socket event."""
    result = await db.execute(
        text("""
            INSERT INTO deal_messages
              (order_id, sender_type, sender_id, message, attachments_path, is_read, created_at)
            VALUES (:order_id, 'USER', :sender_id, :message, :att, 0, NOW())
        """),
        {
            "order_id": order.id,
            "sender_id": order.user_id,
            "message": text_msg or "",
            "att": attachment_path,
        },
    )
    msg_id = result.lastrowid
    await db.commit()

    msg_row = await db.execute(
        text("SELECT * FROM deal_messages WHERE id = :id"), {"id": msg_id}
    )
    msg = dict(msg_row.mappings().one())

    try:
        await sio.emit_order_message({
            **msg,
            "bot_id": order.bot_id,
            "support_id": order.support_id,
        })
    except Exception as e:
        logger.warning(f"[BOT] Failed to emit order:message for order {order.id}: {e}")

    return msg_id


async def _check_state_and_order(message: Message, state, bot_config: dict):
    """Returns (order, data) or None if we already replied with an error."""
    data = await state.get_data()
    order_id = data.get("order_id")
    order_unique_id = data.get("order_unique_id")

    if not order_id:
        await state.clear()
        await message.answer("Заявка не найдена. Используйте /start для возврата в меню.")
        return None, None

    async with AsyncSessionLocal() as db:
        order = await _get_active_order(db, message.from_user.id, order_id)

    if not order:
        await state.clear()
        await message.answer(
            "Заявка не найдена. Используйте /start для возврата в меню.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]
            ])
        )
        return None, None

    if order.status in ("COMPLETED", "CANCELLED"):
        await state.clear()
        status_text = "завершена" if order.status == "COMPLETED" else "отменена"
        await message.answer(
            f"Заявка #{order_unique_id} {status_text}. Используйте /start для нового обмена.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]
            ])
        )
        return None, None

    return order, data


# ── Текст ────────────────────────────────────────────────────────────────────

@router.message(OrderChatStates.in_order_chat, F.text)
async def handle_order_chat_text(message: Message, state, bot_config: dict) -> None:
    text_msg = (message.text or "").strip()

    if text_msg.startswith("/start"):
        await state.clear()
        from bot.routers.start import build_main_menu
        welcome = (bot_config.get("start_message") or "Приветствуем вас!").strip()
        await message.answer(welcome, reply_markup=build_main_menu(bot_config))
        return

    if not text_msg:
        return

    order, _ = await _check_state_and_order(message, state, bot_config)
    if not order:
        return

    async with AsyncSessionLocal() as db:
        order = await _get_active_order(db, message.from_user.id, order.id)
        await _save_and_emit(db, order, text_msg, None)

    logger.info(f"[BOT] text message saved for order {order.id}")


# ── Фото ─────────────────────────────────────────────────────────────────────

@router.message(OrderChatStates.in_order_chat, F.photo)
async def handle_order_chat_photo(message: Message, state, bot_config: dict) -> None:
    order, _ = await _check_state_and_order(message, state, bot_config)
    if not order:
        return

    caption = (message.caption or "").strip()

    # Берём самое большое фото
    photo = message.photo[-1]
    file_info = await message.bot.get_file(photo.file_id)
    ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)

    await message.bot.download_file(file_info.file_path, dest)
    attachment_path = f"/uploads/chats/{filename}"

    async with AsyncSessionLocal() as db:
        order = await _get_active_order(db, message.from_user.id, order.id)
        await _save_and_emit(db, order, caption or "📷 Фото", attachment_path)

    await message.reply("✅ Фото отправлено оператору.")
    logger.info(f"[BOT] photo saved for order {order.id}: {filename}")


# ── Документы (PDF, изображения как файл) ────────────────────────────────────

@router.message(OrderChatStates.in_order_chat, F.document)
async def handle_order_chat_document(message: Message, state, bot_config: dict) -> None:
    doc = message.document

    mime = doc.mime_type or ""
    is_pdf = mime == "application/pdf"
    is_image = mime.startswith("image/")

    if not (is_pdf or is_image):
        await message.reply(
            "❌ Поддерживаются только фото и PDF документы.\n"
            "Остальные типы файлов не принимаются."
        )
        return

    order, _ = await _check_state_and_order(message, state, bot_config)
    if not order:
        return

    caption = (message.caption or "").strip()

    # Определяем расширение
    if is_pdf:
        ext = ".pdf"
        label = "📄 PDF документ"
    else:
        original_name = doc.file_name or ""
        ext = os.path.splitext(original_name)[1].lower() or ".jpg"
        label = "📷 Изображение"

    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)

    file_info = await message.bot.get_file(doc.file_id)
    await message.bot.download_file(file_info.file_path, dest)
    attachment_path = f"/uploads/chats/{filename}"

    async with AsyncSessionLocal() as db:
        order = await _get_active_order(db, message.from_user.id, order.id)
        await _save_and_emit(db, order, caption or label, attachment_path)

    type_label = "PDF" if is_pdf else "изображение"
    await message.reply(f"✅ {type_label.capitalize()} отправлено оператору.")
    logger.info(f"[BOT] document ({mime}) saved for order {order.id}: {filename}")


# ── Кнопка «Я отправил / Я оплатил» ─────────────────────────────────────────

@router.callback_query(lambda c: c.data and c.data.startswith("user_sent_crypto:"))
async def handle_user_sent_crypto(callback: CallbackQuery, state, bot_config: dict) -> None:
    """Клиент нажал «Я отправил крипту» / «Я оплатил» — переводим в AWAITING_CONFIRM."""
    try:
        order_id = int(callback.data.split(":")[1])
    except (IndexError, ValueError):
        await callback.answer("Ошибка.", show_alert=True)
        return

    tg_id = callback.from_user.id

    async with AsyncSessionLocal() as db:
        order_row = await db.execute(
            text("""
                SELECT o.id, o.status, o.bot_id, o.support_id, o.unique_id,
                       u.id AS user_id
                FROM orders o
                JOIN users u ON u.tg_id = :tg_id
                WHERE o.id = :order_id AND o.user_id = u.id
                LIMIT 1
            """),
            {"tg_id": tg_id, "order_id": order_id},
        )
        order = order_row.fetchone()

        if not order:
            await callback.answer("Заявка не найдена.", show_alert=True)
            return

        if order.status in ("COMPLETED", "CANCELLED"):
            await callback.answer(
                "Заявка уже завершена или отменена.", show_alert=True
            )
            return

        if order.status == "AWAITING_CONFIRM":
            await callback.answer("Уже отмечено, ожидайте оператора.", show_alert=True)
            return

        if order.status not in ("QUEUED", "PAYMENT_PENDING"):
            await callback.answer(
                f"Нельзя подтвердить на этом этапе (статус: {order.status}).",
                show_alert=True
            )
            return

        # Переводим в AWAITING_CONFIRM
        await db.execute(
            text("""
                UPDATE orders
                SET status = 'AWAITING_CONFIRM',
                    sla_user_paid_at = NOW(),
                    updated_at = NOW()
                WHERE id = :id
            """),
            {"id": order_id},
        )
        await db.commit()

        # Получаем обновлённую заявку для socket emit
        from app.routers.orders import ORDER_SELECT
        updated_row = await db.execute(
            text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id}
        )
        updated_order = dict(updated_row.mappings().one())

    # Уведомляем панель
    try:
        await sio.emit_order_status_changed({
            "orderId": order_id,
            "oldStatus": order.status,
            "newStatus": "AWAITING_CONFIRM",
            "order": updated_order,
        })
    except Exception as e:
        logger.warning(f"[BOT] Failed to emit status change for order {order_id}: {e}")

    await callback.message.edit_text(
        f"✅ <b>Оплата отмечена!</b>\n\n"
        f"Заявка #{order.unique_id} ожидает подтверждения оператора.\n"
        f"Мы уведомим вас о завершении.",
        parse_mode="HTML",
    )
    await callback.answer()
    logger.info(f"[BOT] User tg_id={tg_id} confirmed payment for order {order_id}")


# ── Прочее (стикеры, голос и т.д.) ───────────────────────────────────────────

@router.message(OrderChatStates.in_order_chat)
async def handle_order_chat_unsupported(message: Message, state, bot_config: dict) -> None:
    await message.reply(
        "⚠️ Поддерживаются только текст, фото и PDF документы."
    )
