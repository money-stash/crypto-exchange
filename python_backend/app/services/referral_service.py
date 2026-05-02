"""
Referral service — DB-driven tiers, first-bonus, custom per-user percent.
"""
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


# ---------------------------------------------------------------------------
# Tier helpers
# ---------------------------------------------------------------------------

async def get_tiers(db: AsyncSession) -> list[dict]:
    """Load all tiers ordered by min_sum_rub ASC."""
    rows = await db.execute(text("""
        SELECT id, min_sum_rub, max_sum_rub, bonus_percent, label, sort_order
        FROM referral_level_tiers
        ORDER BY sort_order ASC, min_sum_rub ASC
    """))
    return [dict(r) for r in rows.mappings()]


async def _get_tier_for_sum(db: AsyncSession, total_sum: float) -> dict | None:
    """Return the best matching tier for a given total referral turnover."""
    tiers = await get_tiers(db)
    best = None
    for t in tiers:
        mn = float(t["min_sum_rub"] or 0)
        mx = t["max_sum_rub"]
        if total_sum >= mn and (mx is None or total_sum < float(mx)):
            best = t
    return best


async def get_first_bonus_rub(db: AsyncSession) -> float:
    """Read first-bonus amount from system_settings."""
    row = await db.execute(
        text("SELECT value FROM system_settings WHERE `key` = 'referral_first_bonus_rub'")
    )
    r = row.fetchone()
    try:
        return float(r[0]) if r and r[0] else 0.0
    except Exception:
        return 0.0


async def set_first_bonus_rub(db: AsyncSession, amount: float) -> None:
    await db.execute(text("""
        INSERT INTO system_settings (`key`, value) VALUES ('referral_first_bonus_rub', :v)
        ON DUPLICATE KEY UPDATE value = :v
    """), {"v": str(amount)})
    await db.commit()


# ---------------------------------------------------------------------------
# Internal stats helper
# ---------------------------------------------------------------------------

async def _get_referral_stats(db: AsyncSession, user_bot_id: int, bot_id: int) -> dict:
    row = await db.execute(text("""
        SELECT
            COUNT(o.id)                       AS orders_count,
            COALESCE(SUM(o.sum_rub), 0)       AS total_sum
        FROM orders o
        JOIN user_bots ub ON o.user_bot_id = ub.id
        WHERE ub.invited_by = :ubid
          AND ub.bot_id     = :bid
          AND o.status      = 'COMPLETED'
    """), {"ubid": user_bot_id, "bid": bot_id})
    r = row.fetchone()
    return {
        "referralsOrders": int(r.orders_count or 0),
        "referralsSum": float(r.total_sum or 0),
    }


# ---------------------------------------------------------------------------
# Level label (for display)
# ---------------------------------------------------------------------------

async def get_current_tier_label(db: AsyncSession, user_bot_id: int, bot_id: int) -> str:
    stats = await _get_referral_stats(db, user_bot_id, bot_id)
    tier = await _get_tier_for_sum(db, stats["referralsSum"])
    if not tier:
        return "—"
    return tier.get("label") or f"{tier['bonus_percent']}%"


# ---------------------------------------------------------------------------
# Process bonus on order completion
# ---------------------------------------------------------------------------

