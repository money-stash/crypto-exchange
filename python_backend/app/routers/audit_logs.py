import json
import io
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


def _parse_meta(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _build_filters(
    actor: str, action: str, search: str, source: str, from_: str, to_: str
) -> tuple[str, dict]:
    where = ["1=1"]
    params: dict = {}

    if actor:
        where.append("actor LIKE :actor")
        params["actor"] = f"%{actor}%"
    if action:
        where.append("action LIKE :action")
        params["action"] = f"%{action}%"
    if search:
        where.append("(actor LIKE :search OR action LIKE :search OR CAST(meta AS CHAR) LIKE :search)")
        params["search"] = f"%{search}%"
    if source:
        where.append("JSON_UNQUOTE(JSON_EXTRACT(meta, '$.source')) = :source")
        params["source"] = source
    if from_:
        date_from = f"{from_} 00:00:00" if len(from_) == 10 else from_
        where.append("created_at >= :date_from")
        params["date_from"] = date_from
    if to_:
        date_to = f"{to_} 23:59:59" if len(to_) == 10 else to_
        where.append("created_at <= :date_to")
        params["date_to"] = date_to

    return " AND ".join(where), params


def _escape_csv(value) -> str:
    if value is None:
        return ""
    text_val = str(value)
    if any(c in text_val for c in '",\n\r'):
        return f'"{text_val.replace(chr(34), chr(34)*2)}"'
    return text_val


def _build_csv(logs: list) -> str:
    headers = [
        "created_at", "actor", "action", "source", "bot_id", "bot_identifier",
        "tg_id", "username", "chat_id", "update_type", "message_type",
        "command", "callback_data", "text", "caption", "meta_json"
    ]
    rows = [",".join(headers)]
    for log in logs:
        meta = log.get("meta") or {}
        row = [
            log.get("created_at", ""),
            log.get("actor", ""),
            log.get("action", ""),
            meta.get("source", ""),
            meta.get("bot_id", ""),
            meta.get("bot_identifier", ""),
            meta.get("tg_id", ""),
            meta.get("username", ""),
            meta.get("chat_id", ""),
            meta.get("update_type", ""),
            meta.get("message_type", ""),
            meta.get("command", ""),
            meta.get("callback_data", ""),
            meta.get("text", ""),
            meta.get("caption", ""),
            json.dumps(meta),
        ]
        rows.append(",".join(_escape_csv(v) for v in row))
    return "\n".join(rows)


@router.get("/download")
async def download_logs(
    actor: str = Query(""),
    action: str = Query(""),
    search: str = Query(""),
    source: str = Query(""),
    from_: str = Query("", alias="from"),
    to_: str = Query("", alias="to"),
    limit: int = Query(5000, ge=1, le=50000),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    where_sql, params = _build_filters(actor, action, search, source, from_, to_)
    params["limit"] = limit

    rows = await db.execute(text(f"""
        SELECT id, actor, action, meta, created_at
        FROM audit_logs WHERE {where_sql}
        ORDER BY created_at DESC, id DESC
        LIMIT :limit
    """), params)

    logs = [{"id": r.id, "actor": r.actor, "action": r.action, "meta": _parse_meta(r.meta), "created_at": str(r.created_at)} for r in rows.fetchall()]
    csv_data = "\ufeff" + _build_csv(logs)  # BOM for Excel

    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="audit_logs_{timestamp}.csv"'}
    )


@router.get("/")
async def list_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    actor: str = Query(""),
    action: str = Query(""),
    search: str = Query(""),
    source: str = Query(""),
    from_: str = Query("", alias="from"),
    to_: str = Query("", alias="to"),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    where_sql, params = _build_filters(actor, action, search, source, from_, to_)
    offset = (page - 1) * limit

    count_row = await db.execute(text(f"SELECT COUNT(*) FROM audit_logs WHERE {where_sql}"), params)
    total = count_row.scalar() or 0

    rows = await db.execute(text(f"""
        SELECT id, actor, action, meta, created_at
        FROM audit_logs WHERE {where_sql}
        ORDER BY created_at DESC, id DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": limit, "offset": offset})

    logs = [
        {"id": r.id, "actor": r.actor, "action": r.action, "meta": _parse_meta(r.meta), "created_at": str(r.created_at)}
        for r in rows.fetchall()
    ]

    return {"logs": logs, "total": total, "page": page, "limit": limit, "pages": -(-total // limit)}
