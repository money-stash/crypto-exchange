"""
Buy flow: RUB → CRYPTO
Steps: coin → amount → wallet address → summary → confirm
"""
import logging
import re

from aiogram import Router
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

from bot.states.order_states import BuyStates, OrderChatStates
from bot.order_service import get_quote, create_order, get_user_ids, BUY_COINS

router = Router()
logger = logging.getLogger(__name__)


# ── Keyboards ───────────────────────────────────────────────────────────────

def _coin_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for coin in BUY_COINS:
        builder.row(InlineKeyboardButton(text=f"🪙 {coin}", callback_data=f"buy_coin_{coin}"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="main_menu"))
    return builder.as_markup()


def _amount_keyboard(input_mode: str) -> InlineKeyboardMarkup:
    toggle_label = "Ввести в RUB 💱" if input_mode == "CRYPTO" else "Ввести в CRYPTO 💱"
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text=toggle_label, callback_data="buy_toggle_mode"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="buy_back_to_coins"))
    return builder.as_markup()


def _summary_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="✅ Подтвердить", callback_data="buy_confirm"))
    builder.row(InlineKeyboardButton(text="🛠 Изменить сумму", callback_data="buy_edit_amount"))
    builder.row(InlineKeyboardButton(text="❌ Отменить", callback_data="buy_cancel"))
    return builder.as_markup()


# ── Address validators ───────────────────────────────────────────────────────

_ADDRESS_PATTERNS = {
    "BTC": re.compile(r"^(1[a-zA-Z0-9]{24,33}|3[a-zA-Z0-9]{24,33}|bc1[a-zA-Z0-9]{6,87})$"),
    "LTC": re.compile(r"^([LM][a-zA-Z0-9]{25,34}|ltc1[a-zA-Z0-9]{6,87})$"),
    "XMR": re.compile(r"^4[0-9A-Za-z]{94}$"),
    "USDT": re.compile(r"^T[0-9A-Za-z]{33}$"),  # TRC-20
}


def _validate_address(address: str, coin: str) -> bool:
    pattern = _ADDRESS_PATTERNS.get(coin.upper())
    if not pattern:
        return len(address) >= 10
    return bool(pattern.match(address.strip()))


# ── Step 1: coin selection ───────────────────────────────────────────────────

