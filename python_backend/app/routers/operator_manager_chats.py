from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
import os, shutil, uuid

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support
import app.socket.socket_service as sio

router = APIRouter(prefix="/api/operator-manager-chats", tags=["operator-manager-chats"])

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "../../../uploads/chats")


def _uploads_dir() -> str:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    return UPLOAD_DIR


def _sender_type(role: str) -> str:
    r = role.upper()
    if r == "OPERATOR":
        return "OPERATOR"
    if r == "SUPERADMIN":
        return "SUPERADMIN"
    return "MANAGER"


async def _find_default_manager(db: AsyncSession) -> dict | None:
    row = await db.execute(text("""
        SELECT id, login, role FROM supports
        WHERE role IN ('MANAGER','SUPERADMIN') AND is_active = 1
        ORDER BY CASE WHEN role='SUPERADMIN' THEN 0 ELSE 1 END, is_active DESC, id ASC
        LIMIT 1
    """))
    r = row.fetchone()
    return dict(r._mapping) if r else None


async def _resolve_thread_manager_id(
    db: AsyncSession, operator: dict, viewer_role: str, viewer_id: int
) -> int:
    """Always returns a valid manager ID (raises 409 if none found)."""
    r = viewer_role.upper()
    if r in ("MANAGER", "SUPERADMIN"):
        # viewer IS the manager for this thread
        return viewer_id

    # For OPERATOR: use their assigned manager
    if operator.get("manager_id"):
        mgr = await db.execute(
            text("SELECT id FROM supports WHERE id = :id AND role IN ('MANAGER','SUPERADMIN') AND is_active = 1"),
            {"id": operator["manager_id"]}
        )
        if mgr.fetchone():
            return int(operator["manager_id"])

    # Fallback to default manager
    default = await _find_default_manager(db)
    if default:
        return int(default["id"])

    raise HTTPException(409, "No manager accounts available")


async def _resolve_conversation(
    db: AsyncSession, viewer_role: str, viewer_id: int, operator_id: int
) -> dict:
    """Returns {"operator": {...}, "thread_manager_id": int, "manager": {...}|None}"""
    op_row = await db.execute(
        text("SELECT id, login, role, manager_id FROM supports WHERE id = :oid AND role = 'OPERATOR'"),
        {"oid": operator_id}
    )
    op = op_row.fetchone()
    if not op:
        raise HTTPException(404, "Operator not found")

    if viewer_role.upper() == "OPERATOR" and viewer_id != operator_id:
        raise HTTPException(403, "Access denied")

    operator = dict(op._mapping)
    thread_manager_id = await _resolve_thread_manager_id(db, operator, viewer_role, viewer_id)

    mgr_row = await db.execute(
        text("SELECT id, login FROM supports WHERE id = :mid"),
        {"mid": thread_manager_id}
    )
    mgr = mgr_row.fetchone()

    return {
        "operator": operator,
        "thread_manager_id": thread_manager_id,
        "manager": dict(mgr._mapping) if mgr else None,
    }


async def _has_column(db: AsyncSession, table: str, column: str) -> bool:
    row = await db.execute(text("""
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = :tbl AND column_name = :col
    """), {"tbl": table, "col": column})
    return (row.scalar() or 0) > 0


# ── GET /unread-count  (MUST be before /{operator_id}) ──────────────────────
@router.get("/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    if current_user.role == "OPERATOR":
        row = await db.execute(text("""
            SELECT COUNT(*) FROM operator_manager_messages
            WHERE operator_id = :uid
              AND is_read_by_operator = 0
              AND sender_type IN ('MANAGER','SUPERADMIN')
        """), {"uid": current_user.id})
    else:
        # MANAGER / SUPERADMIN — all unread from operators
        row = await db.execute(text("""
            SELECT COUNT(*) FROM operator_manager_messages
            WHERE is_read_by_manager = 0
              AND sender_type = 'OPERATOR'
        """))
    return {"count": row.scalar() or 0}


# ── GET /assignment-options ───────────────────────────────────────────────────
@router.get("/assignment-options")
async def get_assignment_options(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("MANAGER", "SUPERADMIN")),
):
    if current_user.role == "SUPERADMIN":
        mgrs = await db.execute(text("""
            SELECT id, login, role, is_active FROM supports
            WHERE role IN ('MANAGER','SUPERADMIN')
            ORDER BY CASE WHEN role='SUPERADMIN' THEN 0 ELSE 1 END, login
        """))
        managers = [dict(r._mapping) for r in mgrs.fetchall()]
    else:
        mgr = await db.execute(
            text("SELECT id, login, role, is_active FROM supports WHERE id = :id"), {"id": current_user.id}
        )
        managers = [dict(r._mapping) for r in mgr.fetchall()]

    ops = await db.execute(text("""
        SELECT id, login, is_active, manager_id FROM supports
        WHERE role = 'OPERATOR' ORDER BY login
    """))
    return {
        "managers": managers,
        "operators": [dict(r._mapping) for r in ops.fetchall()],
    }


