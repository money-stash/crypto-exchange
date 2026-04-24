from contextlib import asynccontextmanager
import logging

import socketio
import sqlalchemy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

from app.config import settings
from app.database import engine
from app.routers import (
    auth, supports, orders, bots, rates, support_chats,
    users, operator_manager_chats, referral_withdrawals,
    audit_logs, settings as settings_router, fees, mailings, uploads,
    deals, shifts, finance, cashiers,
)
import app.socket.socket_service as socket_service
from bot.manager import bot_manager

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.connect() as conn:
        await conn.execute(sqlalchemy.text("SELECT 1"))
    print("✅ Database connected")
    await bot_manager.initialize()
    yield
    await bot_manager.stop_all()
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






