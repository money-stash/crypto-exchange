import json
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/settings", tags=["settings"])

OPERATOR_TAKE_KEY_1 = "operator_take_start_message_1"
OPERATOR_TAKE_KEY_2 = "operator_take_start_message_2"
CHAT_QUICK_REPLIES_KEY = "operator_chat_quick_replies"


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = await db.execute(text("SELECT value FROM system_settings WHERE `key` = :key"), {"key": key})
    r = row.fetchone()
    return r[0] if r else default


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    await db.execute(text("""
        INSERT INTO system_settings (`key`, value) VALUES (:key, :val)
        ON DUPLICATE KEY UPDATE value = :val
    """), {"key": key, "val": value})


def _normalize_quick_replies(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(r) for r in raw if r]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(r) for r in parsed if r]
    except Exception:
        pass
    return []


# ── GET /finance ──────────────────────────────────────────────────────────────
@router.get("/finance")
async def get_finance_settings(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    wallet = await _get_setting(db, "company_usdt_wallet_trc20", "")
    msg1 = await _get_setting(db, OPERATOR_TAKE_KEY_1, "")
    msg2 = await _get_setting(db, OPERATOR_TAKE_KEY_2, "")
    return {
        "company_usdt_wallet_trc20": wallet,
        "operator_take_start_message_1": msg1,
        "operator_take_start_message_2": msg2,
    }


# ── PUT /finance ──────────────────────────────────────────────────────────────
@router.put("/finance")
async def update_finance_settings(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    wallet = str(body.get("company_usdt_wallet_trc20") or "").strip()
    msg1 = str(body.get("operator_take_start_message_1") or "")
    msg2 = str(body.get("operator_take_start_message_2") or "")

    await _set_setting(db, "company_usdt_wallet_trc20", wallet)
    await _set_setting(db, OPERATOR_TAKE_KEY_1, msg1)
    await _set_setting(db, OPERATOR_TAKE_KEY_2, msg2)
    await db.commit()

    return {
        "message": "Finance settings updated",
        "company_usdt_wallet_trc20": wallet,
        "operator_take_start_message_1": msg1,
        "operator_take_start_message_2": msg2,
    }


# ── GET /chat-quick-replies ───────────────────────────────────────────────────
@router.get("/chat-quick-replies")
async def get_chat_quick_replies(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("OPERATOR", "MANAGER", "SUPERADMIN")),
):
    raw = await _get_setting(db, CHAT_QUICK_REPLIES_KEY, "")
    return {"operator_chat_quick_replies": _normalize_quick_replies(raw)}


# ── PUT /chat-quick-replies ───────────────────────────────────────────────────
@router.put("/chat-quick-replies")
async def update_chat_quick_replies(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("MANAGER", "SUPERADMIN")),
):
    normalized = _normalize_quick_replies(body.get("operator_chat_quick_replies", []))
    await _set_setting(db, CHAT_QUICK_REPLIES_KEY, json.dumps(normalized, ensure_ascii=False))
    await db.commit()
    return {"message": "Chat quick replies updated", "operator_chat_quick_replies": normalized}