async def process_referral_bonus(
    db: AsyncSession,
    order_id: int,
    order_sum: float,
    referred_user_bot_id: int,
    bot_id: int,
) -> dict | None:
    """
    Called when an order is completed.
    Finds the referrer, applies correct %, saves bonus record, updates balance.
    Also handles first-exchange bonus if applicable.
    """
    try:
        # Find referrer
        ref_row = await db.execute(
            text("SELECT invited_by FROM user_bots WHERE id = :id"),
            {"id": referred_user_bot_id},
        )
        referred_ub = ref_row.fetchone()
        if not referred_ub or not referred_ub.invited_by:
            return None
        referrer_id = referred_ub.invited_by

        # Verify referrer exists
        exists = await db.execute(
            text("SELECT id FROM user_bots WHERE id = :id"), {"id": referrer_id}
        )
        if not exists.fetchone():
            return None

        # ── Determine bonus percentage ──────────────────────────────────────
        # 1. Check custom percent override for this referrer
        custom_row = await db.execute(
            text("SELECT custom_referral_percent FROM user_bots WHERE id = :id"),
            {"id": referrer_id},
        )
        custom_r = custom_row.fetchone()
        custom_pct = custom_r.custom_referral_percent if custom_r else None

        if custom_pct is not None:
            bonus_percent = Decimal(str(custom_pct)) / Decimal("100")
            tier_label = f"Индивидуальный ({custom_pct}%)"
        else:
            # 2. Use tier system based on referrer's total referral turnover
            stats = await _get_referral_stats(db, referrer_id, bot_id)
            tier = await _get_tier_for_sum(db, stats["referralsSum"])
            if tier:
                bonus_percent = Decimal(str(tier["bonus_percent"])) / Decimal("100")
                tier_label = tier.get("label") or f"{tier['bonus_percent']}%"
            else:
                bonus_percent = Decimal("0")
                tier_label = "BASIC"

        bonus_amount = Decimal(str(order_sum)) * bonus_percent

        if bonus_amount > 0:
            await db.execute(text("""
                INSERT INTO referral_bonuses
                    (referrer_userbot_id, referred_userbot_id, order_id, bot_id,
                     bonus_amount, bonus_percentage, referrer_level)
                VALUES
                    (:referrer, :referred, :order_id, :bot_id,
                     :bonus_amount, :bonus_pct, :level)
            """), {
                "referrer": referrer_id,
                "referred": referred_user_bot_id,
                "order_id": order_id,
                "bot_id": bot_id,
                "bonus_amount": bonus_amount,
                "bonus_pct": bonus_percent,
                "level": tier_label,
            })

            await db.execute(text("""
                UPDATE user_bots
                SET referral_bonus_balance = referral_bonus_balance + :amount
                WHERE id = :ubid
            """), {"amount": bonus_amount, "ubid": referrer_id})

        # ── First-exchange bonus ─────────────────────────────────────────────
        first_bonus_rub = await get_first_bonus_rub(db)
        if first_bonus_rub > 0:
            first_row = await db.execute(
                text("SELECT first_bonus_paid FROM user_bots WHERE id = :id"),
                {"id": referred_user_bot_id},
            )
            first_r = first_row.fetchone()
            if first_r and not first_r.first_bonus_paid:
                fb = Decimal(str(first_bonus_rub))
                await db.execute(text("""
                    INSERT INTO referral_bonuses
                        (referrer_userbot_id, referred_userbot_id, order_id, bot_id,
                         bonus_amount, bonus_percentage, referrer_level)
                    VALUES
                        (:referrer, :referred, :order_id, :bot_id, :fb, 0, 'FIRST_BONUS')
                """), {
                    "referrer": referrer_id,
                    "referred": referred_user_bot_id,
                    "order_id": order_id,
                    "bot_id": bot_id,
                    "fb": fb,
                })
                await db.execute(text("""
                    UPDATE user_bots
                    SET referral_bonus_balance = referral_bonus_balance + :fb,
                        first_bonus_paid = 1
                    WHERE id = :ubid
                """), {"fb": fb, "ubid": referred_user_bot_id})

        return {
            "referrer_userbot_id": referrer_id,
            "referred_userbot_id": referred_user_bot_id,
            "order_id": order_id,
            "bot_id": bot_id,
            "bonus_amount": float(bonus_amount),
            "bonus_percentage": float(bonus_percent),
            "tier_label": tier_label,
        }
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"process_referral_bonus error: {exc}")
        return None


# ---------------------------------------------------------------------------
# Admin: set custom percent for a referrer
# ---------------------------------------------------------------------------

async def set_custom_referral_percent(
    db: AsyncSession, user_bot_id: int, percent: float | None
) -> None:
    """Set or clear custom referral percent for a specific user_bot."""
    if percent is None:
        await db.execute(text("""
            UPDATE user_bots
            SET custom_referral_percent = NULL, custom_referral_set_at = NULL
            WHERE id = :id
        """), {"id": user_bot_id})
    else:
        await db.execute(text("""
            UPDATE user_bots
            SET custom_referral_percent = :pct, custom_referral_set_at = NOW()
            WHERE id = :id
        """), {"pct": percent, "id": user_bot_id})
    await db.commit()


# ---------------------------------------------------------------------------
# Balance
# ---------------------------------------------------------------------------

async def get_available_balance(db: AsyncSession, user_bot_id: int) -> float:
    row = await db.execute(text("""
        SELECT
            COALESCE((SELECT SUM(bonus_amount) FROM referral_bonuses WHERE referrer_userbot_id = :ubid), 0)
            -
            COALESCE((SELECT SUM(amount_rub) FROM referrals_withdraw
                       WHERE userbot_id = :ubid AND status IN ('CREATED','COMPLETED')), 0)
            AS available
    """), {"ubid": user_bot_id})
    r = row.fetchone()
    return max(0.0, float(r.available or 0))


