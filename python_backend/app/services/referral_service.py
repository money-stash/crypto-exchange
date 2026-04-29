from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


REFERRAL_LEVELS = {
    "BASIC":        {"name": "Базовый",       "percentage": Decimal("0"),     "minOrders": 0,   "minSum": Decimal("0")},
    "ADVANCED":     {"name": "Продвинутый",   "percentage": Decimal("0.015"), "minOrders": 100, "minSum": Decimal("250000")},
    "ADVANCED_PLUS":{"name": "Продвинутый+",  "percentage": Decimal("0.02"),  "minOrders": 250, "minSum": Decimal("650000")},
    "VIP":          {"name": "VIP",            "percentage": Decimal("0.025"), "minOrders": 350, "minSum": Decimal("1000000")},
    "VIP_PLUS":     {"name": "VIP+",           "percentage": Decimal("0.03"),  "minOrders": 500, "minSum": Decimal("1500000")},
}

_LEVEL_ORDER = list(REFERRAL_LEVELS.keys())


async def _get_referral_stats(db: AsyncSession, user_bot_id: int, bot_id: int) -> dict:
    """Equivalent of UserBot.getReferralStats in Node.js"""
    orders_row = await db.execute(text("""
        SELECT
            COUNT(o.id) AS orders_count,
            COALESCE(SUM(o.sum_rub), 0) AS total_sum
        FROM orders o
        JOIN user_bots ub ON o.user_bot_id = ub.id
        WHERE ub.invited_by = :ubid
          AND ub.bot_id = :bid
          AND o.status = 'COMPLETED'
    """), {"ubid": user_bot_id, "bid": bot_id})
    r = orders_row.fetchone()
    return {
        "referralsOrders": int(r.orders_count or 0),
        "referralsSum": float(r.total_sum or 0),
    }


async def update_referral_level(db: AsyncSession, user_bot_id: int, bot_id: int) -> str:
    """
    Recalculates and persists referral level for a user-bot.
    Returns the new level string.
    Equivalent of ReferralService.updateReferralLevel in Node.js.
    """
    try:
        stats = await _get_referral_stats(db, user_bot_id, bot_id)
        orders_count = stats["referralsOrders"]
        orders_sum = stats["referralsSum"]

        new_level = "BASIC"
        for level in reversed(_LEVEL_ORDER):
            cfg = REFERRAL_LEVELS[level]
            if orders_count >= cfg["minOrders"] and orders_sum >= float(cfg["minSum"]):
                new_level = level
                break

        await db.execute(text("""
            UPDATE user_bots SET referral_level = :lvl WHERE id = :ubid AND bot_id = :bid
        """), {"lvl": new_level, "ubid": user_bot_id, "bid": bot_id})

        return new_level
    except Exception:
        return "BASIC"


async def process_referral_bonus(
    db: AsyncSession,
    order_id: int,
    order_sum: float,
    referred_user_bot_id: int,
    bot_id: int,
) -> dict | None:
    """
    Called when order is completed. Finds referrer, calculates bonus, persists it.
    Equivalent of ReferralService.processReferralBonus in Node.js.
    """
    try:
        row = await db.execute(
            text("SELECT invited_by FROM user_bots WHERE id = :id"),
            {"id": referred_user_bot_id},
        )
        referred = row.fetchone()
        if not referred or not referred.invited_by:
            return None

        referrer_id = referred.invited_by

        ref_row = await db.execute(
            text("SELECT id FROM user_bots WHERE id = :id"),
            {"id": referrer_id},
        )
        if not ref_row.fetchone():
            return None

        current_level = await update_referral_level(db, referrer_id, bot_id)
        cfg = REFERRAL_LEVELS.get(current_level, REFERRAL_LEVELS["BASIC"])
        bonus_percentage = cfg["percentage"]
        bonus_amount = Decimal(str(order_sum)) * bonus_percentage

        await db.execute(text("""
            INSERT INTO referral_bonuses
                (referrer_userbot_id, referred_userbot_id, order_id, bot_id, bonus_amount, bonus_percentage, referrer_level)
            VALUES
                (:referrer, :referred, :order_id, :bot_id, :bonus_amount, :bonus_pct, :level)
        """), {
            "referrer": referrer_id,
            "referred": referred_user_bot_id,
            "order_id": order_id,
            "bot_id": bot_id,
            "bonus_amount": bonus_amount,
            "bonus_pct": bonus_percentage,
            "level": current_level,
        })

        await db.execute(text("""
            UPDATE user_bots
            SET referral_bonus_balance = referral_bonus_balance + :amount
            WHERE id = :ubid AND bot_id = :bid
        """), {"amount": bonus_amount, "ubid": referrer_id, "bid": bot_id})

        return {
            "referrer_userbot_id": referrer_id,
            "referred_userbot_id": referred_user_bot_id,
            "order_id": order_id,
            "bot_id": bot_id,
            "bonus_amount": float(bonus_amount),
            "bonus_percentage": float(bonus_percentage),
            "referrer_level": current_level,
        }
    except Exception:
        return None


