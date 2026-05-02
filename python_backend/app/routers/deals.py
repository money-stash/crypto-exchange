"""
Deals router — обработка этапов заявки:
  POST /:id/mark-payment       — клиент/оператор отмечает оплату
  POST /:id/confirm-payment    — оператор подтверждает оплату + вводит финансовые данные
  POST /:id/complete           — завершить заявку
  POST /:id/transaction-hash   — сохранить хэш транзакции
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel
import logging

from app.database import get_db, AsyncSessionLocal
from app.middleware.auth import require_auth
from app.models.support import Support
import app.socket.socket_service as sio

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/deals", tags=["deals"])

ORDER_SELECT = """
    SELECT
        o.*,
        u.tg_id, u.username AS user_username,
        s.login AS support_login,
        b.name AS bot_name,
        (SELECT COUNT(*) FROM deal_messages dm
         WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') AS unread_messages
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN supports s ON s.id = o.support_id
    LEFT JOIN bots b ON b.id = o.bot_id
"""


# ── Авто-выдача крипты ────────────────────────────────────────────────────────

async def _auto_send_crypto(
    order_id: int,
    coin: str,
    mnemonic: str,
    to_address: str,
    amount: float,
    bot_id: Optional[int],
    tg_id: Optional[int],
    unique_id,
) -> None:
    """
    Фоновая задача: отправляет крипту клиенту после подтверждения оплаты кассиром.
    Создаёт новую сессию БД (не зависит от сессии родительского запроса).
    """
    from app.services.crypto_wallet_service import send_coin

    tx_hash: Optional[str] = None
    send_error: Optional[str] = None

    try:
        logger.info(f"[AUTO-SEND] Начинаю отправку {amount} {coin} → {to_address} для заявки {order_id}")
        tx_hash = await send_coin(coin, mnemonic, to_address, amount)
        logger.info(f"[AUTO-SEND] Успешно! order={order_id} tx={tx_hash}")
    except Exception as exc:
        send_error = str(exc)
        logger.error(f"[AUTO-SEND] Ошибка для заявки {order_id}: {exc}")

    async with AsyncSessionLocal() as db:
        if tx_hash:
            # Завершаем заявку с хешем
            await db.execute(
                text("""
                    UPDATE orders SET
                        hash = :hash,
                        status = 'COMPLETED',
                        completed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {"hash": tx_hash, "id": order_id},
            )
            await db.commit()

            # Получаем обновлённую заявку для socket
            updated_row = await db.execute(
                text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id}
            )
            updated_order = dict(updated_row.mappings().one())

            # Списываем с депозита кассира/оператора (заморозка → постоянное списание)
            try:
                order_row = await db.execute(
                    text("SELECT support_id, sum_rub, cashier_card_id FROM orders WHERE id = :id"),
                    {"id": order_id},
                )
                o = order_row.mappings().one_or_none()
                if o:
                    deduct_uid = None
                    if o["cashier_card_id"]:
                        cc_row = await db.execute(
                            text("SELECT cashier_id FROM cashier_cards WHERE id = :cid"),
                            {"cid": o["cashier_card_id"]},
                        )
                        cc = cc_row.mappings().one_or_none()
                        if cc:
                            deduct_uid = cc["cashier_id"]
                    elif o["support_id"]:
                        deduct_uid = o["support_id"]
                    if deduct_uid:
                        from app.routers.orders import _get_usdt_rate, _rub_to_usdt
                        usdt_rate = await _get_usdt_rate(db)
                        deduct_usdt = _rub_to_usdt(float(o["sum_rub"] or 0), usdt_rate)
                        await db.execute(
                            text("""
                                UPDATE supports SET
                                    deposit      = GREATEST(0, deposit - :amount),
                                    deposit_work = GREATEST(0, deposit_work - :amount),
                                    deposit_paid = deposit_paid + :amount
                                WHERE id = :uid
                            """),
                            {"amount": deduct_usdt, "uid": deduct_uid},
                        )
                        await db.commit()
            except Exception as e:
                logger.warning(f"[AUTO-SEND] Deposit deduction failed for order {order_id}: {e}")

            # Emit socket
            try:
                await sio.emit_order_status_changed({
                    "orderId": order_id,
                    "oldStatus": "AWAITING_HASH",
                    "newStatus": "COMPLETED",
                    "order": updated_order,
                })
                await sio.emit_order_updated(updated_order)
            except Exception as e:
                logger.warning(f"[AUTO-SEND] socket emit error: {e}")

            # Уведомляем клиента в Telegram
            if bot_id and tg_id:
                try:
                    from bot.manager import bot_manager
                    await bot_manager.send_message(
                        bot_id,
                        int(tg_id),
                        f"✅ <b>Заявка #{unique_id} завершена!</b>\n\n"
                        f"Мы отправили вам {coin}.\n\n"
                        f"Хеш транзакции:\n<code>{tx_hash}</code>\n\n"
                        f"Транзакция подтвердится в сети в течение нескольких минут.",
                        parse_mode="HTML",
                    )
                except Exception as e:
                    logger.warning(f"[AUTO-SEND] TG notify error: {e}")
        else:
            # Отправка не удалась — оставляем AWAITING_HASH для ручной обработки
            # Добавляем системное сообщение в чат
            await db.execute(
                text("""
                    INSERT INTO deal_messages (order_id, sender_type, message, is_read, created_at)
                    VALUES (:oid, 'OPERATOR', :msg, 0, NOW())
                """),
                {
                    "oid": order_id,
                    "msg": f"⚠️ Авто-отправка {coin} не удалась: {send_error}. Требуется ручная обработка.",
                },
            )
            await db.commit()

            # Уведомляем клиента что транзакция обрабатывается
            if bot_id and tg_id:
                try:
                    from bot.manager import bot_manager
                    await bot_manager.send_message(
                        bot_id,
                        int(tg_id),
                        f"⏳ <b>Заявка #{unique_id} — ваша транзакция в обработке</b>\n\n"
                        f"Перевод {coin} поставлен в очередь. "
                        f"Ваши деньги придут в ближайшее время.",
                        parse_mode="HTML",
                    )
                except Exception as e:
                    logger.warning(f"[AUTO-SEND] TG fallback notify error: {e}")


