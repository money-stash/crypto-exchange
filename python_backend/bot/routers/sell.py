"""
Sell flow: CRYPTO → RUB
Steps: coin → amount → card number → bank name → FIO → summary → confirm
Saved cards (card+bank+fio as JSON) are offered before manual entry.
"""
import json
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

from bot.states.order_states import SellStates, OrderChatStates
from bot.order_service import get_quote, create_order, get_user_ids, SELL_COINS, validate_coupon_for_bot
from bot.requisite_service import save_requisite, get_requisites

router = Router()
logger = logging.getLogger(__name__)


# ── Keyboards ────────────────────────────────────────────────────────────────

def _coin_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for coin in SELL_COINS:
        builder.row(InlineKeyboardButton(text=f"🪙 {coin}", callback_data=f"sell_coin_{coin}"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="main_menu"))
    return builder.as_markup()


def _amount_keyboard(input_mode: str, coin: str) -> InlineKeyboardMarkup:
    toggle_label = "Ввести в RUB 💱" if input_mode == "CRYPTO" else f"Ввести в {coin} 💱"
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text=toggle_label, callback_data="sell_toggle_mode"))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="sell_back_to_coins"))
    return builder.as_markup()


def _back_keyboard(callback_data: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="◀️ Назад", callback_data=callback_data)]
    ])


def _card_keyboard(saved: list[dict]) -> InlineKeyboardMarkup:
    """Show saved cards + back button. Each saved item has decoded JSON value."""
    builder = InlineKeyboardBuilder()
    for req in saved:
        try:
            data = json.loads(req["value"])
            card = data.get("card", "")
            bank = data.get("bank", "")
            masked = f"****{card[-4:]}" if len(card) >= 4 else card
            label = f"💳 {masked} {bank}".strip()
        except Exception:
            label = f"💳 реквизит #{req['id']}"
        builder.row(InlineKeyboardButton(
            text=label,
            callback_data=f"sell_saved_{req['id']}",
        ))
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="sell_back_to_amount"))
    return builder.as_markup()


def _summary_keyboard(has_coupon: bool = False) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="✅ Подтвердить", callback_data="sell_confirm"))
    if not has_coupon:
        builder.row(InlineKeyboardButton(text="🎟 Применить промокод", callback_data="sell_enter_coupon"))
    else:
        builder.row(InlineKeyboardButton(text="🗑 Убрать промокод", callback_data="sell_remove_coupon"))
    builder.row(InlineKeyboardButton(text="🛠 Изменить сумму", callback_data="sell_edit_amount"))
    builder.row(InlineKeyboardButton(text="❌ Отменить", callback_data="sell_cancel"))
    return builder.as_markup()


# ── Validators ───────────────────────────────────────────────────────────────

_CARD_RE = re.compile(r"^\d[\d\s\-]{13,18}\d$")
_PHONE_RE = re.compile(r"^\+7\d{10}$")


def _validate_card_or_phone(value: str) -> str | None:
    """Returns normalised card/phone or None if invalid."""
    v = value.strip()
    digits_only = re.sub(r"[\s\-]", "", v)
    if _CARD_RE.match(v) and len(digits_only) == 16:
        return digits_only
    if _PHONE_RE.match(v):
        return v
    return None


# ── Step 1: coin selection ────────────────────────────────────────────────────

