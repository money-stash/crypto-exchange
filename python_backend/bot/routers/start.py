import logging
from aiogram import Router, Bot
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.referral_service import get_first_bonus_rub

router = Router()
logger = logging.getLogger(__name__)


def build_main_menu(bot_config: dict) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()

    builder.row(InlineKeyboardButton(text="💸 Обмен RUB → CRYPTO", callback_data="menu_buy"))
    builder.row(InlineKeyboardButton(text="💵 Обмен CRYPTO → RUB", callback_data="menu_sell"))
    builder.row(InlineKeyboardButton(text="👤 Личный раздел", callback_data="menu_cabinet"))

    if bot_config.get("reviews_chat_link"):
        builder.row(InlineKeyboardButton(text="⭐ Рейтинг", url=bot_config["reviews_chat_link"]))
    else:
        builder.row(InlineKeyboardButton(text="⭐ Рейтинг", callback_data="menu_reviews"))

    builder.row(InlineKeyboardButton(text="📲 Контакты", callback_data="menu_contacts"))
    return builder.as_markup()


async def _get_or_create_user(
    tg_id: int, username: str | None, bot_id: int,
    referrer_ub_id: int | None = None,
) -> dict:
    """
    Returns dict with:
      - is_new_referral: True if referrer was linked for the first time
      - referrer_tg_id: tg_id of the referrer (if any)
      - first_bonus_rub: configured first-bonus amount
    """
    result = {"is_new_referral": False, "referrer_tg_id": None, "first_bonus_rub": 0.0}

    async with AsyncSessionLocal() as db:
        # Find or create base user
        row = await db.execute(
            text("SELECT id FROM users WHERE tg_id = :tg_id"),
            {"tg_id": tg_id}
        )
        user = row.fetchone()
        if user:
            user_id = user.id
        else:
            r = await db.execute(
                text("INSERT INTO users (tg_id, username) VALUES (:tg_id, :username)"),
                {"tg_id": tg_id, "username": username}
            )
            user_id = r.lastrowid

        # Validate referrer: must exist in this bot and not be the user themselves
        invited_by = None
        if referrer_ub_id:
            ref_row = await db.execute(
                text("SELECT id, tg_id FROM user_bots WHERE id = :id AND bot_id = :bid"),
                {"id": referrer_ub_id, "bid": bot_id},
            )
            ref_ub = ref_row.fetchone()
            if ref_ub and ref_ub.tg_id != tg_id:
                invited_by = ref_ub.id
                result["referrer_tg_id"] = ref_ub.tg_id

        # Find or create user_bot link
        ub_row = await db.execute(
            text("SELECT id, invited_by FROM user_bots WHERE user_id = :uid AND bot_id = :bid"),
            {"uid": user_id, "bid": bot_id}
        )
        existing = ub_row.fetchone()
        if not existing:
            await db.execute(
                text("""
                    INSERT INTO user_bots (user_id, bot_id, tg_id, username, invited_by)
                    VALUES (:uid, :bid, :tg_id, :username, :invited_by)
                """),
                {"uid": user_id, "bid": bot_id, "tg_id": tg_id,
                 "username": username, "invited_by": invited_by}
            )
            if invited_by:
                result["is_new_referral"] = True
        # If user already exists but invited_by not set — allow one-time late binding
        elif existing and not existing.invited_by and invited_by:
            await db.execute(
                text("UPDATE user_bots SET invited_by = :inv WHERE id = :id"),
                {"inv": invited_by, "id": existing.id}
            )
            result["is_new_referral"] = True

        if result["is_new_referral"]:
            result["first_bonus_rub"] = await get_first_bonus_rub(db)

        await db.commit()

    return result


@router.message(CommandStart())
async def cmd_start(message: Message, bot_config: dict, bot: Bot) -> None:
    tg_id = message.from_user.id
    username = message.from_user.username

    # Extract referrer user_bot_id from /start ref<id>
    referrer_ub_id = None
    args = message.text.split(maxsplit=1)
    if len(args) > 1 and args[1].startswith("ref"):
        try:
            referrer_ub_id = int(args[1][3:])
        except ValueError:
            pass

    referral_result = {}
    try:
        referral_result = await _get_or_create_user(
            tg_id, username, bot_config["id"], referrer_ub_id
        )
    except Exception as e:
        logger.error(f"Failed to get/create user {tg_id}: {e}")

    welcome_text = (bot_config.get("start_message") or "").strip()
    if not welcome_text:
        welcome_text = "Приветствуем вас в сервисе быстрых обменов!"

    await message.answer(welcome_text, reply_markup=build_main_menu(bot_config))

    # Notify referrer
    if referral_result.get("is_new_referral") and referral_result.get("referrer_tg_id"):
        ref_tg_id = referral_result["referrer_tg_id"]
        first_bonus = referral_result.get("first_bonus_rub", 0.0)
        invited_name = f"@{username}" if username else f"пользователь"

        lines = [
            "🎉 <b>По вашей реферальной ссылке зарегистрировался новый пользователь!</b>",
            "",
            f"👤 {invited_name}",
        ]
        if first_bonus > 0:
            lines += [
                "",
                f"🎁 Бонус за первый обмен: <b>{first_bonus:,.0f} ₽</b>",
                "Бонус будет начислен после завершения первой заявки.",
            ]
        lines += ["", "Перейдите в Личный раздел → Реферальная программа для деталей."]

        try:
            await bot.send_message(ref_tg_id, "\n".join(lines))
        except Exception as e:
            logger.warning(f"Could not notify referrer {ref_tg_id}: {e}")


@router.callback_query(lambda c: c.data == "main_menu")
async def cb_main_menu(callback: CallbackQuery, bot_config: dict) -> None:
    welcome_text = (bot_config.get("start_message") or "").strip()
    if not welcome_text:
        welcome_text = "Приветствуем вас в сервисе быстрых обменов!"

    await callback.message.edit_text(welcome_text, reply_markup=build_main_menu(bot_config))
    await callback.answer()


@router.callback_query(lambda c: c.data in ("menu_reviews", "menu_contacts"))
async def cb_menu_stub(callback: CallbackQuery) -> None:
    stubs = {
        "menu_reviews": "⭐ Рейтинг в разработке",
        "menu_contacts": "📲 Контакты в разработке",
    }
    await callback.answer(stubs.get(callback.data, "В разработке"), show_alert=True)
