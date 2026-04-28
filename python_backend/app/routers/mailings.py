import asyncio
import json
import os
import uuid
import base64
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/mailings", tags=["mailings"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads" / "mailings"


def _uploads_dir() -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR


def _get_file_info(filename: str, mime_type: str) -> tuple[str, str]:
    ext = Path(filename).suffix.lower()
    file_type = "document"
    if ext in (".mp4", ".avi", ".mov", ".mkv", ".webm") or (mime_type or "").startswith("video/"):
        file_type = "video"
        ext = ext or ".mp4"
    elif ext == ".gif" or mime_type == "image/gif":
        file_type = "animation"
        ext = ".gif"
    elif ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp") or (mime_type or "").startswith("image/"):
        file_type = "image"
        ext = ext or ".jpg"
    elif ext in (".mp3", ".wav", ".ogg", ".m4a") or (mime_type or "").startswith("audio/"):
        file_type = "audio"
        ext = ext or ".mp3"
    if not ext:
        mime_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "video/mp4": ".mp4"}
        ext = mime_map.get(mime_type or "", ".bin")
    return file_type, ext


def _process_attachments(attachments: list) -> list:
    processed = []
    upload_dir = _uploads_dir()
    for att in attachments:
        if not att.get("data") or not att.get("name"):
            continue
        b64 = att["data"]
        if "," in b64:
            parts = b64.split(",", 1)
            if "base64" in parts[0]:
                b64 = parts[1]
        try:
            buf = base64.b64decode(b64)
        except Exception:
            continue
        file_type, ext = _get_file_info(att["name"], att.get("type", ""))
        filename = f"{uuid.uuid4().hex}{ext}"
        (upload_dir / filename).write_bytes(buf)
        processed.append({
            "name": att["name"],
            "type": file_type,
            "mimeType": att.get("type", ""),
            "path": f"mailings/{filename}",
            "size": len(buf),
        })
    return processed


async def _get_bot_ids_for_user(db: AsyncSession, role: str, user_id: int) -> list[int] | None:
    """Returns list of accessible bot IDs. None means all (SUPERADMIN)."""
    if role == "SUPERADMIN":
        return None
    rows = await db.execute(text("SELECT id FROM bots WHERE owner_id = :uid"), {"uid": user_id})
    return [r[0] for r in rows.fetchall()]