async def _get_order(order_id: int, db: AsyncSession) -> dict:
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    return dict(order)


async def _emit_updated(order_id: int, old_status: str, new_status: str, db: AsyncSession):
    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    order = dict(updated.mappings().one())
    await sio.emit_order_status_changed({
        "orderId": order_id,
        "oldStatus": old_status,
        "newStatus": new_status,
        "order": order,
    })
    await sio.emit_order_updated(order)
    return order


# ---------------------------------------------------------------------------
# POST /:id/mark-payment  — оператор переводит заявку в PAYMENT_PENDING
# ---------------------------------------------------------------------------

@router.post("/{order_id}/mark-payment")
async def mark_payment(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]

    if old_status not in ("QUEUED", "PAYMENT_PENDING"):
        raise HTTPException(400, f"Неверный статус: {old_status}")

    # Привязываем к текущей активной смене оператора
    shift_row = await db.execute(
        text("SELECT id FROM operator_shifts WHERE support_id = :uid AND status = 'active' LIMIT 1"),
        {"uid": current_user.id},
    )
    shift = shift_row.fetchone()
    shift_id = shift.id if shift else None

    await db.execute(
        text("UPDATE orders SET status = 'PAYMENT_PENDING', shift_id = :sid, updated_at = NOW() WHERE id = :id"),
        {"id": order_id, "sid": shift_id},
    )
    updated_order = await _emit_updated(order_id, old_status, "PAYMENT_PENDING", db)
    return {"success": True, "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# GET /:id/usdt-rate  — текущий курс USDT для формы подтверждения оплаты
# ---------------------------------------------------------------------------

@router.get("/{order_id}/usdt-rate")
async def get_usdt_rate_for_confirm(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает текущий курс USDT и данные для расчёта выплаты клиенту."""
    order = await _get_order(order_id, db)

    usdt_row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'")
    )
    usdt_rate = usdt_row.mappings().one_or_none()
    if not usdt_rate:
        raise HTTPException(500, "Курс USDT не найден")

    effective_usdt_rate = float(usdt_rate["manual_rate_rub"] if usdt_rate["is_manual"] and usdt_rate["manual_rate_rub"] else usdt_rate["rate_rub"])

    coin = order.get("coin", "")
    amount_coin = float(order.get("amount_coin") or 0)
    sum_rub = float(order.get("sum_rub") or 0)

    # Расчёт ожидаемого USDT по текущему курсу
    expected_usdt = round(sum_rub / effective_usdt_rate, 8) if effective_usdt_rate > 0 else 0

    return {
        "usdt_rate_rub": effective_usdt_rate,
        "expected_received_usdt": expected_usdt,
        "payout": {
            "coin": coin,
            "amount_coin": amount_coin,
            "address": order.get("user_crypto_address"),
            "card_number": order.get("user_card_number"),
            "card_holder": order.get("user_card_holder"),
            "bank_name": order.get("user_bank_name"),
        },
    }


# ---------------------------------------------------------------------------
# POST /:id/confirm-payment  — оператор подтверждает оплату + финансовые данные
# ---------------------------------------------------------------------------

class ConfirmPaymentBody(BaseModel):
    received_usdt: Optional[float] = None   # сколько USDT получил оператор
    usdt_rate_rub: Optional[float] = None   # курс RUB/USDT по которому менял оператор


@router.post("/{order_id}/confirm-payment")
async def confirm_payment(
    order_id: int,
    body: Optional[ConfirmPaymentBody] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]
    direction = order.get("dir", "BUY")

    # Валидация статуса
    if direction == "BUY":
        allowed = ("PAYMENT_PENDING", "AWAITING_CONFIRM")
    else:
        allowed = ("AWAITING_CONFIRM",)

    if old_status not in allowed:
        raise HTTPException(
            400,
            f"Неверный статус: {old_status}. Ожидается: {', '.join(allowed)}"
        )

    amount_coin = float(order.get("amount_coin") or 0)
    sum_rub = float(order.get("sum_rub") or 0)
    coin = order.get("coin", "")

    # Определяем received_usdt и usdt_rate_rub
    received_usdt: Optional[float] = body.received_usdt if body else None
    usdt_rate_rub: Optional[float] = body.usdt_rate_rub if body else None

    if usdt_rate_rub and usdt_rate_rub > 0 and not received_usdt:
        # Оператор ввёл курс → вычисляем сколько USDT должно было быть получено
        received_usdt = round(sum_rub / usdt_rate_rub, 8)
    elif received_usdt and received_usdt > 0 and not usdt_rate_rub:
        # Оператор ввёл USDT → вычисляем курс
        usdt_rate_rub = round(sum_rub / received_usdt, 8)
    elif not received_usdt and not usdt_rate_rub:
        # Ничего не передано → берём текущий курс USDT из БД
        usdt_row = await db.execute(
            text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'")
        )
        usdt_rate = usdt_row.mappings().one_or_none()
        if usdt_rate:
            usdt_rate_rub = float(
                usdt_rate["manual_rate_rub"]
                if usdt_rate["is_manual"] and usdt_rate["manual_rate_rub"]
                else usdt_rate["rate_rub"]
            )
            if usdt_rate_rub > 0:
                received_usdt = round(sum_rub / usdt_rate_rub, 8)

    # Расчёт прибыли оператора (в рублях)
    operator_profit_rub: Optional[float] = None
    if received_usdt and usdt_rate_rub:
        if direction == "SELL":
            # Клиент продаёт крипту → оператор её продаёт за USDT
            # Прибыль = (полученный USDT − что должны были получить) × курс USDT
            expected_usdt = round(sum_rub / usdt_rate_rub, 8)
            operator_profit_rub = round((received_usdt - expected_usdt) * usdt_rate_rub, 2)
        else:  # BUY
            # Клиент платит RUB → оператор покупает USDT
            # Прибыль = RUB от клиента − потраченные RUB на покупку USDT
            operator_profit_rub = round(sum_rub - received_usdt * usdt_rate_rub, 2)

    # Обновляем заявку
    update_fields = "status = 'AWAITING_HASH', updated_at = NOW()"
    params: dict = {"id": order_id}

    if received_usdt is not None:
        update_fields += ", operator_received_usdt = :received_usdt"
        params["received_usdt"] = received_usdt
    if usdt_rate_rub is not None:
        update_fields += ", operator_rate_rub = :op_rate"
        params["op_rate"] = usdt_rate_rub
    if operator_profit_rub is not None:
        update_fields += ", operator_profit_rub = :op_profit"
        params["op_profit"] = operator_profit_rub

    # sla_user_paid_at фиксируем если ещё не стоит
    if not order.get("sla_user_paid_at"):
        update_fields += ", sla_user_paid_at = NOW()"

    await db.execute(text(f"UPDATE orders SET {update_fields} WHERE id = :id"), params)
    updated_order = await _emit_updated(order_id, old_status, "AWAITING_HASH", db)

    # Данные для авто-выплаты клиенту
    payout_info = {
        "coin": coin,
        "amount_coin": amount_coin,
        "address": order.get("user_crypto_address"),
        "card_number": order.get("user_card_number"),
        "card_holder": order.get("user_card_holder"),
        "bank_name": order.get("user_bank_name"),
        "received_usdt": received_usdt,
        "usdt_rate_rub": usdt_rate_rub,
    }

    # ── Авто-отправка крипты ─────────────────────────────────────────────
    # Только для BUY-заявок с криптовалютным адресом клиента
    auto_send_triggered = False
    if direction == "BUY" and order.get("user_crypto_address") and amount_coin > 0:
        try:
            from app.services.crypto_wallet_service import get_active_mnemonic, SUPPORTED_COINS
            if coin in SUPPORTED_COINS:
                mnemonic = await get_active_mnemonic(coin, db)
                if mnemonic:
                    # Получаем tg_id пользователя
                    tg_row = await db.execute(
                        text("SELECT u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
                        {"id": order_id},
                    )
                    tg_rec = tg_row.fetchone()
                    tg_id = int(tg_rec.tg_id) if tg_rec else None
                    bot_id = order.get("bot_id")
                    unique_id = order.get("unique_id")

                    asyncio.create_task(_auto_send_crypto(
                        order_id=order_id,
                        coin=coin,
                        mnemonic=mnemonic,
                        to_address=order["user_crypto_address"],
                        amount=amount_coin,
                        bot_id=bot_id,
                        tg_id=tg_id,
                        unique_id=unique_id,
                    ))
                    auto_send_triggered = True
                    logger.info(f"[AUTO-SEND] Задача запущена для заявки {order_id} ({coin} → {order['user_crypto_address']})")
        except Exception as e:
            logger.error(f"[AUTO-SEND] Не удалось запустить задачу для заявки {order_id}: {e}")

    return {
        "success": True,
        "orderDetails": updated_order,
        "payoutInfo": payout_info,
        "autoSendTriggered": auto_send_triggered,
    }


# ---------------------------------------------------------------------------
# POST /:id/transaction-hash
# ---------------------------------------------------------------------------

class HashBody(BaseModel):
    hash: str


@router.post("/{order_id}/transaction-hash")
async def set_transaction_hash(
    order_id: int,
    body: HashBody,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    if order["status"] != "AWAITING_HASH":
        raise HTTPException(400, f"Неверный статус: {order['status']}")

    await db.execute(
        text("UPDATE orders SET hash = :hash, updated_at = NOW() WHERE id = :id"),
        {"hash": body.hash, "id": order_id},
    )
    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated.mappings().one())
    await sio.emit_order_updated(updated_order)
    return {"success": True, "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# POST /:id/complete
# ---------------------------------------------------------------------------

@router.post("/{order_id}/complete")
async def complete_deal(
    order_id: int,
    request: Request,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]

    if old_status not in ("AWAITING_HASH", "AWAITING_CONFIRM", "PAYMENT_PENDING"):
        raise HTTPException(400, f"Невозможно завершить заявку со статусом {old_status}")

    # Extract hash from FormData or JSON body (frontend passes it here for BUY orders)
    transaction_hash: Optional[str] = None
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        transaction_hash = (form.get("transactionHash") or form.get("hash") or "").strip() or None
    else:
        try:
            body = await request.json()
            transaction_hash = (body.get("transactionHash") or body.get("hash") or "").strip() or None
        except Exception:
            pass

    # Save hash if provided
    if transaction_hash:
        await db.execute(
            text("UPDATE orders SET hash = :hash WHERE id = :id"),
            {"hash": transaction_hash, "id": order_id},
        )

    await db.execute(
        text("""
            UPDATE orders SET
                status = 'COMPLETED',
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = :id
        """),
        {"id": order_id},
    )

    # Track cashier card volume on completion
    try:
        from app.services.cashier_service import on_order_completed
        await on_order_completed(order, db)
    except Exception as exc:
        logger.warning(f"Cashier volume tracking failed for order {order_id}: {exc}")

    # Deduct from cashier/operator deposit (manual completion path)
    try:
        deduct_uid = None
        if order.get("cashier_card_id"):
            cc_row = await db.execute(
                text("SELECT cashier_id FROM cashier_cards WHERE id = :cid"),
                {"cid": order["cashier_card_id"]},
            )
            cc = cc_row.mappings().one_or_none()
            if cc:
                deduct_uid = cc["cashier_id"]
        elif order.get("support_id"):
            deduct_uid = order["support_id"]
        if deduct_uid:
            from app.routers.orders import _get_usdt_rate, _rub_to_usdt
            usdt_rate = await _get_usdt_rate(db)
            deduct_usdt = _rub_to_usdt(float(order.get("sum_rub") or 0), usdt_rate)
            await db.execute(
                text("""
                    UPDATE supports SET
                        deposit      = GREATEST(0, deposit - :amount),
                        deposit_work = GREATEST(0, deposit_work - :amount),
                        deposit_paid = deposit_paid + :amount
                    WHERE id = :uid
                """),
                {"amount": deduct_usdt, "uid": deduct_uid},
            )
    except Exception as exc:
        logger.warning(f"Deposit deduction failed for order {order_id}: {exc}")

    # Обновляем итоги смены если привязана
    shift_id = order.get("shift_id")
    if shift_id:
        await db.execute(
            text("""
                UPDATE operator_shifts SET
                    orders_completed = orders_completed + 1,
                    total_volume_rub = total_volume_rub + :sum_rub,
                    total_profit_rub = total_profit_rub + COALESCE(:profit, 0)
                WHERE id = :sid
            """),
            {
                "sid": shift_id,
                "sum_rub": float(order.get("sum_rub") or 0),
                "profit": float(order.get("operator_profit_rub") or 0),
            },
        )

    updated_order = await _emit_updated(order_id, old_status, "COMPLETED", db)

    # Notify user in Telegram that order is completed (with hash for BUY orders)
    try:
        from bot.manager import bot_manager
        tg_row = await db.execute(
            text("SELECT u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id"),
            {"id": order_id},
        )
        tg_data = tg_row.fetchone()
        bot_id = updated_order.get("bot_id")
        unique_id = updated_order.get("unique_id")
        direction = updated_order.get("dir", "")
        if tg_data and bot_id:
            if direction == "BUY" and transaction_hash:
                msg = (
                    f"✅ <b>Заявка #{unique_id} завершена!</b>\n\n"
                    f"Мы отправили вам крипту. Хеш транзакции:\n"
                    f"<code>{transaction_hash}</code>"
                )
            elif direction == "BUY":
                msg = f"✅ <b>Заявка #{unique_id} завершена!</b>\n\nКрипта отправлена на ваш адрес."
            else:
                msg = f"✅ <b>Заявка #{unique_id} завершена!</b>\n\nСпасибо за обмен!"
            await bot_manager.send_message(bot_id, int(tg_data.tg_id), msg, parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Failed to notify user on order {order_id} completion: {e}")

    # Referral bonus + notify referrer
    try:
        from app.services.referral_service import process_referral_bonus
        ub_row = await db.execute(
            text("SELECT user_bot_id FROM orders WHERE id = :id"), {"id": order_id}
        )
        ub_data = ub_row.fetchone()
        if ub_data and ub_data.user_bot_id:
            profit = float(updated_order.get("operator_profit_rub") or 0)
            bonus_result = await process_referral_bonus(
                db=db,
                order_id=order_id,
                order_sum=profit,
                referred_user_bot_id=ub_data.user_bot_id,
                bot_id=updated_order.get("bot_id"),
            )
            if bonus_result and bonus_result.get("bonus_amount", 0) > 0:
                ref_row = await db.execute(text("""
                    SELECT u.tg_id, u2.username AS referred_username
                    FROM user_bots ub
                    JOIN users u ON ub.user_id = u.id
                    JOIN user_bots ub2 ON ub2.id = :referred_ubid
                    JOIN users u2 ON ub2.user_id = u2.id
                    WHERE ub.id = :referrer_ubid
                """), {
                    "referrer_ubid": bonus_result["referrer_userbot_id"],
                    "referred_ubid": bonus_result["referred_userbot_id"],
                })
                ref_data = ref_row.fetchone()
                if ref_data and updated_order.get("bot_id"):
                    amount = bonus_result["bonus_amount"]
                    uname = f"@{ref_data.referred_username}" if ref_data.referred_username else "пользователя"
                    await bot_manager.send_message(
                        updated_order["bot_id"],
                        int(ref_data.tg_id),
                        f"💰 <b>+{amount:,.2f} ₽</b> за обмен от {uname}",
                        parse_mode="HTML",
                    )
    except Exception as exc:
        logger.warning(f"Referral bonus failed for order {order_id}: {exc}")

    return {"success": True, "orderDetails": updated_order}
