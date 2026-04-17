from contextlib import asynccontextmanager
import logging

import socketio
import sqlalchemy
from fastapi import FastAPI
from jose import JWTError, jwt
from starlette.middleware.cors import CORSMiddleware as StarletteCorsMW

from app.config import settings
from app.database import engine
from app.routers import (
    auth, supports, orders, bots, rates, support_chats,
    users, operator_manager_chats, referral_withdrawals,
    audit_logs, settings as settings_router, fees, mailings, uploads,
)
import app.socket.socket_service as socket_service
from bot.manager import bot_manager

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[],  # CORS handled by outer Starlette middleware
)
socket_service.init(sio)


@sio.event
async def connect(sid, environ, auth_data):
    # auth_data is populated when client passes auth in socket.io options.
    # This frontend uses a custom 'authenticate' event instead, handled below.
    pass


@sio.event
async def disconnect(sid):
    pass


@sio.on("authenticate")
async def on_authenticate(sid, data):
    """
    Frontend sends: socket.emit('authenticate', { token })
    Decode JWT, join appropriate rooms.
    """
    token = (data or {}).get("token")
    if not token:
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
        logger.warning(f"Socket auth failed: {e}")
        await sio.emit("authenticated", {"success": False, "error": "Invalid token"}, to=sid)
        return

    role = payload.get("role", "")
    user_id = payload.get("id")
    bot_id = payload.get("botId")

    if role:
        await sio.enter_room(sid, f"role:{role}")
    if role == "OPERATOR":
        await sio.enter_room(sid, "operators")
    if user_id:
        await sio.enter_room(sid, f"user:{user_id}")
    if bot_id:
        await sio.enter_room(sid, f"bot:{bot_id}")

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


@fastapi_app.get("/health")
async def health():
    return {"status": "ok"}


_socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# Single outer CORS middleware covering ALL requests including socket.io polling
app = StarletteCorsMW(
    _socket_app,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)






