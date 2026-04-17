import os
import shutil
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import require_auth, require_roles
from app.models.support import Support
import app.socket.socket_service as sio

router = APIRouter(prefix="/api/support-chats", tags=["support-chats"])

UPLOAD_DIR = "uploads/support-chats"

CHAT_SELECT = """
    SELECT
        sc.*,
        u.username, u.tg_id,
        b.name AS bot_name,
        (SELECT scm.message FROM support_chat_messages scm
         WHERE scm.chat_id = sc.id ORDER BY scm.created_at DESC LIMIT 1) AS last_message,
        (SELECT scm.sender_type FROM support_chat_messages scm
         WHERE scm.chat_id = sc.id ORDER BY scm.created_at DESC LIMIT 1) AS last_message_sender_type,
        (SELECT s2.login FROM support_chat_messages scm2
         LEFT JOIN supports s2 ON scm2.sender_id = s2.id
         WHERE scm2.chat_id = sc.id AND scm2.sender_type = 'OPERATOR'
         ORDER BY scm2.created_at DESC LIMIT 1) AS last_operator_login
    FROM support_chats sc
    LEFT JOIN users u ON sc.user_id = u.id
    LEFT JOIN bots b ON sc.bot_id = b.id
"""

MSG_SELECT = """
    SELECT
        scm.*,
        CASE WHEN scm.sender_type = 'OPERATOR' THEN s.login ELSE u.username END AS sender_name
    FROM support_chat_messages scm
    LEFT JOIN supports s ON scm.sender_type = 'OPERATOR' AND scm.sender_id = s.id
    LEFT JOIN users u ON scm.sender_type = 'USER' AND scm.sender_id = u.id
"""


# ---------------------------------------------------------------------------
# GET /unread-count  — ДО /{chatId}
# ---------------------------------------------------------------------------

