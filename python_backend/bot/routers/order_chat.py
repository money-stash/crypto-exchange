"""
Order chat mode — user messages while in an active order go to deal_messages.
Activated after order creation in buy.py / sell.py.
"""
import logging

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import text

from app.database import AsyncSessionLocal
import app.socket.socket_service as sio
from bot.states.order_states import OrderChatStates

router = Router()
logger = logging.getLogger(__name__)


@router.message(OrderChatStates.in_order_chat)
async def handle_order_chat_message(message: Message, state: FSMContext, bot_config: dict) -> None:
    """Save user text message to deal_messages and notify operator via socket."""
    text_msg = (message.text or "").strip()

    # If user sends /start — exit chat mode and go to main menu
    if text_msg.startswith("/start"):
        await state.clear()
        from bot.routers.start import build_main_menu
        welcome = (bot_config.get("start_message") or "Приветствуем вас в сервисе быстрых обменов!").strip()
        await message.answer(welcome, reply_markup=build_main_menu(bot_config))
        return

    if not text_msg:
        await message.answer("Отправьте текстовое сообщение для оператора.")
        return

    data = await state.get_data()
    order_id = data.get("order_id")
    order_unique_id = data.get("order_unique_id")

    if not order_id:
        await state.clear()
        await message.answer("Заявка не найдена. Используйте /start для возврата в меню.")
        return

    tg_id = message.from_user.id

    async with AsyncSessionLocal() as db:
        # Verify order is still active
        order_row = await db.execute(
            text("""
                SELECT o.id, o.status, o.bot_id, o.support_id,
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
            await state.clear()
            await message.answer(
                "Заявка не найдена. Используйте /start для возврата в меню.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]
                ])
            )
            return

        if order.status in ("COMPLETED", "CANCELLED"):
            await state.clear()
            status_text = "завершена" if order.status == "COMPLETED" else "отменена"
            await message.answer(
                f"Заявка #{order_unique_id} {status_text}. Используйте /start для нового обмена.",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]
                ])
            )
            return

        # Save message to deal_messages
        result = await db.execute(
            text("""
                INSERT INTO deal_messages
                  (order_id, sender_type, sender_id, message, is_read, created_at)
                VALUES (:order_id, 'USER', :sender_id, :message, 0, NOW())
            """),
            {
                "order_id": order_id,
                "sender_id": order.user_id,
                "message": text_msg,
            },
        )
        msg_id = result.lastrowid
        await db.commit()

        # Fetch inserted message
        msg_row = await db.execute(
            text("SELECT * FROM deal_messages WHERE id = :id"),
            {"id": msg_id},
        )
        msg = dict(msg_row.mappings().one())

    # Emit socket event to notify operators on the panel
    try:
        await sio.emit_order_message({
            **msg,
            "bot_id": order.bot_id,
            "support_id": order.support_id,
        })
    except Exception as e:
        logger.warning(f"Failed to emit order:message for order {order_id}: {e}")
