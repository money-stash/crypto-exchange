"""
Bot order service — quote calculation and order creation.
Runs in-process, accesses DB directly via SQLAlchemy.
"""
import logging
import random

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
import app.socket.socket_service as sio

logger = logging.getLogger(__name__)

BUY_COINS = ("BTC", "LTC", "XMR", "USDT")
SELL_COINS = ("BTC", "LTC", "XMR")


# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

async def get_quote(
    *,
    bot_id: int,
    user_id: int,
    coin: str,
    dir: str,
    amount_coin: float | None = None,
    sum_rub: float | None = None,
    input_mode: str = "CRYPTO",
) -> dict:
    """
    Returns:
        {rate, fee, amount_coin, sum_rub}
    Raises:
        ValueError with human-readable message on bad data.
    """
    coin = coin.upper()
    dir = dir.upper()
    input_mode = input_mode.upper()

    async with AsyncSessionLocal() as db:
        # 1. Get current rate
        row = await db.execute(
            text("""
                SELECT IF(is_manual = 1 AND manual_rate_rub IS NOT NULL,
                          manual_rate_rub, rate_rub) AS rate
                FROM rates WHERE coin = :coin LIMIT 1
            """),
            {"coin": coin},
        )
        rate_row = row.fetchone()
        if not rate_row:
            raise ValueError(f"Курс для {coin} не найден")
        rate = float(rate_row.rate)
        if rate <= 0:
            raise ValueError(f"Некорректный курс для {coin}")

        # 2. Get fee: bot-specific first, then global
        fee_row = await db.execute(
            text("""
                SELECT buy_fee, sell_fee FROM fees
                WHERE coin = :coin AND bot_id = :bid LIMIT 1
            """),
            {"coin": coin, "bid": bot_id},
        )
        fee_data = fee_row.fetchone()
        if not fee_data:
            fee_row2 = await db.execute(
                text("""
                    SELECT buy_fee, sell_fee FROM fees
                    WHERE coin = :coin AND bot_id IS NULL LIMIT 1
                """),
                {"coin": coin},
            )
            fee_data = fee_row2.fetchone()

        fee_pct = 0.0
        if fee_data:
            fee_pct = float(fee_data.buy_fee if dir == "BUY" else fee_data.sell_fee)

    # 3. Calculate quote
    if dir == "BUY":
        pay_ratio = 1.0 + fee_pct
    else:
        pay_ratio = 1.0 - fee_pct

    if pay_ratio <= 0:
        raise ValueError("Некорректная конфигурация комиссии")

    if input_mode == "RUB" and sum_rub and sum_rub > 0:
        resolved_amount_coin = sum_rub / (rate * pay_ratio)
        resolved_sum_rub = sum_rub
    elif amount_coin and amount_coin > 0:
        resolved_amount_coin = amount_coin
        resolved_sum_rub = amount_coin * rate * pay_ratio
    else:
        raise ValueError("Укажите сумму")

    resolved_sum_rub = round(resolved_sum_rub, 2)
    resolved_amount_coin = round(resolved_amount_coin, 8)

    return {
        "rate": rate,
        "fee": fee_pct,
        "amount_coin": resolved_amount_coin,
        "sum_rub": resolved_sum_rub,
        "unit_rub": round(resolved_sum_rub / resolved_amount_coin, 2) if resolved_amount_coin else 0,
    }


# ---------------------------------------------------------------------------
# Create order
# ---------------------------------------------------------------------------

