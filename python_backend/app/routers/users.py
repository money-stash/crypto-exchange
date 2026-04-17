from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support

router = APIRouter(prefix="/api/users", tags=["users"])

_ALLOWED_SORT = {
    "created_at": "u.created_at",
    "total_volume": "order_stats.total_volume",
    "orders_count": "order_stats.orders_count",
}


@router.get("/")
async def get_users(
    search: str = Query(""),
    status: str = Query("all"),
    sortBy: str = Query("created_at"),
    sortOrder: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN", "MANAGER", "OPERATOR")),
):
    offset = (page - 1) * limit
    sort_field = _ALLOWED_SORT.get(sortBy, "u.created_at")
    sort_dir = "DESC" if sortOrder.lower() != "asc" else "ASC"

    # For EX_ADMIN — scope to their bot
    bot_id = None
    if current_user.role == "EX_ADMIN":
        row = await db.execute(text("SELECT id FROM bots WHERE owner_id = :uid"), {"uid": current_user.id})
        bot_row = row.fetchone()
        if not bot_row:
            return {
                "users": [], "stats": {"total": 0, "active": 0, "premium": 0, "blocked": 0,
                                        "todayRegistrations": 0, "totalVolume": 0},
                "total": 0, "pages": 0, "currentPage": 1
            }
        bot_id = bot_row[0]

    where_parts = ["1=1"]
    params: dict = {}

    if search:
        where_parts.append("(u.tg_id LIKE :search OR u.username LIKE :search OR u.phone LIKE :search)")
        params["search"] = f"%{search}%"

    if status == "active":
        where_parts.append("u.is_blocked = 0")
    elif status == "blocked":
        where_parts.append("u.is_blocked = 1")

    if bot_id is not None:
        where_parts.append("ub.bot_id = :bot_id")
        params["bot_id"] = bot_id

    where_sql = " AND ".join(where_parts)

    join_clause = ""
    if bot_id is not None:
        join_clause = "INNER JOIN user_bots ub ON u.id = ub.user_id AND ub.bot_id = :bot_id"
    else:
        join_clause = "LEFT JOIN user_bots ub ON u.id = ub.user_id"

    query = text(f"""
        SELECT
            u.id, u.tg_id, u.username, u.phone, u.is_blocked, u.created_at,
            COALESCE(os.orders_count, 0) AS orders_count,
            COALESCE(os.total_volume, 0) AS total_volume
        FROM users u
        {join_clause}
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS orders_count, SUM(sum_rub) AS total_volume
            FROM orders GROUP BY user_id
        ) os ON u.id = os.user_id
        WHERE {where_sql}
        GROUP BY u.id
        ORDER BY {sort_field} {sort_dir}
        LIMIT :limit OFFSET :offset
    """)
    params["limit"] = limit
    params["offset"] = offset

    rows = await db.execute(query, params)
    users = [dict(r._mapping) for r in rows.fetchall()]

    count_query = text(f"""
        SELECT COUNT(DISTINCT u.id) AS total
        FROM users u
        {join_clause}
        WHERE {where_sql}
    """)
    count_row = await db.execute(count_query, params)
    total = count_row.scalar() or 0

    # Stats
    stats_params: dict = {}
    stats_where = "1=1"
    bot_exists = ""
    if search:
        stats_where += " AND (u.tg_id LIKE :sw_search OR u.username LIKE :sw_search)"
        stats_params["sw_search"] = f"%{search}%"
    if bot_id is not None:
        bot_exists = " AND EXISTS (SELECT 1 FROM user_bots ub WHERE ub.user_id = u.id AND ub.bot_id = :sw_bot_id)"
        stats_params["sw_bot_id"] = bot_id

    stats_row = await db.execute(text(f"""
        SELECT
            COUNT(*) AS total,
            SUM(u.is_blocked = 0) AS active,
            SUM(u.is_blocked = 1) AS blocked,
            SUM(DATE(u.created_at) = CURDATE()) AS todayRegistrations
        FROM users u WHERE {stats_where} {bot_exists}
    """), stats_params)
    s = stats_row.fetchone()

    vol_params: dict = {**stats_params}
    vol_row = await db.execute(text(f"""
        SELECT COALESCE(SUM(o.sum_rub), 0) AS totalVolume
        FROM orders o
        WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND {stats_where} {bot_exists})
    """), vol_params)
    total_volume = vol_row.scalar() or 0

    return {
        "users": users,
        "stats": {
            "total": int(s.total or 0),
            "active": int(s.active or 0),
            "premium": 0,
            "blocked": int(s.blocked or 0),
            "todayRegistrations": int(s.todayRegistrations or 0),
            "totalVolume": float(total_volume),
        },
        "total": total,
        "pages": -(-total // limit),
        "currentPage": page,
    }


@router.get("/{user_id}")
async def get_user_by_id(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN", "MANAGER", "OPERATOR")),
):
    # Resolve by internal id or tg_id
    try:
        num_id = int(user_id)
        if num_id > 100_000_000:
            where = "u.tg_id = :val"
        else:
            where = "u.id = :val"
    except ValueError:
        where = "u.tg_id = :val"

    if current_user.role == "EX_ADMIN":
        bot_row = await db.execute(text("SELECT id FROM bots WHERE owner_id = :uid"), {"uid": current_user.id})
        bot = bot_row.fetchone()
        if not bot:
            raise HTTPException(404, "Bot not found for admin")
        check = await db.execute(
            text(f"SELECT 1 FROM users u JOIN user_bots ub ON u.id = ub.user_id WHERE {where} AND ub.bot_id = :bot_id"),
            {"val": user_id, "bot_id": bot[0]}
        )
        if not check.fetchone():
            raise HTTPException(403, "Access denied to this user")

    row = await db.execute(text(f"""
        SELECT u.*, GROUP_CONCAT(DISTINCT b.name) AS bot_names, GROUP_CONCAT(DISTINCT b.id) AS bot_ids
        FROM users u
        LEFT JOIN user_bots ub ON u.id = ub.user_id
        LEFT JOIN bots b ON ub.bot_id = b.id
        WHERE {where} GROUP BY u.id
    """), {"val": user_id})
    user = row.fetchone()
    if not user:
        raise HTTPException(404, "User not found")

    user_data = dict(user._mapping)
    uid = user_data["id"]

    order_stats = await db.execute(text("""
        SELECT COUNT(*) AS orders_count,
               COALESCE(SUM(sum_rub),0) AS total_volume,
               COALESCE(SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed_orders,
               COALESCE(SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END),0) AS cancelled_orders,
               MIN(created_at) AS first_order_date, MAX(created_at) AS last_order_date
        FROM orders WHERE user_id = :uid
    """), {"uid": uid})
    os = order_stats.fetchone()

    recent = await db.execute(text("""
        SELECT o.id, o.unique_id, o.dir, o.coin, o.amount_coin, o.sum_rub, o.status, o.created_at, b.name AS bot_name
        FROM orders o LEFT JOIN bots b ON o.bot_id = b.id
        WHERE o.user_id = :uid ORDER BY o.created_at DESC LIMIT 10
    """), {"uid": uid})

    user_bots = await db.execute(text("""
        SELECT ub.*, b.name AS bot_name, b.identifier AS bot_identifier
        FROM user_bots ub LEFT JOIN bots b ON ub.bot_id = b.id
        WHERE ub.user_id = :uid
    """), {"uid": uid})

    user_data.update(dict(os._mapping))
    user_data["recent_orders"] = [dict(r._mapping) for r in recent.fetchall()]
    user_data["user_bots"] = [dict(r._mapping) for r in user_bots.fetchall()]
    return user_data


@router.get("/{user_id}/referrals")
async def get_user_referrals(
    user_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    try:
        num_id = int(user_id)
        where = "tg_id = :val" if num_id > 100_000_000 else "id = :val"
    except ValueError:
        where = "tg_id = :val"

    uid_row = await db.execute(text(f"SELECT id FROM users WHERE {where}"), {"val": user_id})
    uid = uid_row.scalar()
    if not uid:
        raise HTTPException(404, "User not found")

    offset = (page - 1) * limit
    refs = await db.execute(text("""
        SELECT u.id, u.tg_id, u.username, u.created_at AS registered_at,
               ub_inv.referral_level, ub_inv.referral_bonus_balance, b.name AS bot_name,
               COALESCE(os.orders_count,0) AS orders_count,
               COALESCE(os.total_volume,0) AS total_volume
        FROM user_bots ub_inviter
        JOIN user_bots ub_inv ON ub_inv.invited_by = ub_inviter.id
        JOIN users u ON ub_inv.user_id = u.id
        LEFT JOIN bots b ON ub_inv.bot_id = b.id
        LEFT JOIN (SELECT user_id, COUNT(*) AS orders_count, SUM(sum_rub) AS total_volume FROM orders GROUP BY user_id) os ON u.id = os.user_id
        WHERE ub_inviter.user_id = :uid
        ORDER BY u.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {"uid": uid, "limit": limit, "offset": offset})

    count_row = await db.execute(text("""
        SELECT COUNT(*) FROM user_bots ub_inviter
        JOIN user_bots ub_inv ON ub_inv.invited_by = ub_inviter.id
        WHERE ub_inviter.user_id = :uid
    """), {"uid": uid})
    total = count_row.scalar() or 0

    return {
        "referrals": [dict(r._mapping) for r in refs.fetchall()],
        "total": total,
        "pages": -(-total // limit),
        "currentPage": page,
    }


@router.patch("/{user_id}/discount")
async def update_user_discount(
    user_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    discount = body.get("discount", 0)
    if not (0 <= discount <= 50):
        raise HTTPException(400, "Discount must be between 0 and 50")

    result = await db.execute(
        text("UPDATE users SET discount_v = :d WHERE id = :uid"),
        {"d": discount, "uid": user_id}
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "User not found")
    return {"message": "Discount updated", "discount": discount}


@router.patch("/{user_id}/block")
async def block_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    result = await db.execute(
        text("UPDATE users SET is_blocked = 1 WHERE tg_id = :uid"),
        {"uid": user_id}
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "User not found")
    return {"message": "User blocked"}


@router.patch("/{user_id}/unblock")
async def unblock_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    result = await db.execute(
        text("UPDATE users SET is_blocked = 0 WHERE tg_id = :uid"),
        {"uid": user_id}
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "User not found")
    return {"message": "User unblocked"}
