import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.models.bot import Bot, BotRequisite, BotFeeTier
from app.models.support import Support
from bot.manager import bot_manager

router = APIRouter(prefix="/api/bots", tags=["bots"])

require_bot_mgmt = require_roles("SUPERADMIN", "EX_ADMIN", "MANAGER")
require_admin_ex = require_roles("SUPERADMIN", "EX_ADMIN")


class BotCreate(BaseModel):
    name: str
    identifier: str
    token: str
    description: Optional[str] = None
    exchange_chat_link: Optional[str] = None
    reviews_chat_link: Optional[str] = None
    reviews_chat_id: Optional[str] = None
    is_active: bool = True
    start_message: Optional[str] = None
    contacts_message: Optional[str] = None


class BotUpdate(BaseModel):
    name: Optional[str] = None
    identifier: Optional[str] = None
    token: Optional[str] = None
    description: Optional[str] = None
    exchange_chat_link: Optional[str] = None
    reviews_chat_link: Optional[str] = None
    reviews_chat_id: Optional[str] = None
    is_active: Optional[bool] = None
    start_message: Optional[str] = None
    contacts_message: Optional[str] = None


class BotRequisiteCreate(BaseModel):
    type: str
    address: str
    bank_name: Optional[str] = None
    holder_name: Optional[str] = None
    label: Optional[str] = None
    is_active: bool = True
    is_default: bool = False
    support_id: Optional[int] = None
    order_id: Optional[int] = None


class FeeTierCreate(BaseModel):
    coin: str
    min_amount: float = 0
    max_amount: Optional[float] = None
    buy_fee: float = 0
    sell_fee: float = 0
    id: Optional[int] = None


class BulkFeeTiersUpdate(BaseModel):
    coin: str
    tiers: list[FeeTierCreate]


async def _check_bot_access(bot_id: int, user: Support, db: AsyncSession, write: bool = False) -> Bot:
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(404, "Bot not found")
    if user.role == "SUPERADMIN":
        return bot
    if user.role == "MANAGER" and not write:
        return bot
    if user.role == "EX_ADMIN" and bot.owner_id == user.id:
        return bot
    raise HTTPException(403, "Insufficient permissions")


