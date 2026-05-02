"""
Bot cabinet: referral program page + payout request.
"""
import logging
from decimal import Decimal

from aiogram import Router
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.referral_service import (
    get_user_bot_referral_stats,
    get_tiers,
    get_first_bonus_rub,
)

router = Router()
logger = logging.getLogger(__name__)


async def _get_user_bot(tg_id: int, bot_id: int) -> dict | None:
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("SELECT ub.id, u.tg_id FROM user_bots ub JOIN users u ON ub.user_id = u.id "
                 "WHERE u.tg_id = :tg_id AND ub.bot_id = :bot_id"),
            {"tg_id": tg_id, "bot_id": bot_id},
        )
        r = row.fetchone()
        return dict(r._mapping) if r else None


def _cabinet_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="👥 Реферальная программа", callback_data="cabinet_referral"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="main_menu"))
    return builder.as_markup()


def _referral_keyboard(has_balance: bool) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if has_balance:
        builder.row(InlineKeyboardButton(text="💸 Получить выплату", callback_data="referral_payout"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="menu_cabinet"))
    return builder.as_markup()


@router.callback_query(lambda c: c.data == "menu_cabinet")
async def cb_cabinet(callback: CallbackQuery, bot_config: dict) -> None:
    await callback.message.edit_text(
        "👤 <b>Личный раздел</b>\n\nВыберите раздел:",
        reply_markup=_cabinet_keyboard(),
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "cabinet_referral")
async def cb_referral(callback: CallbackQuery, bot_config: dict) -> None:
    tg_id = callback.from_user.id
    bot_id = bot_config["id"]

    ub = await _get_user_bot(tg_id, bot_id)
    if not ub:
        await callback.answer("Ошибка: профиль не найден", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        stats = await get_user_bot_referral_stats(db, ub["id"], bot_id)
        tiers = await get_tiers(db)
        first_bonus = await get_first_bonus_rub(db)

    ref_link = f"https://t.me/{bot_config['identifier']}?start=ref{ub['id']}"

    lines = [
        "👥 <b>Реферальная программа</b>\n",
        f"🔗 <b>Ваша ссылка:</b>",
        f"<code>{ref_link}</code>\n",
        f"📊 <b>Ваша статистика:</b>",
        f"• Приглашено пользователей: <b>{stats['referralsCount']}</b>",
        f"• Заявок рефералов: <b>{stats['referralsOrders']}</b>",
        f"• Оборот рефералов: <b>{stats['referralsSum']:,.0f} ₽</b>",
        f"• Текущий уровень: <b>{stats['tierLabel']}</b>",
        f"• Процент вознаграждения: <b>{stats['currentPercent']}%</b>",
        "",
        f"💰 <b>Финансы:</b>",
        f"• Всего заработано: <b>{stats['earned']:,.2f} ₽</b>",
        f"• Выплачено: <b>{stats['paidOut']:,.2f} ₽</b>",
        f"• Доступно к выводу: <b>{stats['balance']:,.2f} ₽</b>",
    ]

    if first_bonus > 0:
        lines += ["", f"🎁 <b>Бонус за первый обмен реферала: {first_bonus:,.0f} ₽</b>"]

    if tiers:
        lines += ["", "📈 <b>Уровни программы:</b>"]
        for t in tiers:
            mn = int(t["min_sum_rub"] or 0)
            mx = t["max_sum_rub"]
            label = t.get("label") or f"{t['bonus_percent']}%"
            if mx:
                lines.append(f"• {label}: {mn:,} – {int(mx):,} ₽ → {t['bonus_percent']}%")
            else:
                lines.append(f"• {label}: от {mn:,} ₽ → {t['bonus_percent']}%")

    text_out = "\n".join(lines)
    await callback.message.edit_text(
        text_out,
        reply_markup=_referral_keyboard(has_balance=stats["balance"] > 0),
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "referral_payout")
async def cb_referral_payout(callback: CallbackQuery, bot_config: dict) -> None:
    tg_id = callback.from_user.id
    bot_id = bot_config["id"]

    ub = await _get_user_bot(tg_id, bot_id)
    if not ub:
        await callback.answer("Ошибка: профиль не найден", show_alert=True)
        return

    async with AsyncSessionLocal() as db:
        stats = await get_user_bot_referral_stats(db, ub["id"], bot_id)
        balance = Decimal(str(stats["balance"]))

        if balance <= 0:
            await callback.answer("Нет средств для вывода", show_alert=True)
            return

        # Check for existing pending withdrawal
        existing = await db.execute(
            text("SELECT id FROM referrals_withdraw WHERE userbot_id = :ubid AND status = 'CREATED'"),
            {"ubid": ub["id"]},
        )
        if existing.fetchone():
            await callback.answer("У вас уже есть активная заявка на выплату", show_alert=True)
            return

        # Create withdrawal request
        await db.execute(text("""
            INSERT INTO referrals_withdraw (userbot_id, amount_rub, currency, status)
            VALUES (:ubid, :amount, 'RUB', 'CREATED')
        """), {"ubid": ub["id"], "amount": balance})
        await db.commit()

    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="cabinet_referral"))

    await callback.message.edit_text(
        f"✅ <b>Заявка на выплату создана</b>\n\n"
        f"Сумма: <b>{float(balance):,.2f} ₽</b>\n\n"
        f"Администратор обработает вашу заявку в ближайшее время.",
        reply_markup=builder.as_markup(),
    )
    await callback.answer()
