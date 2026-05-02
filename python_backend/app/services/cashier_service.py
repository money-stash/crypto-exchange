"""
Cashier (Автовыдача) service.

Handles:
- Card selection algorithm (least-used volume first, interval-aware)
- Auto-assignment of cashier cards to incoming orders
- Volume tracking on order completion
- Limit-reached detection
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def try_auto_assign_cashier_card(order_id: int, sum_rub: float, bot_id: int) -> bool:
    """
    Tries to auto-assign a cashier card to a freshly-created order.
    Uses its own DB session so it can be called from the bot layer.
    Returns True if a card was assigned, False if the order should go to the
    operator queue as usual.
    """
    async with AsyncSessionLocal() as db:
        should_auto = await _should_use_auto_payout(db)
        await db.commit()  # persist counter update

        if not should_auto:
            return False

        card = await _find_best_card(sum_rub, db)
        if card is None:
            return False

        await _assign_card(order_id, card, db)
        await db.commit()

    # Emit socket event so the cashier's panel and admin panels update in real-time
    try:
        import app.socket.socket_service as sio
        async with AsyncSessionLocal() as db3:
            row = await db3.execute(
                text("""
                    SELECT o.*, u.tg_id, u.username AS user_username,
                           s.login AS support_login, b.name AS bot_name,
                           0 AS unread_messages
                    FROM orders o
                    LEFT JOIN users u ON u.id = o.user_id
                    LEFT JOIN supports s ON s.id = o.support_id
                    LEFT JOIN bots b ON b.id = o.bot_id
                    WHERE o.id = :id
                """),
                {"id": order_id},
            )
            order_data = row.mappings().one_or_none()
            if order_data:
                await sio.emit_order_status_changed({
                    "orderId": order_id,
                    "oldStatus": "QUEUED",
                    "newStatus": "PAYMENT_PENDING",
                    "order": dict(order_data),
                })
                await sio.emit_order_updated(dict(order_data))
    except Exception as exc:
        logger.warning(f"[cashier] Socket emit failed for order {order_id}: {exc}")

    # Send Telegram notification in a fresh session (non-critical, don't raise)
    try:
        async with AsyncSessionLocal() as db2:
            await _notify_user_about_card(order_id, card, bot_id, db2)
    except Exception as exc:
        logger.warning(f"[cashier] Telegram notification failed for order {order_id}: {exc}")

    # Notify cashier via their personal Telegram
    try:
        async with AsyncSessionLocal() as db3:
            order_row = await db3.execute(
                text("SELECT * FROM orders WHERE id = :id"), {"id": order_id}
            )
            order_data = order_row.mappings().one_or_none()
            if order_data:
                from app.services.cashier_notify import notify_order_assigned
                await notify_order_assigned(card["cashier_id"], dict(order_data), card)
    except Exception as exc:
        logger.warning(f"[cashier] Cashier Telegram notify failed for order {order_id}: {exc}")

    return True


async def on_order_completed(order: dict, db: AsyncSession) -> None:
    """
    Called when an order is completed. Updates card volume and checks limit.
    Runs inside the caller's session — caller is responsible for committing.
    """
    card_id = order.get("cashier_card_id")
    if not card_id:
        return

    sum_rub = float(order.get("sum_rub") or 0)

    await db.execute(text("""
        UPDATE cashier_cards
        SET current_volume = current_volume + :amount
        WHERE id = :card_id
    """), {"amount": sum_rub, "card_id": card_id})

    # Check limit
    row = await db.execute(text("""
        SELECT current_volume, total_volume_limit
        FROM cashier_cards WHERE id = :card_id
    """), {"card_id": card_id})
    card = row.mappings().one_or_none()

    if card:
        limit = float(card["total_volume_limit"] or 0)
        vol = float(card["current_volume"] or 0)
        if limit > 0 and vol >= limit:
            await db.execute(text("""
                UPDATE cashier_cards
                SET is_active = 0, limit_reached_notified = 1
                WHERE id = :card_id
            """), {"card_id": card_id})


async def extend_card_limit(card_id: int, extra: float, db: AsyncSession) -> None:
    """Add extra volume to a card's total_volume_limit and reactivate it."""
    await db.execute(text("""
        UPDATE cashier_cards
        SET total_volume_limit = total_volume_limit + :extra,
            is_active = 1,
            limit_reached_notified = 0
        WHERE id = :card_id
    """), {"extra": extra, "card_id": card_id})


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _should_use_auto_payout(db: AsyncSession) -> bool:
    """
    Returns True if this order should be routed to auto-payout.
    Increments the rolling counter and returns False every N-th order.
    If cashier_order_interval = 0, always returns True.
    """
    interval_row = await db.execute(text(
        "SELECT value FROM system_settings WHERE `key` = 'cashier_order_interval'"
    ))
    interval_data = interval_row.fetchone()
    n = int((interval_data.value if interval_data else None) or 0)

    if n == 0:
        return True

    counter_row = await db.execute(text(
        "SELECT value FROM system_settings WHERE `key` = 'cashier_order_counter'"
    ))
    counter_data = counter_row.fetchone()
    counter = int((counter_data.value if counter_data else None) or 0) + 1

    await db.execute(text("""
        INSERT INTO system_settings (`key`, value)
        VALUES ('cashier_order_counter', :val)
        ON DUPLICATE KEY UPDATE value = :val
    """), {"val": str(counter)})

    return (counter % n) != 0