async def get_total_earned(db: AsyncSession, user_bot_id: int) -> float:
    row = await db.execute(text("""
        SELECT COALESCE(SUM(bonus_amount), 0) AS total
        FROM referral_bonuses WHERE referrer_userbot_id = :ubid
    """), {"ubid": user_bot_id})
    r = row.fetchone()
    return float(r.total or 0)


async def get_total_paid_out(db: AsyncSession, user_bot_id: int) -> float:
    row = await db.execute(text("""
        SELECT COALESCE(SUM(amount_rub), 0) AS total
        FROM referrals_withdraw WHERE userbot_id = :ubid AND status = 'COMPLETED'
    """), {"ubid": user_bot_id})
    r = row.fetchone()
    return float(r.total or 0)


# ---------------------------------------------------------------------------
# Full referral stats (admin + bot)
# ---------------------------------------------------------------------------

async def get_user_bot_referral_stats(db: AsyncSession, user_bot_id: int, bot_id: int) -> dict:
    code_row = await db.execute(
        text("SELECT referral_code, custom_referral_percent FROM user_bots WHERE id = :id AND bot_id = :bid"),
        {"id": user_bot_id, "bid": bot_id},
    )
    code_r = code_row.fetchone()
    referral_code = code_r.referral_code if code_r else None
    custom_pct = float(code_r.custom_referral_percent) if code_r and code_r.custom_referral_percent else None

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

    total_sum = float(o.total_sum or 0)

    # Current tier
    if custom_pct is not None:
        tier_label = f"Индивидуальный ({custom_pct}%)"
        current_percent = custom_pct
    else:
        tier = await _get_tier_for_sum(db, total_sum)
        tier_label = (tier.get("label") or f"{tier['bonus_percent']}%") if tier else "—"
        current_percent = float(tier["bonus_percent"]) if tier else 0.0

    earned = await get_total_earned(db, user_bot_id)
    paid_out = await get_total_paid_out(db, user_bot_id)
    balance = await get_available_balance(db, user_bot_id)

    list_rows = await db.execute(text("""
        SELECT ub.id, ub.username, ub.created_at,
               COUNT(o.id) AS orders_count,
               COALESCE(SUM(o.sum_rub), 0) AS total_sum
        FROM user_bots ub
        LEFT JOIN orders o ON ub.id = o.user_bot_id AND o.status = 'COMPLETED'
        WHERE ub.invited_by = :ubid AND ub.bot_id = :bid
        GROUP BY ub.id, ub.username, ub.created_at
        ORDER BY ub.created_at DESC
        LIMIT 20
    """), {"ubid": user_bot_id, "bid": bot_id})

    return {
        "referralCode": referral_code,
        "referralsCount": referrals_count,
        "referralsOrders": int(o.orders_count or 0),
        "referralsSum": total_sum,
        "tierLabel": tier_label,
        "currentPercent": current_percent,
        "customPercent": custom_pct,
        "earned": earned,
        "paidOut": paid_out,
        "balance": balance,
        "referrals": [dict(r._mapping) for r in list_rows.fetchall()],
    }


async def get_global_stats(db: AsyncSession, bot_id: int | None = None) -> dict:
    try:
        users_where = "WHERE bot_id = :bid" if bot_id else ""
        users_params = {"bid": bot_id} if bot_id else {}
        users_row = await db.execute(text(f"""
            SELECT
                COUNT(CASE WHEN invited_by IS NOT NULL THEN 1 END) AS total_referrals,
                COUNT(CASE WHEN invited_by IS NULL THEN 1 END)     AS total_referrers
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

        return {
            "total_referrals": int(u.total_referrals or 0),
            "total_referrers": int(u.total_referrers or 0),
            "total_bonuses": int(b.total_bonuses or 0),
            "total_bonus_amount": float(b.total_bonus_amount or 0),
            "active_referrers": int(b.active_referrers or 0),
        }
    except Exception:
        return {"total_referrals": 0, "total_referrers": 0,
                "total_bonuses": 0, "total_bonus_amount": 0.0, "active_referrers": 0}


async def generate_referral_code(db: AsyncSession, user_bot_id: int, bot_id: int) -> str:
    code = f"REF{str(user_bot_id).zfill(6)}B{bot_id}"
    await db.execute(
        text("UPDATE user_bots SET referral_code = :code WHERE id = :ubid AND bot_id = :bid"),
        {"code": code, "ubid": user_bot_id, "bid": bot_id},
    )
    return code