def get_referral_level_info(level: str) -> dict:
    """Returns config for a given level. Equivalent of ReferralService.getReferralLevelInfo."""
    return REFERRAL_LEVELS.get(level, REFERRAL_LEVELS["BASIC"])


def get_next_level_requirements(current_level: str, referrals_count: int, referrals_sum: float) -> dict | None:
    """
    Returns progress toward next tier.
    Equivalent of ReferralService.getNextLevelRequirements in Node.js.
    """
    idx = _LEVEL_ORDER.index(current_level) if current_level in _LEVEL_ORDER else -1
    if idx == -1 or idx == len(_LEVEL_ORDER) - 1:
        return None

    next_level = _LEVEL_ORDER[idx + 1]
    cfg = REFERRAL_LEVELS[next_level]
    return {
        "level": next_level,
        "name": cfg["name"],
        "percentage": float(cfg["percentage"]),
        "ordersNeeded": max(0, cfg["minOrders"] - referrals_count),
        "sumNeeded": max(0.0, float(cfg["minSum"]) - referrals_sum),
    }


async def get_global_stats(db: AsyncSession, bot_id: int | None = None) -> dict:
    """
    System-wide referral stats for admin panel.
    Equivalent of ReferralService.getGlobalStats in Node.js.
    """
    try:
        users_where = "WHERE bot_id = :bid" if bot_id else ""
        users_params = {"bid": bot_id} if bot_id else {}
        users_row = await db.execute(text(f"""
            SELECT
                COUNT(CASE WHEN invited_by IS NOT NULL THEN 1 END) AS total_referrals,
                COUNT(CASE WHEN invited_by IS NULL THEN 1 END) AS total_referrers
            FROM user_bots {users_where}
        """), users_params)
        u = users_row.fetchone()

        bonus_where = "WHERE bot_id = :bid" if bot_id else ""
        bonus_params = {"bid": bot_id} if bot_id else {}
        bonus_row = await db.execute(text(f"""
            SELECT
                COUNT(*) AS total_bonuses,
                COALESCE(SUM(bonus_amount), 0) AS total_bonus_amount,
                COUNT(DISTINCT referrer_userbot_id) AS active_referrers
            FROM referral_bonuses {bonus_where}
        """), bonus_params)
        b = bonus_row.fetchone()

        level_extra = "AND bot_id = :bid" if bot_id else ""
        level_params = {"bid": bot_id} if bot_id else {}
        level_rows = await db.execute(text(f"""
            SELECT referral_level, COUNT(*) AS count
            FROM user_bots
            WHERE referral_level IS NOT NULL {level_extra}
            GROUP BY referral_level
        """), level_params)

        return {
            "total_referrals": int(u.total_referrals or 0),
            "total_referrers": int(u.total_referrers or 0),
            "total_bonuses": int(b.total_bonuses or 0),
            "total_bonus_amount": float(b.total_bonus_amount or 0),
            "active_referrers": int(b.active_referrers or 0),
            "level_distribution": [dict(r._mapping) for r in level_rows.fetchall()],
        }
    except Exception:
        return {
            "total_referrals": 0,
            "total_referrers": 0,
            "total_bonuses": 0,
            "total_bonus_amount": 0.0,
            "active_referrers": 0,
            "level_distribution": [],
        }