# ── GET /  (list of chats for managers) ──────────────────────────────────────
@router.get("/")
async def get_chats(
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("MANAGER", "SUPERADMIN")),
):
    where = "o.role = 'OPERATOR'"
    params: dict = {}
    if search:
        where += " AND (o.login LIKE :search OR COALESCE(m.login,'') LIKE :search)"
        params["search"] = f"%{search}%"

    rows = await db.execute(text(f"""
        SELECT
            o.id AS operator_id,
            o.login AS operator_login,
            o.is_active AS operator_is_active,
            o.manager_id,
            m.login AS manager_login,
            lm.id AS last_message_id,
            lm.message AS last_message,
            lm.sender_type AS last_sender_type,
            lm.created_at AS last_message_at,
            COALESCE(agg.unread_for_manager, 0) AS unread_for_manager,
            COALESCE(agg.unread_for_operator, 0) AS unread_for_operator
        FROM supports o
        LEFT JOIN supports m ON m.id = o.manager_id
        LEFT JOIN (
            SELECT
                mm.operator_id,
                MAX(mm.id) AS last_message_id,
                SUM(CASE WHEN mm.is_read_by_manager = 0 AND mm.sender_type = 'OPERATOR' THEN 1 ELSE 0 END) AS unread_for_manager,
                SUM(CASE WHEN mm.is_read_by_operator = 0 AND mm.sender_type IN ('MANAGER','SUPERADMIN') THEN 1 ELSE 0 END) AS unread_for_operator
            FROM operator_manager_messages mm
            GROUP BY mm.operator_id
        ) agg ON agg.operator_id = o.id
        LEFT JOIN operator_manager_messages lm ON lm.id = agg.last_message_id
        WHERE {where}
        ORDER BY unread_for_manager DESC, lm.created_at DESC, o.login ASC
    """), params)

    return {"chats": [dict(r._mapping) for r in rows.fetchall()]}


