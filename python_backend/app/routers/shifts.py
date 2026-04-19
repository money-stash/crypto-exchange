from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel
import logging

from app.database import get_db
from app.middleware.auth import require_auth
from app.models.support import Support

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shifts", tags=["shifts"])


class StartShiftBody(BaseModel):
    planned_duration_min: Optional[int] = None  # override default from support profile


class EndShiftBody(BaseModel):
    notes: Optional[str] = None
    force: bool = False  # подтверждение штрафа


@router.post("/start")
async def start_shift(
    body: Optional[StartShiftBody] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Оператор начинает смену."""
    # Проверяем нет ли уже активной смены
    existing = await db.execute(
        text("SELECT id FROM operator_shifts WHERE support_id = :uid AND status = 'active'"),
        {"uid": current_user.id},
    )
    if existing.fetchone():
        raise HTTPException(400, "У вас уже есть активная смена")

    # Берём длительность из профиля оператора или из тела запроса
    support_row = await db.execute(
        text("SELECT shift_duration_min, penalty_per_hour FROM supports WHERE id = :id"),
        {"id": current_user.id},
    )
    support = support_row.mappings().one_or_none()
    planned_min = (body.planned_duration_min if body and body.planned_duration_min else None) or \
                  (support["shift_duration_min"] if support else 480)

    result = await db.execute(
        text("""
            INSERT INTO operator_shifts (support_id, planned_duration_min, status, started_at, created_at)
            VALUES (:uid, :planned_min, 'active', NOW(), NOW())
        """),
        {"uid": current_user.id, "planned_min": planned_min},
    )
    shift_id = result.lastrowid

    row = await db.execute(text("SELECT * FROM operator_shifts WHERE id = :id"), {"id": shift_id})
    shift = dict(row.mappings().one())
    logger.info(f"Operator {current_user.login} started shift {shift_id} ({planned_min} min)")
    return {"success": True, "shift": shift}


@router.get("/current")
async def get_current_shift(
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Получить активную смену текущего оператора."""
    row = await db.execute(
        text("""
            SELECT s.*,
                   TIMESTAMPDIFF(MINUTE, s.started_at, NOW()) AS elapsed_min,
                   sp.penalty_per_hour
            FROM operator_shifts s
            JOIN supports sp ON sp.id = s.support_id
            WHERE s.support_id = :uid AND s.status = 'active'
            ORDER BY s.started_at DESC LIMIT 1
        """),
        {"uid": current_user.id},
    )
    shift = row.mappings().one_or_none()
    if not shift:
        return {"shift": None}

    shift = dict(shift)
    elapsed_min = int(shift.get("elapsed_min") or 0)
    planned_min = int(shift.get("planned_duration_min") or 480)
    penalty_per_hour = float(shift.get("penalty_per_hour") or 0)

    remaining_min = max(0, planned_min - elapsed_min)
    # Штраф если закроем прямо сейчас
    if elapsed_min < planned_min and penalty_per_hour > 0:
        remaining_hours = (planned_min - elapsed_min) / 60
        early_penalty = round(remaining_hours * penalty_per_hour, 2)
    else:
        early_penalty = 0

    return {
        "shift": shift,
        "elapsed_min": elapsed_min,
        "remaining_min": remaining_min,
        "early_penalty": early_penalty,
        "is_early": elapsed_min < planned_min,
    }


@router.post("/end")
async def end_shift(
    body: Optional[EndShiftBody] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Оператор завершает смену."""
    row = await db.execute(
        text("""
            SELECT s.*, sp.penalty_per_hour
            FROM operator_shifts s
            JOIN supports sp ON sp.id = s.support_id
            WHERE s.support_id = :uid AND s.status = 'active'
            ORDER BY s.started_at DESC LIMIT 1
        """),
        {"uid": current_user.id},
    )
    shift = row.mappings().one_or_none()
    if not shift:
        raise HTTPException(404, "Активная смена не найдена")

    shift = dict(shift)
    shift_id = shift["id"]
    elapsed_min = int((await db.execute(
        text("SELECT TIMESTAMPDIFF(MINUTE, started_at, NOW()) FROM operator_shifts WHERE id = :id"),
        {"id": shift_id},
    )).scalar() or 0)
    planned_min = int(shift.get("planned_duration_min") or 480)
    penalty_per_hour = float(shift.get("penalty_per_hour") or 0)

    is_early = elapsed_min < planned_min
    if is_early and not (body and body.force):
        remaining_hours = (planned_min - elapsed_min) / 60
        penalty = round(remaining_hours * penalty_per_hour, 2)
        return {
            "requires_confirmation": True,
            "is_early": True,
            "elapsed_min": elapsed_min,
            "planned_min": planned_min,
            "remaining_min": planned_min - elapsed_min,
            "early_penalty": penalty,
            "message": f"Смена заканчивается раньше времени. Штраф составит {penalty:,.2f} ₽",
        }

    # Считаем итоги смены
    stats_row = await db.execute(
        text("""
            SELECT
                COUNT(*) AS orders_completed,
                COALESCE(SUM(sum_rub), 0) AS total_volume_rub,
                COALESCE(SUM(COALESCE(operator_profit_rub, 0)), 0) AS total_profit_rub
            FROM orders
            WHERE shift_id = :sid AND status = 'COMPLETED'
        """),
        {"sid": shift_id},
    )
    stats = dict(stats_row.mappings().one())

    remaining_hours = max(0, (planned_min - elapsed_min) / 60)
    penalty = round(remaining_hours * penalty_per_hour, 2) if is_early else 0

    await db.execute(
        text("""
            UPDATE operator_shifts SET
                status = 'closed',
                ended_at = NOW(),
                actual_duration_min = :elapsed_min,
                early_close_penalty = :penalty,
                orders_completed = :orders_completed,
                total_volume_rub = :volume,
                total_profit_rub = :profit,
                notes = :notes
            WHERE id = :id
        """),
        {
            "id": shift_id,
            "elapsed_min": elapsed_min,
            "penalty": penalty,
            "orders_completed": stats["orders_completed"],
            "volume": stats["total_volume_rub"],
            "profit": stats["total_profit_rub"],
            "notes": (body.notes if body else None),
        },
    )

    updated = await db.execute(text("SELECT * FROM operator_shifts WHERE id = :id"), {"id": shift_id})
    updated_shift = dict(updated.mappings().one())
    logger.info(f"Operator {current_user.login} ended shift {shift_id}, penalty={penalty}")
    return {"success": True, "shift": updated_shift, "early_penalty": penalty}


@router.patch("/{shift_id}/penalty")
async def update_shift_penalty(
    shift_id: int,
    body: dict,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Суперадмин изменяет штраф за ранний выход из смены."""
    if current_user.role != "SUPERADMIN":
        raise HTTPException(403, "Только суперадмин может изменять штраф")

    new_penalty = body.get("penalty")
    if new_penalty is None or float(new_penalty) < 0:
        raise HTTPException(400, "Некорректное значение штрафа")

    row = await db.execute(
        text("SELECT id FROM operator_shifts WHERE id = :id"),
        {"id": shift_id},
    )
    if not row.fetchone():
        raise HTTPException(404, "Смена не найдена")

    await db.execute(
        text("UPDATE operator_shifts SET early_close_penalty = :penalty WHERE id = :id"),
        {"penalty": float(new_penalty), "id": shift_id},
    )
    await db.commit()
    updated = await db.execute(text("SELECT * FROM operator_shifts WHERE id = :id"), {"id": shift_id})
    return dict(updated.mappings().one())


@router.get("/")
async def list_shifts(
    support_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Список смен. Оператор видит только свои, менеджер/суперадмин — все."""
    if current_user.role == "OPERATOR":
        uid = current_user.id
    else:
        uid = support_id  # None = все

    where = "1=1"
    params: dict = {"limit": limit, "offset": offset}
    if uid:
        where += " AND s.support_id = :uid"
        params["uid"] = uid

    rows = await db.execute(
        text(f"""
            SELECT s.*,
                   sp.login AS operator_login,
                   TIMESTAMPDIFF(MINUTE, s.started_at, COALESCE(s.ended_at, NOW())) AS duration_min
            FROM operator_shifts s
            JOIN supports sp ON sp.id = s.support_id
            WHERE {where}
            ORDER BY s.started_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]