async def create_order(
    *,
    bot_id: int,
    user_id: int,
    user_bot_id: int,
    coin: str,
    dir: str,
    amount_coin: float,
    sum_rub: float,
    rate_rub: float,
    fee: float,
    user_crypto_address: str | None = None,
    user_card_number: str | None = None,
    user_card_holder: str | None = None,
    user_bank_name: str | None = None,
) -> dict:
    """Insert order into DB, emit socket event, return order dict."""
    coin = coin.upper()
    dir = dir.upper()

    async with AsyncSessionLocal() as db:
        # Check for existing active order
        existing = await db.execute(
            text("""
                SELECT id, unique_id FROM orders
                WHERE user_id = :uid AND bot_id = :bid
                  AND status NOT IN ('COMPLETED', 'CANCELLED')
                LIMIT 1
            """),
            {"uid": user_id, "bid": bot_id},
        )
        ex = existing.fetchone()
        if ex:
            raise ValueError(
                f"У вас уже есть активная заявка #{ex.unique_id}. "
                "Дождитесь её завершения или отмените её."
            )

        # Generate unique 5-digit order ID
        unique_id = await _generate_unique_id(db)

        await db.execute(
            text("""
                INSERT INTO orders
                  (unique_id, user_id, user_bot_id, dir, coin,
                   amount_coin, rate_rub, fee, ref_percent, user_discount,
                   sum_rub, status,
                   user_crypto_address, user_card_number, user_card_holder, user_bank_name,
                   bot_id)
                VALUES
                  (:uid, :user_id, :user_bot_id, :dir, :coin,
                   :amount_coin, :rate_rub, :fee, 0, 0,
                   :sum_rub, 'QUEUED',
                   :crypto_addr, :card_num, :card_holder, :bank_name,
                   :bot_id)
            """),
            {
                "uid": unique_id,
                "user_id": user_id,
                "user_bot_id": user_bot_id,
                "dir": dir,
                "coin": coin,
                "amount_coin": amount_coin,
                "rate_rub": rate_rub,
                "fee": fee,
                "sum_rub": sum_rub,
                "crypto_addr": user_crypto_address,
                "card_num": user_card_number,
                "card_holder": user_card_holder,
                "bank_name": user_bank_name,
                "bot_id": bot_id,
            },
        )
        await db.commit()

        # Fetch the created order
        row = await db.execute(
            text("""
                SELECT o.*, u.tg_id, u.username AS user_username,
                       b.name AS bot_name
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                LEFT JOIN bots b ON b.id = o.bot_id
                WHERE o.unique_id = :uid
                LIMIT 1
            """),
            {"uid": unique_id},
        )
        order = dict(row.mappings().one())

    # Try auto-assign a cashier card — only for BUY (RUB → crypto) orders
    auto_assigned = False
    try:
        if order.get("dir") == "BUY":
            from app.services.cashier_service import try_auto_assign_cashier_card
            auto_assigned = await try_auto_assign_cashier_card(
                order["id"], float(order["sum_rub"]), bot_id
            )
    except Exception as e:
        logger.warning(f"Auto-assign cashier card failed for order {unique_id}: {e}")

    # Re-fetch order if status changed (auto-assign moves it to PAYMENT_PENDING)
    if auto_assigned:
        try:
            async with AsyncSessionLocal() as db:
                row = await db.execute(
                    text("""
                        SELECT o.*, u.tg_id, u.username AS user_username,
                               b.name AS bot_name
                        FROM orders o
                        LEFT JOIN users u ON u.id = o.user_id
                        LEFT JOIN bots b ON b.id = o.bot_id
                        WHERE o.id = :id LIMIT 1
                    """),
                    {"id": order["id"]},
                )
                updated = row.mappings().one_or_none()
                if updated:
                    order = dict(updated)
        except Exception as e:
            logger.warning(f"Failed to re-fetch order {unique_id} after auto-assign: {e}")

    # Emit socket event (non-blocking)
    try:
        await sio.emit_order_created(order)
    except Exception as e:
        logger.warning(f"Failed to emit order:created for order {unique_id}: {e}")

    return order


async def _generate_unique_id(db: AsyncSession) -> int:
    for _ in range(10):
        uid = random.randint(10000, 99999)
        row = await db.execute(
            text("SELECT id FROM orders WHERE unique_id = :uid"), {"uid": uid}
        )
        if not row.fetchone():
            return uid
    raise RuntimeError("Failed to generate unique order ID after 10 attempts")


# ---------------------------------------------------------------------------
# Helpers — get user/user_bot IDs from tg_id
# ---------------------------------------------------------------------------

async def get_user_ids(tg_id: int, bot_id: int) -> tuple[int, int]:
    """Returns (user_id, user_bot_id). Both must exist (created in /start)."""
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("""
                SELECT u.id AS user_id, ub.id AS user_bot_id
                FROM users u
                JOIN user_bots ub ON ub.user_id = u.id AND ub.bot_id = :bid
                WHERE u.tg_id = :tg_id
                LIMIT 1
            """),
            {"tg_id": tg_id, "bid": bot_id},
        )
        r = row.fetchone()
        if not r:
            raise ValueError("Пользователь не найден. Отправьте /start")
        return r.user_id, r.user_bot_id