@router.callback_query(lambda c: c.data == "menu_sell")
async def start_sell_flow(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text(
        "💵 <b>Продажа криптовалюты</b>\n\nВыберите монету:",
        reply_markup=_coin_keyboard(),
        parse_mode="HTML",
    )
    await state.set_state(SellStates.choosing_coin)
    await callback.answer()


# ── Step 2: amount ────────────────────────────────────────────────────────────

@router.callback_query(lambda c: c.data and c.data.startswith("sell_coin_"))
async def sell_coin_selected(callback: CallbackQuery, state: FSMContext) -> None:
    coin = callback.data.split("_", 2)[2].upper()
    if coin not in SELL_COINS:
        await callback.answer("Неизвестная монета", show_alert=True)
        return

    await state.update_data(coin=coin, input_mode="CRYPTO")
    await state.set_state(SellStates.entering_amount)

    await callback.message.edit_text(
        f"📦 <b>Продажа {coin}</b>\n\nВведите объём в <b>{coin}</b>:",
        reply_markup=_amount_keyboard("CRYPTO", coin),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_toggle_mode")
async def sell_toggle_mode(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data.get("coin", "BTC")
    current_mode = data.get("input_mode", "CRYPTO")
    new_mode = "RUB" if current_mode == "CRYPTO" else "CRYPTO"
    await state.update_data(input_mode=new_mode)
    unit = "RUB (₽)" if new_mode == "RUB" else coin
    await callback.message.edit_text(
        f"📦 <b>Продажа {coin}</b>\n\nВведите объём в <b>{unit}</b>:",
        reply_markup=_amount_keyboard(new_mode, coin),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_back_to_coins")
async def sell_back_to_coins(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SellStates.choosing_coin)
    await callback.message.edit_text(
        "💵 <b>Продажа криптовалюты</b>\n\nВыберите монету:",
        reply_markup=_coin_keyboard(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_back_to_amount")
async def sell_back_to_amount(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data.get("coin", "BTC")
    input_mode = data.get("input_mode", "CRYPTO")
    await state.set_state(SellStates.entering_amount)
    unit = "RUB (₽)" if input_mode == "RUB" else coin
    await callback.message.edit_text(
        f"📦 <b>Продажа {coin}</b>\n\nВведите объём в <b>{unit}</b>:",
        reply_markup=_amount_keyboard(input_mode, coin),
        parse_mode="HTML",
    )
    await callback.answer()


@router.message(SellStates.entering_amount)
async def sell_amount_entered(message: Message, state: FSMContext, bot_config: dict) -> None:
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
            user_id=0,
            coin=coin,
            dir="SELL",
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

    # Load saved cards
    saved = []
    try:
        user_id, _ = await get_user_ids(message.from_user.id, bot_config["id"])
        saved = await get_requisites(user_id, bot_config["id"], "CARD", "SELL")
        await state.update_data(user_id=user_id)
    except Exception:
        pass

    await state.set_state(SellStates.entering_card)

    if saved:
        prompt = (
            "💳 <b>Реквизиты для выплаты</b>\n\n"
            "Выберите сохранённую карту или введите новую (16 цифр / +7XXXXXXXXXX):"
        )
        await message.answer(prompt, parse_mode="HTML", reply_markup=_card_keyboard(saved))
    else:
        await message.answer(
            "💳 <b>Реквизиты для выплаты</b>\n\n"
            "Введите номер карты (16 цифр) или номер телефона (+7XXXXXXXXXX):",
            parse_mode="HTML",
            reply_markup=_back_keyboard("sell_back_to_amount"),
        )


# ── Step 2.5: select saved card ───────────────────────────────────────────────

@router.callback_query(lambda c: c.data and c.data.startswith("sell_saved_"), SellStates.entering_card)
async def sell_use_saved_card(callback: CallbackQuery, state: FSMContext, bot_config: dict) -> None:
    req_id = int(callback.data.split("_")[2])
    data = await state.get_data()

    try:
        user_id = data.get("user_id")
        if not user_id:
            user_id, _ = await get_user_ids(callback.from_user.id, bot_config["id"])
        saved = await get_requisites(user_id, bot_config["id"], "CARD", "SELL")
    except Exception:
        await callback.answer("Ошибка загрузки реквизита", show_alert=True)
        return

    item = next((r for r in saved if r["id"] == req_id), None)
    if not item:
        await callback.answer("Реквизит не найден", show_alert=True)
        return

    try:
        card_data = json.loads(item["value"])
    except Exception:
        await callback.answer("Ошибка чтения реквизита", show_alert=True)
        return

    card_number = card_data.get("card", "")
    bank_name = card_data.get("bank", "")
    fio = card_data.get("fio", "")

    await state.update_data(card_number=card_number, bank_name=bank_name, fio=fio)
    await state.set_state(SellStates.confirming)

    summary_data = {**data, "card_number": card_number, "bank_name": bank_name, "fio": fio}
    await callback.message.delete()
    await _show_sell_summary(callback.message, summary_data)
    await callback.answer()


# ── Step 3: card number ───────────────────────────────────────────────────────

@router.message(SellStates.entering_card)
async def sell_card_entered(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    normalised = _validate_card_or_phone(raw)
    if not normalised:
        await message.answer(
            "❌ Некорректные реквизиты.\n\n"
            "Введите 16-значный номер карты или номер телефона в формате +7XXXXXXXXXX."
        )
        return

    await state.update_data(card_number=normalised)
    await state.set_state(SellStates.entering_bank)
    await message.answer(
        "🏦 Введите название банка (например: Сбербанк, Тинькофф, Альфа-банк):",
        reply_markup=_back_keyboard("sell_back_to_card"),
    )


@router.callback_query(lambda c: c.data == "sell_back_to_card")
async def sell_back_to_card(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SellStates.entering_card)
    await callback.message.edit_text(
        "💳 <b>Реквизиты для выплаты</b>\n\n"
        "Введите номер карты (16 цифр) или номер телефона (+7XXXXXXXXXX):",
        parse_mode="HTML",
        reply_markup=_back_keyboard("sell_back_to_amount"),
    )
    await callback.answer()


# ── Step 4: bank name ─────────────────────────────────────────────────────────

@router.message(SellStates.entering_bank)
async def sell_bank_entered(message: Message, state: FSMContext) -> None:
    bank = (message.text or "").strip()
    if len(bank) < 2:
        await message.answer("❌ Введите корректное название банка.")
        return

    await state.update_data(bank_name=bank)
    await state.set_state(SellStates.entering_fio)
    await message.answer(
        "👤 Введите ФИО держателя карты (Фамилия Имя Отчество):",
        reply_markup=_back_keyboard("sell_back_to_bank"),
    )


@router.callback_query(lambda c: c.data == "sell_back_to_bank")
async def sell_back_to_bank(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SellStates.entering_bank)
    await callback.message.edit_text(
        "🏦 Введите название банка (например: Сбербанк, Тинькофф, Альфа-банк):",
        reply_markup=_back_keyboard("sell_back_to_card"),
    )
    await callback.answer()


# ── Step 5: FIO ───────────────────────────────────────────────────────────────

_FIO_RE = re.compile(r"^[А-ЯЁа-яёA-Za-z]+\s+[А-ЯЁа-яёA-Za-z]+", re.UNICODE)


@router.message(SellStates.entering_fio)
async def sell_fio_entered(message: Message, state: FSMContext, bot_config: dict) -> None:
    fio = (message.text or "").strip()
    if not _FIO_RE.match(fio) or len(fio) < 5:
        await message.answer("❌ Введите ФИО (минимум Фамилия Имя, например: Иванов Иван Иванович).")
        return

    data = await state.get_data()
    await state.update_data(fio=fio)

    # Save card requisite (card + bank + fio as JSON)
    try:
        user_id = data.get("user_id")
        if not user_id:
            user_id, _ = await get_user_ids(message.from_user.id, bot_config["id"])
        card_json = json.dumps({
            "card": data["card_number"],
            "bank": data["bank_name"],
            "fio": fio,
        }, ensure_ascii=False)
        await save_requisite(user_id, bot_config["id"], "CARD", card_json, "SELL")
    except Exception as e:
        logger.warning(f"Failed to save card requisite: {e}")

    await state.set_state(SellStates.confirming)
    await _show_sell_summary(message, {**data, "fio": fio})


async def _show_sell_summary(message: Message, data: dict) -> None:
    coin = data["coin"]
    amount_coin = data["amount_coin"]
    sum_rub = float(data["sum_rub"])
    rate_rub = data["rate_rub"]
    card_number = data["card_number"]
    bank_name = data["bank_name"]
    fio = data["fio"]
    coupon_discount = float(data.get("coupon_discount_rub") or 0)
    has_coupon = bool(data.get("coupon_id"))

    card_info = f"{card_number} {bank_name} {fio}"
    receive_line = f"💳 К получению: {sum_rub:,.2f} ₽"
    coupon_line = ""
    if has_coupon:
        original = sum_rub + coupon_discount
        coupon_line = (
            f"\n🎟 Промокод: скидка -{coupon_discount:,.2f} ₽ (было {original:,.2f} ₽)"
        )

    text = (
        f"📋 <b>Подтверждение заявки</b>\n\n"
        f"🔄 Тип: Продажа\n"
        f"🪙 Актив: {coin}\n"
        f"📦 Объём: {amount_coin} {coin}\n"
        f"📈 Курс: {rate_rub:,.0f} ₽\n"
        f"{receive_line}{coupon_line}\n\n"
        f"🏦 Реквизиты для выплаты:\n<code>{card_info}</code>\n\n"
        f"⌛️ После создания заявки оператор пришлёт адрес для перевода {coin}."
    )
    await message.answer(text, reply_markup=_summary_keyboard(has_coupon), parse_mode="HTML")


# ── Coupon step ───────────────────────────────────────────────────────────────

@router.callback_query(lambda c: c.data == "sell_enter_coupon", SellStates.confirming)
async def sell_enter_coupon(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SellStates.entering_coupon)
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="◀️ Назад", callback_data="sell_back_to_summary"))
    await callback.message.answer(
        "🎟 <b>Введите промокод:</b>",
        reply_markup=builder.as_markup(),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_back_to_summary")
async def sell_back_to_summary(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SellStates.confirming)
    await callback.message.delete()
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_remove_coupon", SellStates.confirming)
async def sell_remove_coupon(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    original_sum = float(data.get("sum_rub_original") or data["sum_rub"])
    await state.update_data(coupon_id=None, coupon_discount_rub=0, sum_rub=original_sum)
    await callback.message.delete()
    updated = await state.get_data()
    await _show_sell_summary(callback.message, updated)
    await callback.answer("Промокод убран")


@router.message(SellStates.entering_coupon)
async def sell_coupon_entered(message: Message, state: FSMContext) -> None:
    code = (message.text or "").strip()
    data = await state.get_data()
    sum_rub = float(data["sum_rub"])

    try:
        result = await validate_coupon_for_bot(code, message.from_user.id, sum_rub)
    except ValueError as e:
        await message.answer(f"❌ {e}\n\nВведите другой код или нажмите «Назад».")
        return

    discount = result["discount_rub"]
    new_sum = max(0.01, sum_rub - discount)
    await state.update_data(
        coupon_id=result["coupon_id"],
        coupon_discount_rub=discount,
        sum_rub=new_sum,
        sum_rub_original=sum_rub,
    )
    await state.set_state(SellStates.confirming)
    await message.answer(f"✅ Промокод применён! Скидка: -{discount:,.2f} ₽")
    updated = await state.get_data()
    await _show_sell_summary(message, updated)


# ── Step 6: confirm / edit / cancel ──────────────────────────────────────────

@router.callback_query(lambda c: c.data == "sell_confirm", SellStates.confirming)
async def sell_confirm(callback: CallbackQuery, state: FSMContext, bot_config: dict) -> None:
    data = await state.get_data()
    tg_id = callback.from_user.id

    try:
        user_id, user_bot_id = await get_user_ids(tg_id, bot_config["id"])
    except ValueError as e:
        await callback.answer(str(e), show_alert=True)
        return

    card_info = f"{data['card_number']} {data['bank_name']} {data['fio']}"
    card_parts = card_info.split(" ", 2)

    try:
        order = await create_order(
            bot_id=bot_config["id"],
            user_id=user_id,
            user_bot_id=user_bot_id,
            coin=data["coin"],
            dir="SELL",
            amount_coin=data["amount_coin"],
            sum_rub=data["sum_rub"],
            rate_rub=data["rate_rub"],
            fee=data["fee"],
            user_card_number=card_parts[0] if len(card_parts) > 0 else None,
            user_bank_name=card_parts[1] if len(card_parts) > 1 else None,
            user_card_holder=card_parts[2] if len(card_parts) > 2 else None,
            coupon_id=data.get("coupon_id"),
            coupon_discount_rub=float(data.get("coupon_discount_rub") or 0),
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

    await state.set_state(OrderChatStates.in_order_chat)
    await state.update_data(order_id=order["id"], order_unique_id=unique_id)

    text = (
        f"✅ <b>Заявка #{unique_id} создана!</b>\n\n"
        f"🔄 Тип: Продажа\n"
        f"🪙 Актив: {coin}\n"
        f"📦 Объём: {amount_coin} {coin}\n"
        f"💳 К получению: {sum_rub:,.2f} ₽\n\n"
        f"⌛️ Ожидайте: оператор отправит адрес для перевода {coin}.\n\n"
        f"✍️ Если нужно уточнить детали — напишите сообщение прямо сюда."
    )
    await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_edit_amount", SellStates.confirming)
async def sell_edit_amount(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    coin = data.get("coin", "BTC")
    input_mode = data.get("input_mode", "CRYPTO")

    await state.set_state(SellStates.entering_amount)
    unit = "RUB (₽)" if input_mode == "RUB" else coin

    await callback.message.edit_text(
        f"📦 <b>Продажа {coin}</b>\n\nВведите объём в <b>{unit}</b>:",
        reply_markup=_amount_keyboard(input_mode, coin),
        parse_mode="HTML",
    )
    await callback.answer()


@router.callback_query(lambda c: c.data == "sell_cancel")
async def sell_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    from bot.routers.start import build_main_menu
    await callback.message.edit_text(
        "Заявка отменена. Возвращаемся в главное меню.",
        reply_markup=build_main_menu({}),
    )
    await callback.answer()
