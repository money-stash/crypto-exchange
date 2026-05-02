from contextlib import asynccontextmanager
import logging
import asyncio

import socketio
import sqlalchemy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.database import engine
from app.routers import (
    auth, supports, orders, bots, rates, support_chats,
    users, operator_manager_chats, referral_withdrawals,
    audit_logs, settings as settings_router, fees, mailings, uploads,
    deals, shifts, finance, cashiers, coupons,
)
import app.socket.socket_service as socket_service
from bot.manager import bot_manager
from bot.cashier_bot_manager import cashier_bot_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
)
socket_service.init(sio)


@sio.event
async def connect(sid, environ, auth_data):
    logger.info(f"[SOCKET] connect sid={sid}")


@sio.event
async def disconnect(sid):
    logger.info(f"[SOCKET] disconnect sid={sid}")


@sio.on("authenticate")
async def on_authenticate(sid, data):
    """
    Frontend sends: socket.emit('authenticate', { token })
    Decode JWT, join appropriate rooms.
    """
    token = (data or {}).get("token")
    if not token:
        logger.warning(f"[SOCKET] authenticate sid={sid} — no token")
        await sio.emit("authenticated", {"success": False, "error": "No token"}, to=sid)
        return

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": False},
        )
    except JWTError as e:
        logger.warning(f"[SOCKET] authenticate sid={sid} — JWT error: {e}")
        await sio.emit("authenticated", {"success": False, "error": "Invalid token"}, to=sid)
        return

    role = payload.get("role", "")
    user_id = payload.get("id")
    bot_id = payload.get("botId")

    rooms = []
    if role:
        await sio.enter_room(sid, f"role:{role}")
        rooms.append(f"role:{role}")
    if role == "OPERATOR":
        await sio.enter_room(sid, "operators")
        rooms.append("operators")
    if user_id:
        await sio.enter_room(sid, f"user:{user_id}")
        rooms.append(f"user:{user_id}")
    if bot_id:
        await sio.enter_room(sid, f"bot:{bot_id}")
        rooms.append(f"bot:{bot_id}")

    logger.info(f"[SOCKET] authenticated sid={sid} user_id={user_id} role={role} rooms={rooms}")
    await sio.emit("authenticated", {"success": True, "userId": user_id, "role": role}, to=sid)


async def _update_rates_job():
    """Фоновое задание — обновляет курсы с внешних бирж."""
    try:
        from app.routers.rates import (
            _fetch_usdt_rub, _fetch_spot_ask, _fetch_xmr_usdt_kraken,
        )
        from app.database import AsyncSessionLocal
        from sqlalchemy import text as _text

        usdt_rub, btc_usdt, ltc_usdt, xmr_usdt = await asyncio.gather(
            _fetch_usdt_rub(position=3),
            _fetch_spot_ask("BTCUSDT"),
            _fetch_spot_ask("LTCUSDT"),
            _fetch_xmr_usdt_kraken(),
        )
        market = {
            "USDT": usdt_rub,
            "BTC":  btc_usdt * usdt_rub,
            "LTC":  ltc_usdt * usdt_rub,
            "XMR":  xmr_usdt * usdt_rub,
        }
        async with AsyncSessionLocal() as db:
            for coin, rate_rub in market.items():
                row = await db.execute(
                    _text("SELECT is_manual FROM rates WHERE coin = :coin"), {"coin": coin}
                )
                existing = row.mappings().one_or_none()
                if existing and existing["is_manual"] == 1:
                    continue
                await db.execute(_text("""
                    INSERT INTO rates (coin, rate_rub, src, is_manual, manual_rate_rub)
                    VALUES (:coin, :rate_rub, :src, 0, NULL)
                    ON DUPLICATE KEY UPDATE
                        rate_rub = VALUES(rate_rub), src = VALUES(src), updated_at = NOW()
                """), {"coin": coin, "rate_rub": rate_rub,
                       "src": "bybit_p2p" if coin == "USDT" else "bybit_kraken"})
            await db.commit()
        logger.info(f"✅ Rates updated: BTC={market['BTC']:.0f} LTC={market['LTC']:.0f} "
                    f"XMR={market['XMR']:.0f} USDT={market['USDT']:.2f}")
    except Exception as exc:
        logger.warning(f"⚠️  Rate update failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.connect() as conn:
        await conn.execute(sqlalchemy.text("SELECT 1"))
    print("✅ Database connected")
    await bot_manager.initialize()
    await cashier_bot_manager.start_all()

    # Сразу обновляем курсы при старте
    await _update_rates_job()

    # Планировщик: обновляем курсы каждые 5 минут
    scheduler = AsyncIOScheduler()
    scheduler.add_job(_update_rates_job, "interval", minutes=5, id="update_rates")
    scheduler.start()
    logger.info("✅ Rate scheduler started (every 5 min)")

    yield

    scheduler.shutdown(wait=False)
    await bot_manager.stop_all()
    await cashier_bot_manager.stop_all()
    await engine.dispose()
    print("🛑 Database disconnected")


fastapi_app = FastAPI(
    title="Kazah Exchange API",
    version="1.0.0",
    lifespan=lifespan,
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

fastapi_app.include_router(auth.router)
fastapi_app.include_router(supports.router)
fastapi_app.include_router(orders.router)
fastapi_app.include_router(bots.router)
fastapi_app.include_router(rates.router)
fastapi_app.include_router(support_chats.router)
fastapi_app.include_router(users.router)
fastapi_app.include_router(operator_manager_chats.router)
fastapi_app.include_router(referral_withdrawals.router)
fastapi_app.include_router(audit_logs.router)
fastapi_app.include_router(settings_router.router)
fastapi_app.include_router(fees.router)
fastapi_app.include_router(mailings.router)
fastapi_app.include_router(uploads.router)
fastapi_app.include_router(deals.router)
fastapi_app.include_router(shifts.router)
fastapi_app.include_router(finance.router)
fastapi_app.include_router(cashiers.router)
fastapi_app.include_router(coupons.router)

import os as _os
_os.makedirs("uploads/chats", exist_ok=True)
_os.makedirs("uploads/mailings", exist_ok=True)
fastapi_app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@fastapi_app.get("/health")
async def health():
    return {"status": "ok"}


# socketio.ASGIApp is the outermost ASGI app — recommended pattern for
# python-socketio + FastAPI. socketio handles /socket.io/* paths itself
# (cors_allowed_origins='*' set above), all other requests go to fastapi_app.
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)






