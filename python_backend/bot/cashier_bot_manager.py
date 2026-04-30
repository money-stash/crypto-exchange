"""
Cashier team bot manager.

One bot per cashier TEAM (cashier_teams.bot_token).
Each individual cashier links their Telegram by typing their login in the bot.
Notifications go to the specific cashier's personal tg_id via the team's bot.
"""
import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from sqlalchemy import text

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


class LinkStates(StatesGroup):
    waiting_login = State()


class CashierBotManager:
    def __init__(self):
        self._bots: dict[int, Bot] = {}          # team_id → Bot
        self._tasks: dict[int, asyncio.Task] = {}

    async def start_all(self) -> None:
        async with AsyncSessionLocal() as db:
            rows = await db.execute(text(
                "SELECT id, name, bot_token FROM cashier_teams "
                "WHERE bot_token IS NOT NULL AND bot_token != ''"
            ))
            teams = [dict(r._mapping) for r in rows]
        for t in teams:
            await self.start_bot(t["id"], t["bot_token"])

    async def start_bot(self, team_id: int, token: str) -> None:
        await self.stop_bot(team_id)
        try:
            bot = Bot(token=token, default=DefaultBotProperties(parse_mode="HTML"))
            dp = Dispatcher()
            dp.include_router(_make_router(team_id))
            task = asyncio.create_task(
                self._run_polling(team_id, bot, dp),
                name=f"cashier_team_bot_{team_id}",
            )
            self._bots[team_id] = bot
            self._tasks[team_id] = task
            logger.info(f"[CashierBot] Started bot for team_id={team_id}")
        except Exception as e:
            logger.error(f"[CashierBot] Failed to start bot for team_id={team_id}: {e}")

    async def stop_bot(self, team_id: int) -> None:
        task = self._tasks.pop(team_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=3)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        bot = self._bots.pop(team_id, None)
        if bot:
            await bot.session.close()

    async def stop_all(self) -> None:
        for team_id in list(self._bots.keys()):
            await self.stop_bot(team_id)

    async def _run_polling(self, team_id: int, bot: Bot, dp: Dispatcher) -> None:
        try:
            await dp.start_polling(bot, allowed_updates=["message", "callback_query"])
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[CashierBot] Polling error for team_id={team_id}: {e}")

    async def send_to_cashier(
        self,
        team_id: int,
        tg_id: int,
        text_msg: str,
        reply_markup: InlineKeyboardMarkup | None = None,
    ) -> None:
        """Send message to a specific cashier via their team's bot."""
        bot = self._bots.get(team_id)
        if not bot:
            logger.warning(f"[CashierBot] No bot running for team_id={team_id}")
            return
        try:
            await bot.send_message(
                chat_id=int(tg_id),
                text=text_msg,
                reply_markup=reply_markup,
            )
        except Exception as e:
            logger.warning(f"[CashierBot] Failed to send to tg_id={tg_id}: {e}")


cashier_bot_manager = CashierBotManager()