async def _find_best_card(sum_rub: float, db: AsyncSession) -> dict | None:
    """
    Finds the best matching cashier card for this amount.

    Priority:
      1. "Dirty" cards (current_volume > 0) that pass the interval cooldown,
         sorted by current_volume ASC (least used first).
      2. "Clean" cards (never used / current_volume == 0).
      3. None — fall back to operator queue.
    """
    rows = await db.execute(text("""
        SELECT cc.*
        FROM cashier_cards cc
        JOIN supports s ON s.id = cc.cashier_id AND s.is_active = 1
        WHERE cc.is_active = 1
          AND cc.min_amount <= :amount
          AND cc.max_amount >= :amount
          AND (cc.total_volume_limit = 0
               OR cc.total_volume_limit - cc.current_volume >= :amount)
        ORDER BY cc.current_volume ASC
    """), {"amount": sum_rub})

    cards = [dict(r._mapping) for r in rows]
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    dirty_available: list[dict] = []
    clean: list[dict] = []

    for card in cards:
        vol = float(card.get("current_volume") or 0)
        interval = int(card.get("interval_minutes") or 0)
        last_used = card.get("last_used_at")

        if vol == 0 or last_used is None:
            clean.append(card)
        else:
            elapsed_min = (now - last_used).total_seconds() / 60
            if interval == 0 or elapsed_min >= interval:
                dirty_available.append(card)

    if dirty_available:
        dirty_available.sort(key=lambda c: float(c.get("current_volume") or 0))
        return dirty_available[0]

    if clean:
        return clean[0]

    return None


async def _assign_card(order_id: int, card: dict, db: AsyncSession) -> None:
    """Write card details to the order and update card's last_used_at."""
    await db.execute(text("""
        UPDATE orders SET
            cashier_card_id        = :card_id,
            support_id             = :cashier_id,
            exch_card_number       = :card_number,
            exch_card_holder       = :card_holder,
            exch_bank_name         = :bank_name,
            status                 = 'PAYMENT_PENDING',
            sla_started_at         = NOW(),
            sla_requisites_setup_at = NOW(),
            updated_at             = NOW()
        WHERE id = :order_id
    """), {
        "card_id": card["id"],
        "cashier_id": card["cashier_id"],
        "card_number": card["card_number"],
        "card_holder": card.get("card_holder"),
        "bank_name": card.get("bank_name"),
        "order_id": order_id,
    })

    await db.execute(text("""
        UPDATE cashier_cards SET last_used_at = NOW()
        WHERE id = :card_id
    """), {"card_id": card["id"]})

    # Create a service message so the cashier sees what card was assigned
    msg_lines = ["💳 Карта назначена автоматически (Автовыдача)"]
    msg_lines.append(f"Номер карты: {card['card_number']}")
    if card.get("bank_name"):
        msg_lines.append(f"Банк: {card['bank_name']}")
    if card.get("card_holder"):
        msg_lines.append(f"Получатель: {card['card_holder']}")
    await db.execute(text("""
        INSERT INTO deal_messages (order_id, sender_type, sender_id, message, is_read, created_at)
        VALUES (:order_id, 'OPERATOR', :cashier_id, :message, 1, NOW())
    """), {
        "order_id": order_id,
        "cashier_id": card["cashier_id"],
        "message": "\n".join(msg_lines),
    })


async def _notify_user_about_card(
    order_id: int, card: dict, bot_id: int, db: AsyncSession
) -> None:
    """Send a Telegram message to the client with payment card details."""
    row = await db.execute(text("""
        SELECT o.unique_id, o.sum_rub, o.dir, u.tg_id
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = :id
    """), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        return

    tg_id = order["tg_id"]
    direction = order.get("dir", "BUY")

    if direction != "BUY":
        # Auto-payout currently only covers BUY (client pays RUB → receives crypto)
        return

    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    from bot.manager import bot_manager

    unique_id = order["unique_id"]
    sum_rub = order["sum_rub"]
    card_number = card.get("card_number", "")
    card_holder = card.get("card_holder") or ""
    bank_name = card.get("bank_name") or ""

    text_parts = [
        f"💳 <b>Реквизиты для оплаты заявки #{unique_id}</b>\n",
        f"Переведите <b>{sum_rub} ₽</b>",
        f"На карту: <code>{card_number}</code>",
    ]
    if bank_name:
        text_parts.append(f"Банк: {bank_name}")
    if card_holder:
        text_parts.append(f"Получатель: {card_holder}")
    text_parts.append("\n⚠️ После оплаты нажмите кнопку ниже.")

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="✅ Я оплатил",
            callback_data=f"user_sent_crypto:{order_id}",
        )]
    ])

    await bot_manager.send_message(
        bot_id,
        int(tg_id),
        "\n".join(text_parts),
        parse_mode="HTML",
        reply_markup=keyboard,
    )