# ── PATCH /operators/{operatorId}/manager ────────────────────────────────────
@router.patch("/operators/{operator_id}/manager")
async def assign_manager(
    operator_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("MANAGER", "SUPERADMIN")),
):
    raw = body.get("manager_id")
    manager_id = None if raw in (None, "", 0) else int(raw)

    # MANAGER can only assign to themselves
    if current_user.role == "MANAGER" and manager_id != current_user.id:
        raise HTTPException(403, "Manager can only assign operators to themselves")

    if manager_id is not None:
        mgr_check = await db.execute(
            text("SELECT id FROM supports WHERE id = :id AND role IN ('MANAGER','SUPERADMIN')"),
            {"id": manager_id}
        )
        if not mgr_check.fetchone():
            raise HTTPException(404, "Manager not found")

    result = await db.execute(
        text("UPDATE supports SET manager_id = :mid WHERE id = :oid AND role = 'OPERATOR'"),
        {"mid": manager_id, "oid": operator_id}
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Operator not found")

    await sio.emit_operator_manager_assignment_updated(operator_id, manager_id)
    return {"message": "Operator manager updated", "assignment": {"operator_id": operator_id, "manager_id": manager_id}}


# ── GET /operators/{operatorId}/messages ─────────────────────────────────────
@router.get("/operators/{operator_id}/messages")
async def get_messages(
    operator_id: int,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    conv = await _resolve_conversation(db, current_user.role, current_user.id, operator_id)
    has_att = await _has_column(db, "operator_manager_messages", "attachments_path")
    has_order = await _has_column(db, "operator_manager_messages", "order_id")

    att_col = "omm.attachments_path," if has_att else "NULL AS attachments_path,"
    order_cols = "omm.order_id, omm.order_unique_id, omm.order_sum_rub," if has_order else \
                 "NULL AS order_id, NULL AS order_unique_id, NULL AS order_sum_rub,"

    msgs = await db.execute(text(f"""
        SELECT omm.id, omm.operator_id, omm.manager_id, omm.sender_type, omm.sender_id,
               omm.message, {att_col} {order_cols}
               omm.created_at, omm.is_read_by_operator, omm.is_read_by_manager,
               s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.operator_id = :oid
        ORDER BY omm.created_at ASC, omm.id ASC
        LIMIT :limit OFFSET :offset
    """), {"oid": conv["operator"]["id"], "limit": limit, "offset": offset})

    return {
        "conversation": {
            "operator_id": conv["operator"]["id"],
            "operator_login": conv["operator"]["login"],
            "manager_id": conv["thread_manager_id"],
            "manager_login": conv["manager"]["login"] if conv["manager"] else None,
        },
        "messages": [dict(r._mapping) for r in msgs.fetchall()],
    }


# ── POST /operators/{operatorId}/messages ────────────────────────────────────
@router.post("/operators/{operator_id}/messages")
async def send_message(
    operator_id: int,
    message: str = Form(""),
    order_id: Optional[int] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    text_msg = message.strip()
    attachment_path = None
    has_att = await _has_column(db, "operator_manager_messages", "attachments_path")

    if attachment and has_att:
        ext = os.path.splitext(attachment.filename or "")[1]
        filename = f"operator-manager-{uuid.uuid4().hex}{ext}"
        dest = os.path.join(_uploads_dir(), filename)
        with open(dest, "wb") as f:
            shutil.copyfileobj(attachment.file, f)
        attachment_path = f"/uploads/chats/{filename}"

    if not text_msg and not attachment_path:
        raise HTTPException(400, "Message cannot be empty")

    if not text_msg and attachment_path:
        mime = (attachment.content_type or "").lower() if attachment else ""
        text_msg = "Изображение" if mime.startswith("image/") else "Файл"

    conv = await _resolve_conversation(db, current_user.role, current_user.id, operator_id)
    sender_type = _sender_type(current_user.role)
    is_operator = sender_type == "OPERATOR"
    read_by_op = 1 if is_operator else 0
    read_by_mgr = 0 if is_operator else 1

    has_order = await _has_column(db, "operator_manager_messages", "order_id")

    cols = ["operator_id", "manager_id", "sender_type", "sender_id", "message",
            "is_read_by_operator", "is_read_by_manager"]
    vals: dict = {
        "oid": conv["operator"]["id"],
        "mid": conv["thread_manager_id"],
        "stype": sender_type,
        "sid": current_user.id,
        "msg": text_msg,
        "rop": read_by_op,
        "rmgr": read_by_mgr,
    }

    if has_att:
        cols.append("attachments_path")
        vals["att"] = attachment_path

    if has_order and order_id:
        cols += ["order_id"]
        vals["ord"] = order_id

    col_sql = ", ".join(cols)
    val_keys = list(vals.keys())
    val_sql = ", ".join(f":{k}" for k in val_keys)

    result = await db.execute(text(f"INSERT INTO operator_manager_messages ({col_sql}) VALUES ({val_sql})"), vals)
    await db.commit()
    msg_id = result.lastrowid

    has_att2 = await _has_column(db, "operator_manager_messages", "attachments_path")
    has_order2 = await _has_column(db, "operator_manager_messages", "order_id")
    att_col = "omm.attachments_path," if has_att2 else "NULL AS attachments_path,"
    order_cols = "omm.order_id, omm.order_unique_id, omm.order_sum_rub," if has_order2 else \
                 "NULL AS order_id, NULL AS order_unique_id, NULL AS order_sum_rub,"

    new_msg_row = await db.execute(text(f"""
        SELECT omm.id, omm.operator_id, omm.manager_id, omm.sender_type, omm.sender_id,
               omm.message, {att_col} {order_cols}
               omm.created_at, omm.is_read_by_operator, omm.is_read_by_manager,
               s.login AS sender_login
        FROM operator_manager_messages omm
        LEFT JOIN supports s ON s.id = omm.sender_id
        WHERE omm.id = :id
    """), {"id": msg_id})
    msg_dict = dict(new_msg_row.fetchone()._mapping)

    await sio.emit_operator_manager_message(
        conv["operator"]["id"], conv["thread_manager_id"], msg_dict
    )
    return msg_dict


# ── POST /operators/{operatorId}/read ────────────────────────────────────────
@router.post("/operators/{operator_id}/read")
async def mark_as_read(
    operator_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    conv = await _resolve_conversation(db, current_user.role, current_user.id, operator_id)

    if current_user.role == "OPERATOR":
        result = await db.execute(text("""
            UPDATE operator_manager_messages
            SET is_read_by_operator = 1
            WHERE operator_id = :oid
              AND is_read_by_operator = 0
              AND sender_type IN ('MANAGER','SUPERADMIN')
        """), {"oid": conv["operator"]["id"]})
    else:
        result = await db.execute(text("""
            UPDATE operator_manager_messages
            SET is_read_by_manager = 1
            WHERE operator_id = :oid
              AND is_read_by_manager = 0
              AND sender_type = 'OPERATOR'
        """), {"oid": conv["operator"]["id"]})
    await db.commit()
    marked = result.rowcount

    await sio.emit_operator_manager_read(
        conv["operator"]["id"],
        conv["thread_manager_id"],
        current_user.role,
        current_user.id,
        marked,
    )
    return {"success": True, "marked": marked}