def _make_router(team_id: int) -> Router:
    router = Router()

    @router.message(CommandStart())
    async def on_start(message: Message, state: FSMContext) -> None:
        await state.set_state(LinkStates.waiting_login)
        await message.answer(
            "👋 <b>Добро пожаловать в систему уведомлений!</b>\n\n"
            "Введите ваш <b>логин</b> от личного кабинета кассира:"
        )

    @router.message(LinkStates.waiting_login)
    async def on_login(message: Message, state: FSMContext) -> None:
        login = (message.text or "").strip()
        tg_id = message.from_user.id

        async with AsyncSessionLocal() as db:
            row = await db.execute(
                text(
                    "SELECT id FROM supports "
                    "WHERE login = :login AND role = 'CASHIER' AND team_id = :tid"
                ),
                {"login": login, "tid": team_id},
            )
            cashier = row.fetchone()

            if not cashier:
                await message.answer(
                    "❌ Кассир с таким логином не найден в вашей команде.\n"
                    "Проверьте логин и попробуйте снова."
                )
                return

            cashier_id = cashier[0]
            await db.execute(
                text("UPDATE supports SET tg_id = :tg_id WHERE id = :id"),
                {"tg_id": tg_id, "id": cashier_id},
            )
            await db.commit()

        await state.clear()
        await message.answer(
            "✅ <b>Telegram успешно привязан!</b>\n\n"
            "Теперь уведомления о заявках будут приходить прямо сюда.\n"
            "Вы сможете подтверждать оплату не выходя из Telegram."
        )

    @router.callback_query(lambda c: c.data and c.data.startswith("cashier_confirm_"))
    async def on_confirm(callback: CallbackQuery) -> None:
        order_id = int(callback.data.split("_")[2])
        tg_id = callback.from_user.id

        async with AsyncSessionLocal() as db:
            # Verify this tg_id belongs to a cashier in this team
            member_row = await db.execute(
                text(
                    "SELECT s.id AS cashier_id FROM supports s "
                    "WHERE s.tg_id = :tid AND s.team_id = :team AND s.role = 'CASHIER'"
                ),
                {"tid": tg_id, "team": team_id},
            )
            member = member_row.fetchone()
            if not member:
                await callback.answer("⛔ У вас нет доступа.", show_alert=True)
                return
            cashier_id = member[0]

            # Verify this order belongs to this cashier
            order_row = await db.execute(
                text("""
                    SELECT o.* FROM orders o
                    JOIN cashier_cards cc ON cc.id = o.cashier_card_id AND cc.cashier_id = :cid
                    WHERE o.id = :oid LIMIT 1
                """),
                {"cid": cashier_id, "oid": order_id},
            )
            order = order_row.mappings().one_or_none()
            if not order:
                await callback.answer("❌ Заявка не найдена или не ваша.", show_alert=True)
                return
            order = dict(order)

            if order["status"] != "AWAITING_CONFIRM":
                await callback.answer(
                    f"Заявка уже обработана (статус: {order['status']})",
                    show_alert=True,
                )
                await callback.message.edit_reply_markup(reply_markup=None)
                return

            sum_rub = float(order.get("sum_rub") or 0)

            # Check team deposit
            dep_row = await db.execute(
                text("SELECT deposit, deposit_work FROM supports WHERE id = :id"),
                {"id": cashier_id},
            )
            dep = dep_row.mappings().one_or_none()
            if dep:
                available = float(dep["deposit"] or 0) - float(dep["deposit_work"] or 0)
                if available < sum_rub:
                    await callback.answer(
                        f"❌ Недостаточно средств в депозите.\n"
                        f"Доступно: {available:,.2f} ₽, нужно: {sum_rub:,.2f} ₽",
                        show_alert=True,
                    )
                    return
                await db.execute(
                    text("UPDATE supports SET deposit_work = deposit_work + :amt WHERE id = :id"),
                    {"amt": sum_rub, "id": cashier_id},
                )

            await db.execute(
                text("""
                    UPDATE orders SET
                        status = 'AWAITING_HASH',
                        sla_user_paid_at = COALESCE(sla_user_paid_at, NOW()),
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {"id": order_id},
            )
            await db.commit()

        # Emit socket events
        try:
            from app.routers.orders import ORDER_SELECT
            import app.socket.socket_service as sio
            async with AsyncSessionLocal() as db2:
                updated_row = await db2.execute(
                    text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id}
                )
                updated_order = dict(updated_row.mappings().one())
            await sio.emit_order_status_changed({
                "orderId": order_id,
                "oldStatus": "AWAITING_CONFIRM",
                "newStatus": "AWAITING_HASH",
                "order": updated_order,
            })
            await sio.emit_order_updated(updated_order)
        except Exception as e:
            logger.warning(f"[CashierBot] Socket emit failed for order {order_id}: {e}")

        await callback.answer("✅ Оплата подтверждена!")
        try:
            await callback.message.edit_text(
                callback.message.text + "\n\n✅ <b>ПОДТВЕРЖДЕНО</b>",
                reply_markup=None,
            )
        except Exception:
            pass

    return router
