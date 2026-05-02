from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.support import Support
from app.services.referral_service import (
    get_tiers, get_first_bonus_rub, set_first_bonus_rub,
    set_custom_referral_percent, get_user_bot_referral_stats,
)

router = APIRouter(prefix="/api/referral-levels", tags=["referral-levels"])


class TierCreate(BaseModel):
    min_sum_rub: float
    max_sum_rub: Optional[float] = None
    bonus_percent: float
    label: Optional[str] = None
    sort_order: int = 0


class TierUpdate(BaseModel):
    min_sum_rub: Optional[float] = None
    max_sum_rub: Optional[float] = None
    bonus_percent: Optional[float] = None
    label: Optional[str] = None
    sort_order: Optional[int] = None


class FirstBonusUpdate(BaseModel):
    amount: float


class CustomPercentUpdate(BaseModel):
    percent: Optional[float] = None  # None = reset to tier system


# ── Tiers CRUD ──────────────────────────────────────────────────────────────

@router.get("/tiers")
async def list_tiers(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    tiers = await get_tiers(db)
    return {"success": True, "data": tiers}


@router.post("/tiers")
async def create_tier(
    body: TierCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    r = await db.execute(text("""
        INSERT INTO referral_level_tiers
            (min_sum_rub, max_sum_rub, bonus_percent, label, sort_order)
        VALUES (:min, :max, :pct, :label, :order)
    """), {
        "min": body.min_sum_rub,
        "max": body.max_sum_rub,
        "pct": body.bonus_percent,
        "label": body.label,
        "order": body.sort_order,
    })
    await db.commit()
    return {"success": True, "id": r.lastrowid}


@router.patch("/tiers/{tier_id}")
async def update_tier(
    tier_id: int,
    body: TierUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    row = await db.execute(text("SELECT id FROM referral_level_tiers WHERE id = :id"), {"id": tier_id})
    if not row.fetchone():
        raise HTTPException(404, "Tier not found")

    updates = {}
    if body.min_sum_rub is not None:
        updates["min_sum_rub"] = body.min_sum_rub
    if body.max_sum_rub is not None:
        updates["max_sum_rub"] = body.max_sum_rub
    if body.bonus_percent is not None:
        updates["bonus_percent"] = body.bonus_percent
    if body.label is not None:
        updates["label"] = body.label
    if body.sort_order is not None:
        updates["sort_order"] = body.sort_order

    if not updates:
        return {"success": True}

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    await db.execute(
        text(f"UPDATE referral_level_tiers SET {set_clause} WHERE id = :id"),
        {**updates, "id": tier_id},
    )
    await db.commit()
    return {"success": True}


@router.delete("/tiers/{tier_id}")
async def delete_tier(
    tier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    await db.execute(text("DELETE FROM referral_level_tiers WHERE id = :id"), {"id": tier_id})
    await db.commit()
    return {"success": True}


# ── First bonus ──────────────────────────────────────────────────────────────

@router.get("/first-bonus")
async def get_first_bonus(
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    amount = await get_first_bonus_rub(db)
    return {"success": True, "amount": amount}


@router.post("/first-bonus")
async def update_first_bonus(
    body: FirstBonusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    await set_first_bonus_rub(db, body.amount)
    return {"success": True}


# ── Custom percent per user ──────────────────────────────────────────────────

@router.patch("/users/{user_bot_id}/custom-percent")
async def set_custom_percent(
    user_bot_id: int,
    body: CustomPercentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    await set_custom_referral_percent(db, user_bot_id, body.percent)
    return {"success": True}


# ── User referral stats (admin view) ────────────────────────────────────────

@router.get("/users/{user_bot_id}/stats")
async def get_user_stats(
    user_bot_id: int,
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    stats = await get_user_bot_referral_stats(db, user_bot_id, bot_id)
    return {"success": True, "data": stats}


# ── Global stats ─────────────────────────────────────────────────────────────

@router.get("/global-stats")
async def global_stats(
    bot_id: int = None,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN", "EX_ADMIN")),
):
    from app.services.referral_service import get_global_stats
    stats = await get_global_stats(db, bot_id)
    return {"success": True, "data": stats}
