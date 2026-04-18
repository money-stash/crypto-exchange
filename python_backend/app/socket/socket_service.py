"""
SocketService analog backend/src/services/SocketService.js

all methods static, get sio (socketio.AsyncServer) through init().
similar commands Node.js versions — frontend not changed:
  role:SUPERADMIN, role:MANAGER, role:EX_ADMIN
  operators
  user:{userId}
  bot:{botId}
"""

import datetime
import decimal
import logging
import socketio

logger = logging.getLogger(__name__)

sio: socketio.AsyncServer | None = None


def init(server: socketio.AsyncServer) -> None:
    global sio
    sio = server


def _s(obj):
    """Recursively convert non-JSON-serializable types for socket emission."""
    if isinstance(obj, dict):
        return {k: _s(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_s(v) for v in obj]
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    return obj


async def emit_order_created(order: dict) -> None:
    if not sio:
        return
    d = _s(order)
    await sio.emit("order:created", d, room="role:SUPERADMIN")
    await sio.emit("order:created", d, room="role:MANAGER")
    if order.get("bot_id"):
        await sio.emit("order:created", d, room=f"bot:{order['bot_id']}")
    await sio.emit("order:created", d, room="operators")


async def emit_order_updated(order: dict) -> None:
    if not sio:
        return
    d = _s(order)
    await sio.emit("order:updated", d, room="role:SUPERADMIN")
    await sio.emit("order:updated", d, room="role:MANAGER")
    if order.get("bot_id"):
        await sio.emit("order:updated", d, room=f"bot:{order['bot_id']}")
    if order.get("support_id"):
        await sio.emit("order:updated", d, room=f"user:{order['support_id']}")


async def emit_order_status_changed(data: dict) -> None:
    """data = {orderId, oldStatus, newStatus, order}"""
    if not sio:
        return
    d = _s(data)
    order = data.get("order") or {}
    await sio.emit("order:status-changed", d, room="role:SUPERADMIN")
    await sio.emit("order:status-changed", d, room="role:MANAGER")
    if order.get("bot_id"):
        await sio.emit("order:status-changed", d, room=f"bot:{order['bot_id']}")
    if order.get("support_id"):
        await sio.emit("order:status-changed", d, room=f"user:{order['support_id']}")


async def emit_order_taken(order: dict) -> None:
    if not sio:
        return
    d = _s(order)
    await sio.emit("order:taken", d, room="role:SUPERADMIN")
    await sio.emit("order:taken", d, room="role:MANAGER")
    if order.get("bot_id"):
        await sio.emit("order:taken", d, room=f"bot:{order['bot_id']}")
    await sio.emit("order:taken", d, room="operators")


async def emit_order_deleted(order_id: int) -> None:
    if not sio:
        return
    for room in ("role:SUPERADMIN", "role:MANAGER", "role:EX_ADMIN", "operators"):
        await sio.emit("order:deleted", order_id, room=room)


async def emit_order_message(message: dict) -> None:
    if not sio:
        logger.warning("[SOCKET] emit_order_message called but sio is None")
        return
    d = _s(message)
    order_id = message.get("order_id")
    support_id = message.get("support_id")
    bot_id = message.get("bot_id")
    logger.info(
        f"[SOCKET] emit order:message order_id={order_id} support_id={support_id} bot_id={bot_id}"
    )
    await sio.emit("order:message", d, room="role:SUPERADMIN")
    await sio.emit("order:message", d, room="role:MANAGER")
    if bot_id:
        await sio.emit("order:message", d, room=f"bot:{bot_id}")
    if support_id:
        await sio.emit("order:message", d, room=f"user:{support_id}")
        logger.info(f"[SOCKET] emitted order:message to user:{support_id}")
    else:
        logger.warning(f"[SOCKET] order:message order_id={order_id} — support_id is None, operator won't receive it")


async def emit_user_payment_confirmation(data: dict) -> None:
    """data = {order, telegramUser}"""
    if not sio:
        return
    d = _s(data)
    order = data.get("order") or {}
    await sio.emit("user:payment-confirmation", d, room="role:SUPERADMIN")
    await sio.emit("user:payment-confirmation", d, room="role:MANAGER")
    if order.get("bot_id"):
        await sio.emit("user:payment-confirmation", d, room=f"bot:{order['bot_id']}")
    if order.get("support_id"):
        await sio.emit("user:payment-confirmation", d, room=f"user:{order['support_id']}")
    await sio.emit("user:payment-confirmation", d, room="operators")


# ---------------------------------------------------------------------------
# чат поддержки (support-chat)
# ---------------------------------------------------------------------------

async def emit_support_chat_message(chat_id: int, message: dict) -> None:
    if not sio:
        return
    await sio.emit("support-chat:message", _s({"chatId": chat_id, "message": message}))


async def emit_support_chat_read(chat_id: int) -> None:
    if not sio:
        return
    await sio.emit("support-chat:read", {"chatId": chat_id})


async def emit_support_chat_typing(chat_id: int, operator_id: int, operator_login: str, is_typing: bool) -> None:
    if not sio:
        return
    await sio.emit("support-chat:typing", {
        "chatId": chat_id,
        "operatorId": operator_id,
        "operatorLogin": operator_login,
        "isTyping": is_typing,
    })


async def emit_support_chat_deleted(chat_id: int) -> None:
    if not sio:
        return
    await sio.emit("support-chat:deleted", {"chatId": chat_id})


# ---------------------------------------------------------------------------
# Чат оператор ↔ менеджер
# ---------------------------------------------------------------------------

async def emit_operator_manager_message(operator_id: int, manager_id: int, message: dict) -> None:
    if not sio:
        return
    payload = _s({"operator_id": operator_id, "manager_id": manager_id, "message": message})
    if operator_id:
        await sio.emit("operator-manager-chat:message", payload, room=f"user:{operator_id}")
    if manager_id:
        await sio.emit("operator-manager-chat:message", payload, room=f"user:{manager_id}")
    await sio.emit("operator-manager-chat:message", payload, room="role:MANAGER")
    await sio.emit("operator-manager-chat:message", payload, room="role:SUPERADMIN")


async def emit_operator_manager_read(operator_id: int, manager_id: int, reader_role: str, reader_id: int, marked: int) -> None:
    if not sio:
        return
    payload = {
        "operator_id": operator_id,
        "manager_id": manager_id,
        "reader_role": reader_role,
        "reader_id": reader_id,
        "marked": marked,
    }
    if operator_id:
        await sio.emit("operator-manager-chat:read", payload, room=f"user:{operator_id}")
    if manager_id:
        await sio.emit("operator-manager-chat:read", payload, room=f"user:{manager_id}")
    await sio.emit("operator-manager-chat:read", payload, room="role:MANAGER")
    await sio.emit("operator-manager-chat:read", payload, room="role:SUPERADMIN")


async def emit_operator_manager_assignment_updated(operator_id: int, manager_id: int | None) -> None:
    if not sio:
        return
    payload = {"operator_id": operator_id, "manager_id": manager_id}
    if operator_id:
        await sio.emit("operator-manager-chat:assignment-updated", payload, room=f"user:{operator_id}")
    if manager_id:
        await sio.emit("operator-manager-chat:assignment-updated", payload, room=f"user:{manager_id}")
    await sio.emit("operator-manager-chat:assignment-updated", payload, room="role:SUPERADMIN")
    await sio.emit("operator-manager-chat:assignment-updated", payload, room="role:MANAGER")




