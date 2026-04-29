from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/referral-withdrawals", tags=["referral-withdrawals"])


async def _get_bot_id_for_ex_admin(db: AsyncSession, owner_id: int) -> int | None:
    row = await db.execute(text("SELECT id FROM bots WHERE owner_id = :uid"), {"uid": owner_id})
    r = row.fetchone()
    return r[0] if r else None


@router.get("/")
async def get_withdrawals(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    status: str = Query(None),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    bot_id = None
    if current_user.role == "EX_ADMIN":
        bot_id = await _get_bot_id_for_ex_admin(db, current_user.id)
        if bot_id is None:
            empty_stats = {"total_requests": 0, "pending_requests": 0, "completed_requests": 0,
                           "cancelled_requests": 0, "total_paid_amount": 0.0, "pending_amount": 0.0}
            return {"success": True, "data": {"withdrawals": [], "pagination": {"page": 1, "limit": limit, "total": 0, "pages": 0}, "stats": empty_stats}}

    filtered_status = None if status in (None, "all") else status
    where_parts = ["1=1"]
    params: dict = {}

    if filtered_status:
        where_parts.append("rw.status = :status")
        params["status"] = filtered_status
    if bot_id:
        where_parts.append("ub.bot_id = :bot_id")
        params["bot_id"] = bot_id
    if search:
        where_parts.append("(u.username LIKE :search OR u.tg_id LIKE :search)")
        params["search"] = f"%{search}%"

    where_sql = " AND ".join(where_parts)
    offset = (page - 1) * limit

    rows = await db.execute(text(f"""
        SELECT rw.id, rw.userbot_id, rw.amount_rub, rw.amount_crypto, rw.currency,
               rw.wallet_address, rw.status, rw.created_at, rw.completed_at,
               u.tg_id, u.username, b.name AS bot_name
        FROM referrals_withdraw rw
        JOIN user_bots ub ON rw.userbot_id = ub.id
        JOIN users u ON ub.user_id = u.id
        JOIN bots b ON ub.bot_id = b.id
        WHERE {where_sql}
        ORDER BY rw.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": limit, "offset": offset})

    count_row = await db.execute(text(f"""
        SELECT COUNT(*) FROM referrals_withdraw rw
        JOIN user_bots ub ON rw.userbot_id = ub.id
        JOIN users u ON ub.user_id = u.id
        WHERE {where_sql}
    """), params)
    total = count_row.scalar() or 0

    stats_where = "1=1"
    stats_params: dict = {}
    if bot_id:
        stats_where += " AND ub.bot_id = :bot_id"
        stats_params["bot_id"] = bot_id

    stats_row = await db.execute(text(f"""
        SELECT
            COUNT(*) AS total_requests,
            COUNT(CASE WHEN rw.status='CREATED' THEN 1 END) AS pending_requests,
            COUNT(CASE WHEN rw.status='COMPLETED' THEN 1 END) AS completed_requests,
            COUNT(CASE WHEN rw.status='CANCELLED' THEN 1 END) AS cancelled_requests,
            COALESCE(SUM(CASE WHEN rw.status='COMPLETED' THEN rw.amount_rub ELSE 0 END),0) AS total_paid_amount,
            COALESCE(SUM(CASE WHEN rw.status='CREATED' THEN rw.amount_rub ELSE 0 END),0) AS pending_amount
        FROM referrals_withdraw rw
        JOIN user_bots ub ON rw.userbot_id = ub.id
        WHERE {stats_where}
    """), stats_params)
    s = stats_row.fetchone()

    return {
        "success": True,
        "data": {
            "withdrawals": [dict(r._mapping) for r in rows.fetchall()],
            "pagination": {"page": page, "limit": limit, "total": total, "pages": -(-total // limit)},
            "stats": {
                "total_requests": int(s.total_requests or 0),
                "pending_requests": int(s.pending_requests or 0),
                "completed_requests": int(s.completed_requests or 0),
                "cancelled_requests": int(s.cancelled_requests or 0),
                "total_paid_amount": float(s.total_paid_amount or 0),
                "pending_amount": float(s.pending_amount or 0),
            },
        },
    }


@router.get("/{withdrawal_id}")
async def get_withdrawal_by_id(
    withdrawal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("""
        SELECT rw.*, u.tg_id, u.username, b.name AS bot_name
        FROM referrals_withdraw rw
        JOIN user_bots ub ON rw.userbot_id = ub.id
        JOIN users u ON ub.user_id = u.id
        JOIN bots b ON ub.bot_id = b.id
        WHERE rw.id = :id
    """), {"id": withdrawal_id})
    w = row.fetchone()
    if not w:
        raise HTTPException(404, "Withdrawal not found")

    if current_user.role == "EX_ADMIN":
        bot_id = await _get_bot_id_for_ex_admin(db, current_user.id)
        check = await db.execute(text("""
            SELECT 1 FROM referrals_withdraw rw JOIN user_bots ub ON rw.userbot_id = ub.id
            WHERE rw.id = :id AND ub.bot_id = :bot_id
        """), {"id": withdrawal_id, "bot_id": bot_id})
        if not check.fetchone():
            raise HTTPException(403, "Access denied")

    return {"success": True, "data": dict(w._mapping)}


@router.post("/{withdrawal_id}/complete")
async def complete_withdrawal(
    withdrawal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("SELECT * FROM referrals_withdraw WHERE id = :id"), {"id": withdrawal_id})
    w = row.fetchone()
    if not w:
        raise HTTPException(404, "Withdrawal not found")
    if w.status != "CREATED":
        raise HTTPException(400, "Withdrawal already processed")

    if current_user.role == "EX_ADMIN":
        bot_id = await _get_bot_id_for_ex_admin(db, current_user.id)
        check = await db.execute(text("""
            SELECT 1 FROM referrals_withdraw rw JOIN user_bots ub ON rw.userbot_id = ub.id
            WHERE rw.id = :id AND ub.bot_id = :bot_id
        """), {"id": withdrawal_id, "bot_id": bot_id})
        if not check.fetchone():
            raise HTTPException(403, "Access denied")

    await db.execute(text("UPDATE referrals_withdraw SET status='COMPLETED', completed_at=NOW() WHERE id=:id"), {"id": withdrawal_id})
    await db.commit()
    # TODO: send Telegram notification via BotManager when available
    return {"success": True, "message": "Withdrawal completed"}


@router.post("/{withdrawal_id}/cancel")
async def cancel_withdrawal(
    withdrawal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    row = await db.execute(text("SELECT * FROM referrals_withdraw WHERE id = :id"), {"id": withdrawal_id})
    w = row.fetchone()
    if not w:
        raise HTTPException(404, "Withdrawal not found")
    if w.status != "CREATED":
        raise HTTPException(400, "Withdrawal already processed")

    if current_user.role == "EX_ADMIN":
        bot_id = await _get_bot_id_for_ex_admin(db, current_user.id)
        check = await db.execute(text("""
            SELECT 1 FROM referrals_withdraw rw JOIN user_bots ub ON rw.userbot_id = ub.id
            WHERE rw.id = :id AND ub.bot_id = :bot_id
        """), {"id": withdrawal_id, "bot_id": bot_id})
        if not check.fetchone():
            raise HTTPException(403, "Access denied")

    await db.execute(text("UPDATE referrals_withdraw SET status='CANCELLED' WHERE id=:id"), {"id": withdrawal_id})
    await db.commit()
    # TODO: send Telegram notification via BotManager when available
    return {"success": True, "message": "Withdrawal cancelled"}