@router.get("/stats/manager")
async def get_manager_stats(
    current_user: Support = Depends(require_roles("SUPERADMIN", "MANAGER")),
    db: AsyncSession = Depends(get_db),
):
    # Bots count
    bots_row = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN is_active = 1 THEN 1 END) AS active
        FROM bots
    """))
    bots = dict(bots_row.mappings().one())

    # Overall orders
    overall_row = await db.execute(text("""
        SELECT
            COUNT(*) AS total_orders,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS total_volume
        FROM orders
    """))
    overall = dict(overall_row.mappings().one())

    # Today
    today_row = await db.execute(text("""
        SELECT
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS volume
        FROM orders WHERE DATE(created_at) = CURDATE()
    """))
    today = dict(today_row.mappings().one())

    # Monthly
    monthly_row = await db.execute(text("""
        SELECT
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS volume
        FROM orders
        WHERE YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())
    """))
    monthly = dict(monthly_row.mappings().one())

    # Top bots by completed orders
    top_bots_rows = await db.execute(text("""
        SELECT
            b.name, b.identifier,
            COUNT(o.id) AS total_orders,
            COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub END), 0) AS total_volume,
            COALESCE(AVG(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub END), 0) AS avg_order_value
        FROM bots b
        LEFT JOIN orders o ON o.bot_id = b.id
        GROUP BY b.id, b.name, b.identifier
        ORDER BY completed_orders DESC
        LIMIT 10
    """))
    top_bots = [dict(r._mapping) for r in top_bots_rows]
    for bot in top_bots:
        tot = int(bot["total_orders"] or 0)
        comp = int(bot["completed_orders"] or 0)
        bot["total_orders"] = tot
        bot["completed_orders"] = comp
        bot["total_volume"] = float(bot["total_volume"] or 0)
        bot["avg_order_value"] = float(bot["avg_order_value"] or 0)
        bot["completion_rate"] = round(comp / tot * 100, 1) if tot > 0 else 0

    # Top currencies
    currencies_rows = await db.execute(text("""
        SELECT
            coin,
            COUNT(*) AS total_orders,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS total_volume
        FROM orders
        GROUP BY coin
        ORDER BY completed_orders DESC
        LIMIT 10
    """))
    top_currencies = []
    for r in currencies_rows:
        d = dict(r._mapping)
        tot = int(d["total_orders"] or 0)
        comp = int(d["completed_orders"] or 0)
        d["total_orders"] = tot
        d["completed_orders"] = comp
        d["total_volume"] = float(d["total_volume"] or 0)
        d["completion_rate"] = round(comp / tot * 100, 1) if tot > 0 else 0
        top_currencies.append(d)

    # Daily performance — last 30 days (for DailyPerformanceChart)
    daily_rows = await db.execute(text("""
        SELECT
            DATE(created_at) AS date,
            COUNT(*) AS total_orders,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS total_volume
        FROM orders
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
    """))
    daily_performance = [dict(r._mapping) for r in daily_rows]
    for d in daily_performance:
        d["total_volume"] = float(d["total_volume"] or 0)

    # Bot performance (for BotPerformanceChart)
    bot_perf_rows = await db.execute(text("""
        SELECT
            b.name, b.identifier,
            COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub END), 0) AS total_volume
        FROM bots b
        LEFT JOIN orders o ON o.bot_id = b.id
        GROUP BY b.id, b.name, b.identifier
        ORDER BY completed_orders DESC
        LIMIT 8
    """))
    bot_performance = []
    for r in bot_perf_rows:
        d = dict(r._mapping)
        d["completed_orders"] = int(d["completed_orders"] or 0)
        d["total_volume"] = float(d["total_volume"] or 0)
        bot_performance.append(d)

    return {
        "bots": {
            "total": int(bots["total"] or 0),
            "active": int(bots["active"] or 0),
        },
        "overall": {
            "total_orders": int(overall["total_orders"] or 0),
            "completed_orders": int(overall["completed_orders"] or 0),
            "total_volume": float(overall["total_volume"] or 0),
        },
        "today": {
            "completed": int(today["completed"] or 0),
            "volume": float(today["volume"] or 0),
        },
        "monthly": {
            "completed": int(monthly["completed"] or 0),
            "volume": float(monthly["volume"] or 0),
        },
        "topBots": top_bots,
        "topCurrencies": top_currencies,
        "dailyPerformance": daily_performance,
        "botPerformance": bot_performance,
    }


@router.get("/simple")
async def get_simple_bots(
    current_user: Support = Depends(require_bot_mgmt),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Bot.id, Bot.name, Bot.is_active))
    return [{"id": r.id, "name": r.name, "is_active": r.is_active} for r in result]


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get("/")
async def get_bots(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: Support = Depends(require_bot_mgmt),
    db: AsyncSession = Depends(get_db),
):
    base_filter = Bot.owner_id == current_user.id if current_user.role == "EX_ADMIN" else None

    count_q = select(func.count()).select_from(Bot)
    if base_filter is not None:
        count_q = count_q.where(base_filter)
    total: int = (await db.execute(count_q)).scalar() or 0

    query = select(Bot)
    if base_filter is not None:
        query = query.where(base_filter)
    query = query.offset((page - 1) * limit).limit(limit)

    result = await db.execute(query)
    bots = result.scalars().all()

    bot_list = []
    for b in bots:
        bot_list.append({
            "id": b.id, "name": b.name, "identifier": b.identifier,
            "is_active": b.is_active, "description": b.description,
            "exchange_chat_link": b.exchange_chat_link,
            "reviews_chat_link": b.reviews_chat_link,
            "reviews_chat_id": b.reviews_chat_id,
            "owner_id": b.owner_id, "created_at": b.created_at,
            "start_message": b.start_message, "contacts_message": b.contacts_message,
        })
    return {"data": {"bots": bot_list, "total": total, "pages": math.ceil(total / limit) if total else 1}}


# ---------------------------------------------------------------------------
# POST /
# ---------------------------------------------------------------------------

@router.post("/", status_code=201)
async def create_bot(
    body: BotCreate,
    current_user: Support = Depends(require_admin_ex),
    db: AsyncSession = Depends(get_db),
):
    dup_id = await db.execute(select(Bot).where(Bot.identifier == body.identifier))
    if dup_id.scalar_one_or_none():
        raise HTTPException(400, "Bot identifier already exists")
    dup_tok = await db.execute(select(Bot).where(Bot.token == body.token))
    if dup_tok.scalar_one_or_none():
        raise HTTPException(400, "Bot token already exists")

    bot = Bot(
        name=body.name, identifier=body.identifier, token=body.token,
        description=body.description, is_active=body.is_active,
        exchange_chat_link=body.exchange_chat_link,
        reviews_chat_link=body.reviews_chat_link,
        reviews_chat_id=body.reviews_chat_id,
        owner_id=current_user.id,
        start_message=body.start_message,
        contacts_message=body.contacts_message,
    )
    db.add(bot)
    await db.flush()

    # Создаём дефолтные комиссии
    for coin in ("BTC", "LTC", "XMR", "USDT"):
        db.add(BotFeeTier(bot_id=bot.id, coin=coin, min_amount=0, buy_fee=0, sell_fee=0))

    await db.commit()

    if bot.is_active:
        await bot_manager.start_bot(bot.id)

    return {"id": bot.id, "name": bot.name, "identifier": bot.identifier}


# ---------------------------------------------------------------------------
# GET /:id
# ---------------------------------------------------------------------------

@router.get("/{bot_id}")
async def get_bot(
    bot_id: int,
    current_user: Support = Depends(require_bot_mgmt),
    db: AsyncSession = Depends(get_db),
):
    bot = await _check_bot_access(bot_id, current_user, db)

    reqs_result = await db.execute(select(BotRequisite).where(BotRequisite.bot_id == bot_id))
    requisites = reqs_result.scalars().all()

    return {
        "id": bot.id, "name": bot.name, "identifier": bot.identifier,
        "token": bot.token, "description": bot.description,
        "is_active": bot.is_active,
        "exchange_chat_link": bot.exchange_chat_link,
        "reviews_chat_link": bot.reviews_chat_link,
        "reviews_chat_id": bot.reviews_chat_id,
        "owner_id": bot.owner_id, "created_at": bot.created_at,
        "start_message": bot.start_message,
        "contacts_message": bot.contacts_message,
        "requisites": [
            {"id": r.id, "type": r.type, "address": r.address,
             "bank_name": r.bank_name, "holder_name": r.holder_name,
             "label": r.label, "is_active": r.is_active, "is_default": r.is_default,
             "support_id": r.support_id}
            for r in requisites
        ],
    }


# ---------------------------------------------------------------------------
# PUT /:id
# ---------------------------------------------------------------------------

@router.put("/{bot_id}")
async def update_bot(
    bot_id: int,
    body: BotUpdate,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bot = await _check_bot_access(bot_id, current_user, db, write=True)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(bot, field, value)
    await db.commit()

    if bot.is_active:
        await bot_manager.restart_bot(bot.id)
    else:
        await bot_manager.stop_bot(bot.id)

    return {"id": bot.id, "name": bot.name, "is_active": bot.is_active}


# ---------------------------------------------------------------------------
# PATCH /:id/toggle
# ---------------------------------------------------------------------------

@router.patch("/{bot_id}/toggle")
async def toggle_bot_status(
    bot_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bot = await _check_bot_access(bot_id, current_user, db, write=True)
    bot.is_active = not bot.is_active
    await db.commit()

    if bot.is_active:
        await bot_manager.start_bot(bot.id)
    else:
        await bot_manager.stop_bot(bot.id)

    return {"id": bot.id, "is_active": bot.is_active}


# ---------------------------------------------------------------------------
# DELETE /:id
# ---------------------------------------------------------------------------

@router.delete("/{bot_id}")
async def delete_bot(
    bot_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bot = await _check_bot_access(bot_id, current_user, db, write=True)
    # Stop the bot first so polling is terminated before the DB record is gone
    await bot_manager.stop_bot(bot_id)
    await db.delete(bot)
    return {"message": "Bot deleted successfully"}


# ---------------------------------------------------------------------------
# GET /:id/stats
# ---------------------------------------------------------------------------

@router.get("/{bot_id}/stats")
async def get_bot_stats(
    bot_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db)
    orders_row = await db.execute(text("""
        SELECT
            COUNT(*) AS total_orders,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_orders,
            COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_orders,
            COUNT(CASE WHEN status IN ('QUEUED','PAYMENT_PENDING','AWAITING_CONFIRM','AWAITING_HASH') THEN 1 END) AS active_orders,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS total_volume,
            COALESCE(AVG(CASE WHEN status = 'COMPLETED' THEN sum_rub END), 0) AS avg_order_value
        FROM orders WHERE bot_id = :id
    """), {"id": bot_id})
    users_row = await db.execute(text("""
        SELECT COUNT(DISTINCT tg_id) AS unique_users FROM user_bots WHERE bot_id = :id
    """), {"id": bot_id})

    orders = dict(orders_row.mappings().one())
    users = dict(users_row.mappings().one())

    return {
        "orders": orders,
        "users": users,
    }


# ---------------------------------------------------------------------------
# Requisites
# ---------------------------------------------------------------------------

@router.post("/{bot_id}/requisites", status_code=201)
async def create_bot_requisite(
    bot_id: int,
    body: BotRequisiteCreate,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import logging as _logging
    _log = _logging.getLogger(__name__)

    await _check_bot_access(bot_id, current_user, db, write=True)
    req = BotRequisite(
        bot_id=bot_id, type=body.type, address=body.address,
        bank_name=body.bank_name, holder_name=body.holder_name,
        label=body.label, is_active=body.is_active,
        is_default=body.is_default, support_id=body.support_id,
    )
    db.add(req)
    await db.flush()

    # If order_id provided — update order's exchanger requisite fields
    order_info = None
    if body.order_id:
        is_crypto = body.type not in ("CARD", "SBP")
        if is_crypto:
            await db.execute(
                text("""
                    UPDATE orders SET
                        exch_req_id = :req_id,
                        exch_crypto_address = :address,
                        exch_card_number = NULL,
                        exch_sbp_phone = NULL,
                        exch_card_holder = NULL,
                        exch_bank_name = NULL,
                        updated_at = NOW()
                    WHERE id = :order_id
                """),
                {
                    "req_id": req.id,
                    "address": body.address,
                    "order_id": body.order_id,
                },
            )
        else:
            card_num = body.address if body.type == "CARD" else None
            sbp_phone = body.address if body.type == "SBP" else None
            await db.execute(
                text("""
                    UPDATE orders SET
                        exch_req_id = :req_id,
                        exch_card_number = :card_number,
                        exch_sbp_phone = :sbp_phone,
                        exch_card_holder = :holder,
                        exch_bank_name = :bank,
                        exch_crypto_address = NULL,
                        updated_at = NOW()
                    WHERE id = :order_id
                """),
                {
                    "req_id": req.id,
                    "card_number": card_num,
                    "sbp_phone": sbp_phone,
                    "holder": body.holder_name or "",
                    "bank": body.bank_name or "",
                    "order_id": body.order_id,
                },
            )

        # Fetch order to send Telegram notification
        order_row = await db.execute(
            text("""
                SELECT o.id, o.unique_id, o.dir, o.coin, o.bot_id, o.status,
                       u.tg_id
                FROM orders o
                JOIN users u ON u.id = o.user_id
                WHERE o.id = :order_id
            """),
            {"order_id": body.order_id},
        )
        order_info = order_row.fetchone()

    await db.commit()

    # Send Telegram message to client after commit
    if order_info and order_info.tg_id:
        try:
            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
            is_crypto = body.type not in ("CARD", "SBP")
            if is_crypto:
                # SELL order: client must send crypto to this address
                text_msg = (
                    f"📋 <b>Реквизиты для перевода</b>\n\n"
                    f"Заявка #{order_info.unique_id}\n"
                    f"Отправьте <b>{order_info.coin}</b> на адрес:\n\n"
                    f"<code>{body.address}</code>"
                )
                if body.label:
                    text_msg += f"\n\nКомментарий: {body.label}"
                markup = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(
                        text="✅ Я отправил крипту",
                        callback_data=f"user_sent_crypto:{order_info.id}",
                    )
                ]])
                await bot_manager.send_message(
                    order_info.bot_id,
                    order_info.tg_id,
                    text_msg,
                    parse_mode="HTML",
                    reply_markup=markup,
                )
            else:
                # BUY order: client must pay RUB to this card/SBP
                if body.type == "SBP":
                    details = f"Номер СБП: <code>{body.address}</code>"
                else:
                    details = f"Номер карты: <code>{body.address}</code>"
                if body.bank_name:
                    details += f"\nБанк: {body.bank_name}"
                if body.holder_name:
                    details += f"\nПолучатель: {body.holder_name}"
                if body.label:
                    details += f"\nКомментарий: {body.label}"
                text_msg = (
                    f"📋 <b>Реквизиты для оплаты</b>\n\n"
                    f"Заявка #{order_info.unique_id}\n"
                    f"Переведите рубли по реквизитам:\n\n"
                    f"{details}"
                )
                await bot_manager.send_message(
                    order_info.bot_id,
                    order_info.tg_id,
                    text_msg,
                    parse_mode="HTML",
                )
        except Exception as e:
            _log.warning(f"[BOTS] Failed to send requisites notification for order {body.order_id}: {e}")

    return {"id": req.id, "bot_id": req.bot_id, "type": req.type, "address": req.address}


@router.put("/{bot_id}/requisites/{req_id}")
async def update_bot_requisite(
    bot_id: int, req_id: int,
    body: dict,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)
    result = await db.execute(select(BotRequisite).where(BotRequisite.id == req_id, BotRequisite.bot_id == bot_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requisite not found")
    for field, value in body.items():
        if hasattr(req, field):
            setattr(req, field, value)
    return {"id": req.id, "type": req.type, "address": req.address}


@router.delete("/{bot_id}/requisites/{req_id}")
async def delete_bot_requisite(
    bot_id: int, req_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)
    result = await db.execute(select(BotRequisite).where(BotRequisite.id == req_id, BotRequisite.bot_id == bot_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requisite not found")
    await db.delete(req)
    return {"message": "Requisite deleted successfully"}


# ---------------------------------------------------------------------------
# Bot control (stubs — BotManager реализуется позже с aiogram)
# ---------------------------------------------------------------------------

@router.post("/{bot_id}/start")
async def start_bot(bot_id: int, current_user: Support = Depends(get_current_user)):
    await bot_manager.start_bot(bot_id)
    return {"message": "Бот запущен", "running": bot_manager.is_running(bot_id)}


@router.post("/{bot_id}/stop")
async def stop_bot_endpoint(bot_id: int, current_user: Support = Depends(get_current_user)):
    await bot_manager.stop_bot(bot_id)
    return {"message": "Бот остановлен", "running": False}


@router.post("/{bot_id}/restart")
async def restart_bot_endpoint(bot_id: int, current_user: Support = Depends(get_current_user)):
    await bot_manager.restart_bot(bot_id)
    return {"message": "Бот перезапущен", "running": bot_manager.is_running(bot_id)}


@router.get("/{bot_id}/status")
async def get_bot_status(bot_id: int, current_user: Support = Depends(get_current_user)):
    running = bot_manager.is_running(bot_id)
    return {"bot_id": bot_id, "running": running, "status": "running" if running else "stopped"}


# ---------------------------------------------------------------------------
# Fees
# ---------------------------------------------------------------------------

@router.get("/{bot_id}/fees")
async def get_bot_fees(
    bot_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db)
    rows = await db.execute(
        text("SELECT * FROM fees WHERE bot_id = :id ORDER BY coin"), {"id": bot_id}
    )
    fees = [dict(r._mapping) for r in rows]
    # Если комиссий нет — создаём дефолтные
    if not fees:
        for coin in ("BTC", "LTC", "XMR", "USDT"):
            await db.execute(
                text("INSERT IGNORE INTO fees (coin, bot_id, buy_fee, sell_fee) VALUES (:coin, :bot_id, 0, 0)"),
                {"coin": coin, "bot_id": bot_id},
            )
        rows2 = await db.execute(text("SELECT * FROM fees WHERE bot_id = :id ORDER BY coin"), {"id": bot_id})
        fees = [dict(r._mapping) for r in rows2]
    return fees


@router.put("/{bot_id}/fees")
async def update_bot_fees(
    bot_id: int,
    body: dict,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)
    fees = body.get("fees", [])
    if not isinstance(fees, list):
        raise HTTPException(400, "fees должен быть массивом")
    for fee in fees:
        await db.execute(text("""
            UPDATE fees SET buy_fee = :buy, sell_fee = :sell
            WHERE bot_id = :bot_id AND coin = :coin
        """), {"buy": fee["buy_fee"], "sell": fee["sell_fee"], "bot_id": bot_id, "coin": fee["coin"]})
    return {"success": True, "message": "Комиссии бота обновлены"}


# ---------------------------------------------------------------------------
# Fee Tiers
# ---------------------------------------------------------------------------

@router.get("/{bot_id}/fee-tiers")
async def get_bot_fee_tiers(
    bot_id: int,
    coin: Optional[str] = None,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db)
    query = select(BotFeeTier).where(BotFeeTier.bot_id == bot_id)
    if coin:
        query = query.where(BotFeeTier.coin == coin.upper())
    result = await db.execute(query.order_by(BotFeeTier.coin, BotFeeTier.min_amount))
    tiers = result.scalars().all()
    return [{"id": t.id, "bot_id": t.bot_id, "coin": t.coin,
             "min_amount": float(t.min_amount), "max_amount": float(t.max_amount) if t.max_amount else None,
             "buy_fee": float(t.buy_fee), "sell_fee": float(t.sell_fee)} for t in tiers]


@router.post("/{bot_id}/fee-tiers")
@router.put("/{bot_id}/fee-tiers/{tier_id}")
async def create_or_update_fee_tier(
    bot_id: int,
    body: FeeTierCreate,
    tier_id: Optional[int] = None,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)

    if body.max_amount is not None and body.max_amount <= body.min_amount:
        raise HTTPException(400, "Максимальная сумма должна быть больше минимальной")

    tid = tier_id or body.id
    if tid:
        result = await db.execute(select(BotFeeTier).where(BotFeeTier.id == tid, BotFeeTier.bot_id == bot_id))
        tier = result.scalar_one_or_none()
        if tier:
            tier.coin = body.coin.upper()
            tier.min_amount = body.min_amount
            tier.max_amount = body.max_amount
            tier.buy_fee = body.buy_fee
            tier.sell_fee = body.sell_fee
            await db.flush()
            return {"id": tier.id, "success": True}

    tier = BotFeeTier(bot_id=bot_id, coin=body.coin.upper(),
                      min_amount=body.min_amount, max_amount=body.max_amount,
                      buy_fee=body.buy_fee, sell_fee=body.sell_fee)
    db.add(tier)
    await db.flush()
    return {"id": tier.id, "success": True}


@router.put("/{bot_id}/fee-tiers/bulk")
async def bulk_update_fee_tiers(
    bot_id: int,
    body: BulkFeeTiersUpdate,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)

    # Удаляем все тиры для монеты и пересоздаём
    await db.execute(
        text("DELETE FROM bot_fee_tiers WHERE bot_id = :bot_id AND coin = :coin"),
        {"bot_id": bot_id, "coin": body.coin.upper()},
    )
    new_tiers = []
    for t in body.tiers:
        tier = BotFeeTier(bot_id=bot_id, coin=body.coin.upper(),
                          min_amount=t.min_amount, max_amount=t.max_amount,
                          buy_fee=t.buy_fee, sell_fee=t.sell_fee)
        db.add(tier)
        new_tiers.append(tier)
    await db.flush()
    return {"success": True, "message": f"Сохранено {len(new_tiers)} диапазонов для {body.coin}"}


@router.delete("/{bot_id}/fee-tiers/{tier_id}")
async def delete_fee_tier(
    bot_id: int, tier_id: int,
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_bot_access(bot_id, current_user, db, write=True)
    result = await db.execute(select(BotFeeTier).where(BotFeeTier.id == tier_id, BotFeeTier.bot_id == bot_id))
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(404, "Tier not found")
    await db.delete(tier)
    return {"success": True, "message": "Диапазон комиссий удален"}




