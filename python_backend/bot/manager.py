import asyncio
import logging
from dataclasses import dataclass, field

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from sqlalchemy import text

from app.database import AsyncSessionLocal
from bot.routers import start as start_router
from bot.routers import buy as buy_router
from bot.routers import sell as sell_router
from bot.routers import order_chat as order_chat_router

logger = logging.getLogger(__name__)


@dataclass
class BotInstance:
    bot_id: int
    config: dict
    bot: Bot
    dp: Dispatcher
    task: asyncio.Task | None = field(default=None, repr=False)


class BotManager:
    def __init__(self):
        self._bots: dict[int, BotInstance] = {}

    # ── public API ──────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        """Load all active bots from DB and start polling."""
        configs = await self._load_active_configs()
        logger.info(f"Found {len(configs)} active bot(s) in DB")
        for cfg in configs:
            await self._start(cfg)

    async def start_bot(self, bot_id: int) -> None:
        """Start a single bot by its DB id (reload config from DB)."""
        async with AsyncSessionLocal() as db:
            row = await db.execute(
                text("SELECT id, name, token, identifier, is_active, start_message, reviews_chat_link "
                     "FROM bots WHERE id = :id"),
                {"id": bot_id}
            )
            r = row.fetchone()
        if not r:
            logger.warning(f"Bot {bot_id} not found in DB")
            return
        await self._start(dict(r._mapping))

    async def stop_bot(self, bot_id: int) -> None:
        instance = self._bots.get(bot_id)
        if not instance:
            return
        try:
            if instance.task and not instance.task.done():
                instance.task.cancel()
                try:
                    await instance.task
                except asyncio.CancelledError:
                    pass
            await instance.bot.session.close()
        except Exception as e:
            logger.error(f"Error stopping bot {bot_id}: {e}")
        finally:
            self._bots.pop(bot_id, None)
            logger.info(f"🛑 Bot {instance.config['name']} stopped")

    async def restart_bot(self, bot_id: int) -> None:
        await self.stop_bot(bot_id)
        await self.start_bot(bot_id)

    async def stop_all(self) -> None:
        for bot_id in list(self._bots.keys()):
            await self.stop_bot(bot_id)

    async def reload_bots(self) -> None:
        """Sync running bots with DB state (add new, stop removed)."""
        configs = {c["id"]: c for c in await self._load_active_configs()}
        for bot_id in list(self._bots.keys()):
            if bot_id not in configs:
                await self.stop_bot(bot_id)
        for bot_id, cfg in configs.items():
            if bot_id not in self._bots:
                await self._start(cfg)

    def get_bot(self, bot_id: int) -> Bot | None:
        inst = self._bots.get(bot_id)
        return inst.bot if inst else None

    def is_running(self, bot_id: int) -> bool:
        return bot_id in self._bots

    async def send_message(self, bot_id: int, tg_id: int, text_: str, **kwargs) -> bool:
        """Send a message to a Telegram user via a specific bot."""
        inst = self._bots.get(bot_id)
        if not inst:
            logger.warning(f"Bot {bot_id} not running — cannot send message to {tg_id}")
            return False
        try:
            await inst.bot.send_message(tg_id, text_, **kwargs)
            return True
        except Exception as e:
            logger.error(f"Failed to send message to {tg_id} via bot {bot_id}: {e}")
            return False

    # ── internals ───────────────────────────────────────────────────────────

    async def _start(self, config: dict) -> None:
        bot_id = config["id"]
        if bot_id in self._bots:
            logger.warning(f"Bot {config['name']} is already running, skipping")
            return

        try:
            bot = Bot(
                token=config["token"],
                default=DefaultBotProperties(parse_mode=ParseMode.HTML),
            )
            dp = Dispatcher(storage=MemoryStorage())

            # Register routers — order matters: specific states before catch-all
            dp.include_router(buy_router.router)
            dp.include_router(sell_router.router)
            dp.include_router(order_chat_router.router)
            dp.include_router(start_router.router)

            # Set Telegram command menu
            try:
                await bot.set_my_commands([{"command": "start", "description": "🏠 Главное меню"}])
            except Exception as e:
                logger.warning(f"Could not set commands for bot {config['name']}: {e}")

            # Start polling in background task; bot_config is injected into all handlers
            task = asyncio.create_task(
                dp.start_polling(bot, bot_config=config),
                name=f"bot-{bot_id}-{config['identifier']}",
            )
            task.add_done_callback(lambda t: self._on_task_done(bot_id, t))

            self._bots[bot_id] = BotInstance(
                bot_id=bot_id, config=config, bot=bot, dp=dp, task=task
            )
            logger.info(f"✅ Bot '{config['name']}' (@{config['identifier']}) started")

        except Exception as e:
            logger.error(f"❌ Failed to start bot '{config['name']}': {e}")

    def _on_task_done(self, bot_id: int, task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error(f"Bot {bot_id} polling task crashed: {exc}")
        self._bots.pop(bot_id, None)

    async def _load_active_configs(self) -> list[dict]:
        async with AsyncSessionLocal() as db:
            rows = await db.execute(text(
                "SELECT id, name, token, identifier, is_active, start_message, reviews_chat_link "
                "FROM bots WHERE is_active = 1"
            ))
            return [dict(r._mapping) for r in rows.fetchall()]


# Singleton — imported everywhere that needs to send messages
bot_manager = BotManager()



