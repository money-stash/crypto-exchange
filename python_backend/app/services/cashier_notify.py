"""
Cashier notification service.
Sends messages to a specific cashier via their team's bot.
"""
import logging
from datetime import datetime

from sqlalchemy import text

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _fmt_date(dt) -> str:
    if dt is None:
        return "—"
    if isinstance(dt, datetime):
        return dt.strftime("%d.%m.%Y %H:%M")
    return str(dt)[:16]


async def _get_cashier_info(cashier_id: int) -> dict | None:
    """Returns {team_id, tg_id} for the cashier, or None if not linkable."""
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("SELECT team_id, tg_id FROM supports WHERE id = :id AND role = 'CASHIER'"),
            {"id": cashier_id},
        )
        rec = row.mappings().one_or_none()
        if not rec or not rec["tg_id"] or not rec["team_id"]:
            return None
        return dict(rec)


async def _usdt_rate() -> float:
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'")
        )
        rec = row.mappings().one_or_none()
        if not rec:
            return 0.0
        return float(
            rec["manual_rate_rub"]
            if rec["is_manual"] and rec["manual_rate_rub"]
            else rec["rate_rub"]
        )


async def notify_order_assigned(cashier_id: int, order: dict, card: dict) -> None:
    info = await _get_cashier_info(cashier_id)
    if not info:
        return

    from bot.cashier_bot_manager import cashier_bot_manager

    usdt_rate = await _usdt_rate()
    sum_rub = float(order.get("sum_rub") or 0)
    rate_rub = float(order.get("rate_rub") or 0)
    sum_usd = round(sum_rub / usdt_rate, 2) if usdt_rate > 0 else 0
    unique_id = order.get("unique_id", "?")
    coin = order.get("coin", "")
    card_number = card.get("card_number", "")
    bank = card.get("bank_name") or ""

    msg = (
        f"🔔 <b>Новая заявка #{unique_id}</b>\n\n"
        f"📅 Дата: {_fmt_date(order.get('created_at'))}\n"
        f"💳 Карта: <code>{card_number}</code>"
        + (f" ({bank})" if bank else "")
        + f"\n💰 Сумма: <b>{sum_rub:,.2f} ₽</b>\n"
        f"📈 Курс {coin}/RUB: {rate_rub:,.0f} ₽\n"
        f"💵 Эквивалент: ~{sum_usd:,.2f} $\n"
        f"📋 Статус: Ожидает оплаты от клиента"
    )

    await cashier_bot_manager.send_to_cashier(info["team_id"], info["tg_id"], msg)


async def notify_payment_received(cashier_id: int, order: dict) -> None:
    info = await _get_cashier_info(cashier_id)
    if not info:
        return

    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    from bot.cashier_bot_manager import cashier_bot_manager

    usdt_rate = await _usdt_rate()
    sum_rub = float(order.get("sum_rub") or 0)
    rate_rub = float(order.get("rate_rub") or 0)
    sum_usd = round(sum_rub / usdt_rate, 2) if usdt_rate > 0 else 0
    unique_id = order.get("unique_id", "?")
    order_id = order.get("id")
    coin = order.get("coin", "")
    card_number = order.get("exch_card_number") or "—"

    msg = (
        f"💸 <b>Клиент отметил оплату — заявка #{unique_id}</b>\n\n"
        f"📅 Дата: {_fmt_date(order.get('created_at'))}\n"
        f"💳 Карта: <code>{card_number}</code>\n"
        f"💰 Сумма: <b>{sum_rub:,.2f} ₽</b>\n"
        f"📈 Курс {coin}/RUB: {rate_rub:,.0f} ₽\n"
        f"💵 Эквивалент: ~{sum_usd:,.2f} $\n"
        f"📋 Статус: Ожидает подтверждения\n\n"
        f"👆 Проверьте карту — если деньги пришли, нажмите кнопку."
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="✅ Подтвердить получение",
            callback_data=f"cashier_confirm_{order_id}",
        )
    ]])

    await cashier_bot_manager.send_to_cashier(
        info["team_id"], info["tg_id"], msg, reply_markup=keyboard
    )