async def get_available_balance(db: AsyncSession, user_bot_id: int) -> float:
    """
    Calculates available balance for withdrawal.
    Formula: SUM(bonuses) - SUM(withdrawals WHERE status IN ('CREATED','COMPLETED'))
    Equivalent of ReferralWithdraw.getAvailableBalance in Node.js.
    """
    row = await db.execute(text("""
        SELECT
            COALESCE((SELECT SUM(bonus_amount) FROM referral_bonuses WHERE referrer_userbot_id = :ubid), 0)
            -
            COALESCE((SELECT SUM(amount_rub) FROM referrals_withdraw WHERE userbot_id = :ubid AND status IN ('CREATED','COMPLETED')), 0)
            AS available
    """), {"ubid": user_bot_id})
    r = row.fetchone()
    return max(0.0, float(r.available or 0))


async def get_user_bot_referral_stats(db: AsyncSession, user_bot_id: int, bot_id: int) -> dict:
    """
    Full referral stats for a user-bot (used in bot cabinet and admin user detail).
    Equivalent of UserBot.getReferralStats in Node.js.
    """
    code_row = await db.execute(
        text("SELECT referral_code FROM user_bots WHERE id = :id AND bot_id = :bid"),
        {"id": user_bot_id, "bid": bot_id},
    )
    code_r = code_row.fetchone()
    referral_code = code_r.referral_code if code_r else None

    count_row = await db.execute(
        text("SELECT COUNT(*) AS cnt FROM user_bots WHERE invited_by = :ubid AND bot_id = :bid"),
        {"ubid": user_bot_id, "bid": bot_id},
    )
    referrals_count = int(count_row.scalar() or 0)

    orders_row = await db.execute(text("""
        SELECT COUNT(o.id) AS orders_count, COALESCE(SUM(o.sum_rub), 0) AS total_sum
        FROM orders o
        JOIN user_bots ub ON o.user_bot_id = ub.id
        WHERE ub.invited_by = :ubid AND ub.bot_id = :bid AND o.status = 'COMPLETED'
    """), {"ubid": user_bot_id, "bid": bot_id})
    o = orders_row.fetchone()

    list_rows = await db.execute(text("""
        SELECT ub.id, ub.username, ub.created_at,
               COUNT(o.id) AS orders_count,
               COALESCE(SUM(o.sum_rub), 0) AS total_sum
        FROM user_bots ub
        LEFT JOIN orders o ON ub.id = o.user_bot_id AND o.status = 'COMPLETED'
        WHERE ub.invited_by = :ubid AND ub.bot_id = :bid
        GROUP BY ub.id, ub.username, ub.created_at
        ORDER BY ub.created_at DESC
        LIMIT 10
    """), {"ubid": user_bot_id, "bid": bot_id})

    return {
        "referralCode": referral_code,
        "referralsCount": referrals_count,
        "referralsOrders": int(o.orders_count or 0),
        "referralsSum": float(o.total_sum or 0),
        "referrals": [dict(r._mapping) for r in list_rows.fetchall()],
    }


async def generate_referral_code(db: AsyncSession, user_bot_id: int, bot_id: int) -> str:
    """
    Generates and saves referral code REF{userBotId:06d}B{botId}.
    Equivalent of UserBot.generateReferralCode in Node.js.
    """
    code = f"REF{str(user_bot_id).zfill(6)}B{bot_id}"
    await db.execute(
        text("UPDATE user_bots SET referral_code = :code WHERE id = :ubid AND bot_id = :bid"),
        {"code": code, "ubid": user_bot_id, "bid": bot_id},
    )
    return code