@router.get("/unread-count")
async def get_unread_count(
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT COUNT(*) AS count FROM support_chats WHERE unread_count > 0"))
    return {"count": row.scalar()}


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@router.get("/")
async def get_chats(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    botId: Optional[int] = None,
    hasUnread: Optional[str] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    where_parts = ["1=1"]
    params: dict = {}

    if botId:
        where_parts.append("sc.bot_id = :bot_id")
        params["bot_id"] = botId
    if hasUnread == "true":
        where_parts.append("sc.unread_count > 0")

    where = " AND ".join(where_parts)
    params["limit"] = limit
    params["offset"] = (page - 1) * limit

    rows = await db.execute(
        text(f"{CHAT_SELECT} WHERE {where} ORDER BY sc.unread_count DESC, sc.last_message_at DESC, sc.created_at DESC LIMIT :limit OFFSET :offset"),
        params,
    )
    count_row = await db.execute(
        text(f"SELECT COUNT(*) AS total FROM support_chats sc WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    chats = [dict(r._mapping) for r in rows]
    total = count_row.scalar()

    return {"chats": chats, "total": total, "page": page, "pages": -(-total // limit)}


# ---------------------------------------------------------------------------
# GET /{chatId}
# ---------------------------------------------------------------------------

@router.get("/{chat_id}")
async def get_chat_by_id(
    chat_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text(f"{CHAT_SELECT} WHERE sc.id = :id"), {"id": chat_id})
    chat = row.mappings().one_or_none()
    if not chat:
        raise HTTPException(404, "Чат не найден")

    msgs = await db.execute(
        text(f"{MSG_SELECT} WHERE scm.chat_id = :id ORDER BY scm.created_at ASC"),
        {"id": chat_id},
    )
    messages = [dict(m._mapping) for m in msgs]
    return {"chat": dict(chat), "messages": messages}


# ---------------------------------------------------------------------------
# GET /{chatId}/messages
# ---------------------------------------------------------------------------

@router.get("/{chat_id}/messages")
async def get_messages(
    chat_id: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    chat_row = await db.execute(text("SELECT id FROM support_chats WHERE id = :id"), {"id": chat_id})
    if not chat_row.one_or_none():
        raise HTTPException(404, "Чат не найден")

    rows = await db.execute(
        text(f"{MSG_SELECT} WHERE scm.chat_id = :id ORDER BY scm.created_at ASC LIMIT :limit OFFSET :offset"),
        {"id": chat_id, "limit": limit, "offset": offset},
    )
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# POST /{chatId}/messages
# ---------------------------------------------------------------------------

@router.post("/{chat_id}/messages")
async def send_message(
    chat_id: int,
    body: dict,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "Сообщение не может быть пустым")

    chat_row = await db.execute(
        text("SELECT id, bot_id, user_id FROM support_chats WHERE id = :id"), {"id": chat_id}
    )
    chat = chat_row.mappings().one_or_none()
    if not chat:
        raise HTTPException(404, "Чат не найден")

    result = await db.execute(text("""
        INSERT INTO support_chat_messages (chat_id, sender_type, sender_id, message, attachments_path)
        VALUES (:chat_id, 'OPERATOR', :sender_id, :message, NULL)
    """), {"chat_id": chat_id, "sender_id": current_user.id, "message": message})

    msg_id = result.lastrowid
    await db.execute(text("""
        UPDATE support_chats
        SET last_message_at = NOW()
        WHERE id = :id
    """), {"id": chat_id})

    row = await db.execute(
        text(f"{MSG_SELECT} WHERE scm.id = :id"), {"id": msg_id}
    )
    new_msg = dict(row.mappings().one())

    await sio.emit_support_chat_message(chat_id, new_msg)

    # TODO: когда BotManager будет готов — отправлять пользователю в Telegram
    # await bot_manager.send_support_message_to_user(chat_id, message, current_user.login)

    return new_msg


# ---------------------------------------------------------------------------
# POST /{chatId}/upload
# ---------------------------------------------------------------------------

@router.post("/{chat_id}/upload")
async def upload_image(
    chat_id: int,
    image: UploadFile = File(...),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    chat_row = await db.execute(text("SELECT id FROM support_chats WHERE id = :id"), {"id": chat_id})
    if not chat_row.one_or_none():
        raise HTTPException(404, "Чат не найден")

    allowed_ext = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    ext = os.path.splitext(image.filename or "")[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(400, "Поддерживаются только изображения (JPEG, PNG, GIF, WebP)")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"support-{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(image.file, f)
    attachment_path = f"/uploads/support-chats/{filename}"

    result = await db.execute(text("""
        INSERT INTO support_chat_messages (chat_id, sender_type, sender_id, message, attachments_path)
        VALUES (:chat_id, 'OPERATOR', :sender_id, '[Изображение]', :att)
    """), {"chat_id": chat_id, "sender_id": current_user.id, "att": attachment_path})

    msg_id = result.lastrowid
    await db.execute(text("UPDATE support_chats SET last_message_at = NOW() WHERE id = :id"), {"id": chat_id})

    row = await db.execute(text(f"{MSG_SELECT} WHERE scm.id = :id"), {"id": msg_id})
    new_msg = dict(row.mappings().one())

    await sio.emit_support_chat_message(chat_id, new_msg)
    return new_msg


# ---------------------------------------------------------------------------
# POST /{chatId}/read
# ---------------------------------------------------------------------------

@router.post("/{chat_id}/read")
async def mark_as_read(
    chat_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    chat_row = await db.execute(text("SELECT id FROM support_chats WHERE id = :id"), {"id": chat_id})
    if not chat_row.one_or_none():
        raise HTTPException(404, "Чат не найден")

    await db.execute(text("""
        UPDATE support_chat_messages
        SET is_read = 1
        WHERE chat_id = :id AND sender_type = 'USER' AND is_read = 0
    """), {"id": chat_id})
    await db.execute(text("UPDATE support_chats SET unread_count = 0 WHERE id = :id"), {"id": chat_id})

    await sio.emit_support_chat_read(chat_id)
    return {"success": True}


# ---------------------------------------------------------------------------
# POST /{chatId}/typing
# ---------------------------------------------------------------------------

@router.post("/{chat_id}/typing")
async def send_typing(
    chat_id: int,
    body: dict,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    chat_row = await db.execute(text("SELECT id FROM support_chats WHERE id = :id"), {"id": chat_id})
    if not chat_row.one_or_none():
        raise HTTPException(404, "Чат не найден")

    await sio.emit_support_chat_typing(
        chat_id, current_user.id, current_user.login, bool(body.get("isTyping"))
    )
    return {"success": True}


# ---------------------------------------------------------------------------
# DELETE /{chatId}  — только SUPERADMIN
# ---------------------------------------------------------------------------

@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: int,
    current_user: Support = Depends(require_roles("SUPERADMIN")),
    db: AsyncSession = Depends(get_db),
):
    chat_row = await db.execute(text("SELECT id FROM support_chats WHERE id = :id"), {"id": chat_id})
    if not chat_row.one_or_none():
        raise HTTPException(404, "Чат не найден")

    await db.execute(text("DELETE FROM support_chats WHERE id = :id"), {"id": chat_id})
    await sio.emit_support_chat_deleted(chat_id)
    return {"success": True}