@router.callback_query(lambda c: c.data == "menu_buy")
async def start_buy_flow(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text(
        "💸 <b>Покупка криптовалюты</b>\n\nВыберите монету:",
        reply_markup=_coin_keyboard(),
        parse_mode="HTML",
    )
    await state.set_state(BuyStates.choosing_coin)
    await callback.answer()


# ── Step 2: amount input ─────────────────────────────────────────────────────

@router.callback_query(lambda c: c.data and c.data.startswith("buy_coin_"))
async def buy_coin_selected(callback: CallbackQuery, state: FSMContext) -> None:
    coin = callback.data.split("_", 2)[2].upper()
    if coin not in BUY_COINS:
        await callback.answer("Неизвестная монета", show_alert=True)
        return

    await state.update_data(coin=coin, input_mode="CRYPTO")
    await state.set_state(BuyStates.entering_amount)

    await callback.message.edit_text(
        f"📦 <b>Покупка {coin}</b>\n\nВведите объём в <b>{coin}</b>:",
        reply_markup=_amount_keyboard("CRYPTO"),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "buy_back_to_coins")
async def buy_back_to_coins(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(BuyStates.choosing_coin)
    await callback.message.edit_text(
        "💸 <b>Покупка криптовалюты</b>\n\nВыберите монету:",
        reply_markup=_coin_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "buy_toggle_mode")
async def buy_toggle_mode(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data.get("coin", "BTC")
    current_mode = data.get("input_mode", "CRYPTO")
    new_mode = "RUB" if current_mode == "CRYPTO" else "CRYPTO"
    await state.update_data(input_mode=new_mode)
    unit = "RUB (₽)" if new_mode == "RUB" else coin
    await callback.message.edit_text(
        f"📦 <b>Покупка {coin}</b>\n\nВведите объём в <b>{unit}</b>:",
        reply_markup=_amount_keyboard(new_mode),
        parse_mode="HTML",
    )
    await callback.answer()


@router.message(BuyStates.entering_amount)
async def buy_amount_entered(message: Message, state: FSMContext, bot_config: dict) -> None:
    text = (message.text or "").strip().replace(",", ".")
    try:
        value = float(text)
        if value <= 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите корректное положительное число.")
        return

    data = await state.get_data()
    coin = data.get("coin", "BTC")
    input_mode = data.get("input_mode", "CRYPTO")

    try:
        quote = await get_quote(
            bot_id=bot_config["id"],
            user_id=0,  # не нужен user_id для простого расчёта
            coin=coin,
            dir="BUY",
            amount_coin=value if input_mode == "CRYPTO" else None,
            sum_rub=value if input_mode == "RUB" else None,
            input_mode=input_mode,
        )
    except ValueError as e:
        await message.answer(f"❌ {e}")
        return
    except Exception as e:
        logger.error(f"Quote error: {e}")
        await message.answer("❌ Ошибка расчёта курса. Попробуйте позже.")
        return

    await state.update_data(
        amount_coin=quote["amount_coin"],
        sum_rub=quote["sum_rub"],
        rate_rub=quote["rate"],
        fee=quote["fee"],
    )
    await state.set_state(BuyStates.entering_address)

    network_hint = {
        "USDT": " (сеть TRC-20)",
        "BTC": " (Bitcoin)",
        "LTC": " (Litecoin)",
        "XMR": " (Monero)",
    }.get(coin, "")

    await message.answer(
        f"📬 <b>Адрес {coin}{network_hint}</b>\n\n"
        f"Введите адрес кошелька, на который будет отправлено {quote['amount_coin']} {coin}:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="◀️ Назад", callback_data=f"buy_coin_{coin}")]
        ]),
    )


# ── Step 3: address input ────────────────────────────────────────────────────

@router.message(BuyStates.entering_address)
async def buy_address_entered(message: Message, state: FSMContext) -> None:
    address = (message.text or "").strip()
    data = await state.get_data()
    coin = data.get("coin", "BTC")

    if not _validate_address(address, coin):
        await message.answer(
            f"❌ Некорректный адрес {coin}. Проверьте и введите снова.",
        )
        return

    await state.update_data(crypto_address=address)
    await state.set_state(BuyStates.confirming)
    await _show_buy_summary(message, state)


async def _show_buy_summary(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data["coin"]
    amount_coin = data["amount_coin"]
    sum_rub = data["sum_rub"]
    rate_rub = data["rate_rub"]
    address = data["crypto_address"]

    text = (
        f"📋 <b>Подтверждение заявки</b>\n\n"
        f"🔄 Тип: Покупка\n"
        f"🪙 Актив: {coin}\n"
        f"📦 Объём: {amount_coin} {coin}\n"
        f"📈 Курс: {rate_rub:,.0f} ₽\n"
        f"💳 К оплате: {sum_rub:,.2f} ₽\n\n"
        f"📬 Адрес зачисления:\n<code>{address}</code>\n\n"
        f"⌛️ После создания заявки оператор пришлёт реквизиты для оплаты."
    )
    await message.answer(text, reply_markup=_summary_keyboard(), parse_mode="HTML")


# ── Step 4: confirm / edit / cancel ─────────────────────────────────────────

@router.callback_query(lambda c: c.data == "buy_confirm", BuyStates.confirming)
async def buy_confirm(callback: CallbackQuery, state: FSMContext, bot_config: dict) -> None:
    data = await state.get_data()
    tg_id = callback.from_user.id

    try:
        user_id, user_bot_id = await get_user_ids(tg_id, bot_config["id"])
    except ValueError as e:
        await callback.answer(str(e), show_alert=True)
        return

    try:
        order = await create_order(
            bot_id=bot_config["id"],
            user_id=user_id,
            user_bot_id=user_bot_id,
            coin=data["coin"],
            dir="BUY",
            amount_coin=data["amount_coin"],
            sum_rub=data["sum_rub"],
            rate_rub=data["rate_rub"],
            fee=data["fee"],
            user_crypto_address=data["crypto_address"],
        )
    except ValueError as e:
        await callback.answer(str(e), show_alert=True)
        return
    except Exception as e:
        logger.error(f"Order creation error: {e}")
        await callback.answer("❌ Ошибка создания заявки. Попробуйте позже.", show_alert=True)
        return

    unique_id = order["unique_id"]
    amount_coin = order["amount_coin"]
    coin = order["coin"]
    sum_rub = float(order["sum_rub"])

    # Activate order chat mode — user messages now go to deal_messages
    await state.set_state(OrderChatStates.in_order_chat)
    await state.update_data(order_id=order["id"], order_unique_id=unique_id)

    text = (
        f"✅ <b>Заявка #{unique_id} создана!</b>\n\n"
        f"🔄 Тип: Покупка\n"
        f"🪙 Актив: {coin}\n"
        f"📦 Объём: {amount_coin} {coin}\n"
        f"💳 К оплате: {sum_rub:,.2f} ₽\n\n"
        f"⌛️ Ожидайте: оператор отправит реквизиты для оплаты.\n\n"
        f"✍️ Если нужно уточнить детали — напишите сообщение прямо сюда."
    )
    await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()


@router.callback_query(lambda c: c.data == "buy_edit_amount", BuyStates.confirming)
async def buy_edit_amount(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data.get("coin", "BTC")
    input_mode = data.get("input_mode", "CRYPTO")
    await state.set_state(BuyStates.entering_amount)
    unit = "RUB (₽)" if input_mode == "RUB" else coin
    await callback.message.edit_text(
        f"📦 <b>Покупка {coin}</b>\n\nВведите объём в <b>{unit}</b>:",
        reply_markup=_amount_keyboard(input_mode),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "buy_cancel")
async def buy_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    from bot.routers.start import build_main_menu
    await callback.message.edit_text(
        "Заявка отменена. Возвращаемся в главное меню.",
        reply_markup=build_main_menu({}),
    )
    await callback.answer()
