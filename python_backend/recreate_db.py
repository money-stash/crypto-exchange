"""
recreate_db.py — полностью удаляет и пересоздаёт БД.
ВНИМАНИЕ: все данные будут уничтожены!

Использование:
    python recreate_db.py --confirm
"""
import asyncio
import logging
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# Tables in drop order (respect FK deps)
DROP_ORDER = [
    "operator_usdt_payment_allocations",
    "operator_usdt_payments",
    "operator_usdt_payment_intents",
    "operator_usdt_debts",
    "operator_shifts",
    "cashier_deposits",
    "cashier_cards",
    "cashier_members",
    "deal_messages",
    "complaints",
    "order_service_messages",
    "orders",
    "referral_bonuses",
    "referrals_withdraw",
    "support_chat_messages",
    "support_chats",
    "operator_manager_messages",
    "support_reviews",
    "reviews",
    "mailings",
    "audit_logs",
    "bot_fee_tiers",
    "bot_requisites",
    "user_bots",
    "requisites",
    "rate_fee_tiers",
    "fees",
    "rates",
    "cashier_teams",
    "system_settings",
    "bots",
    "supports",
    "users",
]


async def main() -> None:
    if "--confirm" not in sys.argv:
        print("⚠️  Это УДАЛИТ все данные!")
        print("Запустите с флагом --confirm для подтверждения:")
        print("    python recreate_db.py --confirm")
        sys.exit(1)

    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        await conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in DROP_ORDER:
            try:
                await conn.execute(text(f"DROP TABLE IF EXISTS `{table}`"))
                log.info(f"DROP  {table}")
            except Exception as e:
                log.warning(f"DROP FAIL {table}: {e}")
        await conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    log.info("✅ Все таблицы удалены")

    await engine.dispose()

    # Now run create_tables
    from create_tables import main as create_main
    await create_main()


if __name__ == "__main__":
    asyncio.run(main())