# ── GET /stats ────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_statistics(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN status='active' THEN 1 END) AS active,
            COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
            COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
            COALESCE(SUM(send_count),0) AS total_sent
        FROM mailings
    """))
    s = row.fetchone()
    return {"total": int(s.total), "active": int(s.active), "completed": int(s.completed),
            "cancelled": int(s.cancelled), "total_sent": int(s.total_sent)}


# ── GET /active ───────────────────────────────────────────────────────────────
@router.get("/active")
async def get_active_mailings(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    rows = await db.execute(text("SELECT * FROM mailings WHERE status='active' ORDER BY created_at"))
    return [dict(r._mapping) for r in rows.fetchall()]


# ── GET / ─────────────────────────────────────────────────────────────────────
@router.get("/")
async def get_mailings(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    bot_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    accessible_bot_ids = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
    if accessible_bot_ids is not None and len(accessible_bot_ids) == 0:
        return {"data": {"mailings": [], "total": 0, "pages": 0, "page": 1, "limit": limit}}

    where_parts = ["1=1"]
    params: dict = {}

    if accessible_bot_ids is not None:
        # EX_ADMIN — only their bots
        if bot_id and bot_id not in accessible_bot_ids:
            raise HTTPException(403, "Access denied for selected bot")
        if bot_id:
            where_parts.append("bot_id = :bot_id")
            params["bot_id"] = bot_id
        else:
            where_parts.append(f"bot_id IN ({','.join(str(b) for b in accessible_bot_ids)})")
    else:
        if bot_id:
            where_parts.append("bot_id = :bot_id")
            params["bot_id"] = bot_id

    where_sql = " AND ".join(where_parts)
    offset = (page - 1) * limit

    rows = await db.execute(text(f"""
        SELECT m.*, b.name AS bot_name FROM mailings m
        LEFT JOIN bots b ON m.bot_id = b.id
        WHERE {where_sql} ORDER BY m.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": limit, "offset": offset})

    count_row = await db.execute(text(f"SELECT COUNT(*) FROM mailings m WHERE {where_sql}"), params)
    total = count_row.scalar() or 0

    mailings = []
    for r in rows.fetchall():
        m = dict(r._mapping)
        if m.get("attachments") and isinstance(m["attachments"], str):
            try:
                m["attachments"] = json.loads(m["attachments"])
            except Exception:
                m["attachments"] = []
        mailings.append(m)

    return {"data": {"mailings": mailings, "total": total, "pages": -(-total // limit), "page": page, "limit": limit}}


# ── GET /{id} ─────────────────────────────────────────────────────────────────
@router.get("/{mailing_id}")
async def get_mailing(
    mailing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
    m = row.fetchone()
    if not m:
        raise HTTPException(404, "Mailing not found")

    m_dict = dict(m._mapping)
    if current_user.role == "EX_ADMIN":
        accessible = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
        if m_dict.get("bot_id") not in (accessible or []):
            raise HTTPException(403, "Access denied")

    if m_dict.get("attachments") and isinstance(m_dict["attachments"], str):
        try:
            m_dict["attachments"] = json.loads(m_dict["attachments"])
        except Exception:
            m_dict["attachments"] = []
    return m_dict


# ── POST /raffle ──────────────────────────────────────────────────────────────
@router.post("/raffle")
async def create_raffle_mailing(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    from app.services.mailing_service import (
        parse_raffle_recipients, resolve_raffle_recipient, send_message_to_user
    )

    raffle_name = str(body.get("raffle_name") or "Розыгрыш").strip() or "Розыгрыш"
    recipients_text = str(body.get("recipients_text") or "")

    accessible = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
    req_bot_id = body.get("bot_id")

    if current_user.role == "EX_ADMIN":
        if not accessible:
            raise HTTPException(400, "No bot found for this user")
        if req_bot_id and int(req_bot_id) not in accessible:
            raise HTTPException(403, "Access denied for selected bot")
        bot_id = int(req_bot_id) if req_bot_id else accessible[0]
    else:
        bot_id = int(req_bot_id) if req_bot_id else 0

    parsed = parse_raffle_recipients(recipients_text)
    if not parsed["recipients"]:
        raise HTTPException(400, "Recipients list is empty or invalid")

    results = []
    sent_count = 0
    failed_count = 0

    for skipped in parsed["skipped"]:
        results.append({"line": skipped["line"], "input": skipped["raw"],
                        "status": "failed", "reason": skipped["reason"]})
        failed_count += 1

    for recipient in parsed["recipients"]:
        try:
            resolved = await resolve_raffle_recipient(recipient, bot_id)
            if not resolved:
                results.append({"line": recipient["line"], "input": recipient["raw"],
                                "status": "failed", "reason": "User not found"})
                failed_count += 1
                continue

            target_bot_id = resolved["bot_id"] or bot_id or 0
            message = f"Ваш номер в розыгрыше {raffle_name}: {recipient['raffle_number']}"
            sent = await send_message_to_user(target_bot_id, int(resolved["tg_id"]), message, None)

            if sent:
                results.append({
                    "line": recipient["line"], "input": recipient["raw"], "status": "sent",
                    "raffle_number": recipient["raffle_number"], "tg_id": resolved["tg_id"],
                    "username": f"@{resolved['username']}" if resolved.get("username") else None,
                })
                sent_count += 1
            else:
                results.append({"line": recipient["line"], "input": recipient["raw"],
                                "status": "failed", "reason": "Telegram rejected the message"})
                failed_count += 1
        except Exception as e:
            results.append({"line": recipient["line"], "input": recipient["raw"],
                            "status": "failed", "reason": "Send error"})
            failed_count += 1

    return {
        "message": "Raffle mailing processed",
        "data": {
            "raffle_name": raffle_name,
            "bot_id": bot_id,
            "total_lines": parsed["total_lines"],
            "valid_targets": len(parsed["recipients"]),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "results": results,
        }
    }


# ── POST / ────────────────────────────────────────────────────────────────────
@router.post("/")
async def create_mailing(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    text_content = str(body.get("text") or "").strip()
    if not text_content:
        raise HTTPException(400, "Text is required")

    # Resolve bot_id
    accessible = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
    req_bot_id = body.get("bot_id")

    if current_user.role == "EX_ADMIN":
        if not accessible:
            raise HTTPException(400, "No bot found for this user")
        if req_bot_id and int(req_bot_id) not in accessible:
            raise HTTPException(403, "Access denied for selected bot")
        bot_id = int(req_bot_id) if req_bot_id else accessible[0]
    else:
        bot_id = int(req_bot_id) if req_bot_id else 0

    # Count target users
    if bot_id == 0:
        count_row = await db.execute(text("""
            SELECT COUNT(*) FROM user_bots ub JOIN users u ON ub.user_id = u.id
            WHERE u.is_blocked = 0 AND u.tg_id IS NOT NULL
        """))
    else:
        count_row = await db.execute(text("""
            SELECT COUNT(*) FROM user_bots ub JOIN users u ON ub.user_id = u.id
            WHERE ub.bot_id = :bot_id AND u.is_blocked = 0
        """), {"bot_id": bot_id})
    total_count = count_row.scalar() or 0

    # Process attachments
    attachments_raw = body.get("attachments")
    attachments = None
    if attachments_raw and isinstance(attachments_raw, list):
        processed = _process_attachments(attachments_raw)
        if processed:
            attachments = json.dumps(processed, ensure_ascii=False)

    result = await db.execute(text("""
        INSERT INTO mailings (bot_id, text, status, total_count, send_count, attachments, created_at)
        VALUES (:bot_id, :text, 'active', :total_count, 0, :attachments, NOW())
    """), {"bot_id": bot_id, "text": text_content, "total_count": total_count, "attachments": attachments})
    await db.commit()
    mailing_id = result.lastrowid

    row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
    m = dict(row.fetchone()._mapping)
    if m.get("attachments") and isinstance(m["attachments"], str):
        try:
            m["attachments"] = json.loads(m["attachments"])
        except Exception:
            m["attachments"] = []

    from app.services.mailing_service import mailing_service
    asyncio.create_task(mailing_service.start_mailing(mailing_id))

    return m


# ── PATCH /{id}/cancel ────────────────────────────────────────────────────────
@router.patch("/{mailing_id}/cancel")
async def cancel_mailing(
    mailing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
    m = row.fetchone()
    if not m:
        raise HTTPException(404, "Mailing not found")
    if m.status != "active":
        raise HTTPException(400, "Only active mailings can be cancelled")

    if current_user.role == "EX_ADMIN":
        accessible = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
        if m.bot_id not in (accessible or []):
            raise HTTPException(403, "Access denied")

    await db.execute(text("UPDATE mailings SET status='cancelled' WHERE id=:id"), {"id": mailing_id})
    await db.commit()
    return {"message": "Mailing cancelled", "id": mailing_id}


# ── PATCH /{id}/send-count ────────────────────────────────────────────────────
@router.patch("/{mailing_id}/send-count")
async def update_send_count(
    mailing_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    increment = int(body.get("increment", 1))
    result = await db.execute(
        text("UPDATE mailings SET send_count = send_count + :inc WHERE id = :id"),
        {"inc": increment, "id": mailing_id}
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Mailing not found")
    row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
    return dict(row.fetchone()._mapping)


# ── DELETE /{id} ──────────────────────────────────────────────────────────────
@router.delete("/{mailing_id}")
async def delete_mailing(
    mailing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("SELECT * FROM mailings WHERE id = :id"), {"id": mailing_id})
    m = row.fetchone()
    if not m:
        raise HTTPException(404, "Mailing not found")
    if m.status == "active":
        raise HTTPException(400, "Cannot delete active mailing. Cancel it first.")

    if current_user.role == "EX_ADMIN":
        accessible = await _get_bot_ids_for_user(db, current_user.role, current_user.id)
        if m.bot_id not in (accessible or []):
            raise HTTPException(403, "Access denied")

    await db.execute(text("DELETE FROM mailings WHERE id = :id"), {"id": mailing_id})
    await db.commit()
    return {"message": "Mailing deleted successfully"}
