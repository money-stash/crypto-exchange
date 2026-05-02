import logging
from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import text

from app.database import AsyncSessionLocal

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
    referral_code: str | None = None,
) -> None:
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

        # Resolve invited_by from referral code
        invited_by = None
        if referral_code:
            ref_row = await db.execute(
                text("SELECT id FROM user_bots WHERE referral_code = :code AND bot_id = :bid"),
                {"code": referral_code, "bid": bot_id},
            )
            ref_ub = ref_row.fetchone()
            if ref_ub:
                invited_by = ref_ub.id

        # Find or create user_bot link
        ub = await db.execute(
            text("SELECT id FROM user_bots WHERE user_id = :uid AND bot_id = :bid"),
            {"uid": user_id, "bid": bot_id}
        )
        existing = ub.fetchone()
        if not existing:
            await db.execute(
                text("""
                    INSERT INTO user_bots (user_id, bot_id, tg_id, username, invited_by)
                    VALUES (:uid, :bid, :tg_id, :username, :invited_by)
                """),
                {"uid": user_id, "bid": bot_id, "tg_id": tg_id,
                 "username": username, "invited_by": invited_by}
            )

        await db.commit()


@router.message(CommandStart())
async def cmd_start(message: Message, bot_config: dict) -> None:
    tg_id = message.from_user.id
    username = message.from_user.username

    # Extract referral code from /start refXXX
    referral_code = None
    args = message.text.split(maxsplit=1)
    if len(args) > 1 and args[1].startswith("ref"):
        referral_code = args[1]

    try:
        await _get_or_create_user(tg_id, username, bot_config["id"], referral_code)
    except Exception as e:
        logger.error(f"Failed to get/create user {tg_id}: {e}")

    welcome_text = (bot_config.get("start_message") or "").strip()
    if not welcome_text:
        welcome_text = "Приветствуем вас в сервисе быстрых обменов!"

    await message.answer(welcome_text, reply_markup=build_main_menu(bot_config))


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



    
