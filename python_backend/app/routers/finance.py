from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import logging
import io

from app.database import get_db
from app.middleware.auth import require_auth
from app.models.support import Support

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/finance", tags=["finance"])


@router.get("/stats")
async def get_finance_stats(
    period: str = Query("day", regex="^(day|week|month)$"),
    support_id: Optional[int] = None,
    operator_type: Optional[str] = None,  # manual|card|auto|all
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Финансовая статистика за период (day/week/month).
    Суперадмин/менеджер видят всё; оператор — только своё.
    """
    if current_user.role == "OPERATOR":
        filter_uid = current_user.id
    elif support_id:
        filter_uid = support_id
    else:
        filter_uid = None

    period_sql = {"day": "1 DAY", "week": "7 DAY", "month": "30 DAY"}[period]

    params: dict = {"interval": period_sql}
    where_parts = [
        "o.status = 'COMPLETED'",
        f"o.completed_at >= DATE_SUB(NOW(), INTERVAL {period_sql})",
    ]

    if filter_uid:
        where_parts.append("o.support_id = :uid")
        params["uid"] = filter_uid

    if operator_type and operator_type != "all":
        where_parts.append("sp.operator_type = :op_type")
        params["op_type"] = operator_type

    where = " AND ".join(where_parts)

    # Общие итоги
    totals_row = await db.execute(
        text(f"""
            SELECT
                COUNT(*) AS orders_count,
                COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                COALESCE(SUM(o.operator_profit_rub), 0) AS profit_rub,
                COALESCE(AVG(o.operator_profit_rub), 0) AS avg_profit_rub
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE {where}
        """),
        params,
    )
    totals = dict(totals_row.mappings().one())

    # По операторам
    op_rows = await db.execute(
        text(f"""
            SELECT
                sp.id AS support_id,
                sp.login,
                sp.operator_type,
                COUNT(*) AS orders_count,
                COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                COALESCE(SUM(o.operator_profit_rub), 0) AS profit_rub,
                COUNT(DISTINCT o.shift_id) AS shifts_count
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE {where}
            GROUP BY sp.id, sp.login, sp.operator_type
            ORDER BY profit_rub DESC
        """),
        params,
    )
    by_operator = [dict(r._mapping) for r in op_rows]

    # График по дням
    chart_rows = await db.execute(
        text(f"""
            SELECT
                DATE(o.completed_at) AS date,
                COUNT(*) AS orders_count,
                COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                COALESCE(SUM(o.operator_profit_rub), 0) AS profit_rub
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE {where}
            GROUP BY DATE(o.completed_at)
            ORDER BY date ASC
        """),
        params,
    )
    chart = [dict(r._mapping) for r in chart_rows]
    # Convert date to string for JSON
    for row in chart:
        if row.get("date"):
            row["date"] = str(row["date"])

    return {
        "period": period,
        "totals": totals,
        "by_operator": by_operator,
        "chart": chart,
    }


@router.get("/operator/{support_id}")
async def get_operator_stats(
    support_id: int,
    period: str = Query("day", regex="^(day|week|month)$"),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Детальная статистика по одному оператору."""
    if current_user.role == "OPERATOR" and current_user.id != support_id:
        raise HTTPException(403, "Доступ запрещён")

    period_sql = {"day": "1 DAY", "week": "7 DAY", "month": "30 DAY"}[period]

    # Заявки
    orders_rows = await db.execute(
        text(f"""
            SELECT
                o.id, o.unique_id, o.dir, o.coin, o.sum_rub, o.amount_coin,
                o.operator_received_usdt, o.operator_rate_rub, o.operator_profit_rub,
                o.completed_at, o.shift_id
            FROM orders o
            WHERE o.support_id = :uid
              AND o.status = 'COMPLETED'
              AND o.completed_at >= DATE_SUB(NOW(), INTERVAL {period_sql})
            ORDER BY o.completed_at DESC
        """),
        {"uid": support_id},
    )
    orders = [dict(r._mapping) for r in orders_rows]

    # Смены
    shifts_rows = await db.execute(
        text(f"""
            SELECT *,
                TIMESTAMPDIFF(MINUTE, started_at, COALESCE(ended_at, NOW())) AS duration_min
            FROM operator_shifts
            WHERE support_id = :uid
              AND started_at >= DATE_SUB(NOW(), INTERVAL {period_sql})
            ORDER BY started_at DESC
        """),
        {"uid": support_id},
    )
    shifts = [dict(r._mapping) for r in shifts_rows]

    # Итог
    total_profit = sum(float(o.get("operator_profit_rub") or 0) for o in orders)
    total_volume = sum(float(o.get("sum_rub") or 0) for o in orders)
    total_penalty = sum(float(s.get("early_close_penalty") or 0) for s in shifts)

    return {
        "support_id": support_id,
        "period": period,
        "orders": orders,
        "shifts": shifts,
        "summary": {
            "orders_count": len(orders),
            "volume_rub": total_volume,
            "profit_rub": total_profit,
            "penalty_rub": total_penalty,
            "net_rub": total_profit - total_penalty,
            "shifts_count": len(shifts),
        },
    }


@router.get("/export")
async def export_finance(
    period: str = Query("month", regex="^(day|week|month)$"),
    support_id: Optional[int] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Экспорт финансовых данных в CSV."""
    if current_user.role not in ("SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Недостаточно прав")

    from fastapi.responses import StreamingResponse
    import csv

    period_sql = {"day": "1 DAY", "week": "7 DAY", "month": "30 DAY"}[period]
    params: dict = {}
    where_extra = ""
    if support_id:
        where_extra = " AND o.support_id = :uid"
        params["uid"] = support_id

    rows = await db.execute(
        text(f"""
            SELECT
                o.id, o.unique_id, o.dir, o.coin,
                o.sum_rub, o.amount_coin, o.rate_rub,
                o.operator_received_usdt, o.operator_rate_rub, o.operator_profit_rub,
                o.completed_at, o.shift_id,
                sp.login AS operator_login, sp.operator_type
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE o.status = 'COMPLETED'
              AND o.completed_at >= DATE_SUB(NOW(), INTERVAL {period_sql})
              {where_extra}
            ORDER BY o.completed_at DESC
        """),
        params,
    )
    data = [dict(r._mapping) for r in rows]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Уник.ID", "Направление", "Монета", "Сумма RUB", "Кол-во крипты",
        "Курс", "Получено USDT", "Фактический курс", "Прибыль RUB",
        "Завершена", "Смена", "Оператор", "Тип оператора"
    ])
    for r in data:
        writer.writerow([
            r["id"], r["unique_id"], r["dir"], r["coin"],
            r["sum_rub"], r["amount_coin"], r["rate_rub"],
            r["operator_received_usdt"], r["operator_rate_rub"], r["operator_profit_rub"],
            r["completed_at"], r["shift_id"], r["operator_login"], r["operator_type"]
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename=finance_{period}.csv"},
    )


@router.get("/monthly-summary")
async def get_monthly_summaries(
    months: int = Query(6, ge=1, le=24),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Итоги по месяцам (последние N месяцев)."""
    if current_user.role not in ("SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Недостаточно прав")

    rows = await db.execute(
        text("""
            SELECT
                DATE_FORMAT(o.completed_at, '%Y-%m-01') AS period,
                COUNT(*) AS orders_count,
                COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                COALESCE(SUM(o.operator_profit_rub), 0) AS profit_rub,
                COUNT(DISTINCT o.support_id) AS operators_count
            FROM orders o
            WHERE o.status = 'COMPLETED'
              AND o.completed_at >= DATE_SUB(NOW(), INTERVAL :months MONTH)
            GROUP BY DATE_FORMAT(o.completed_at, '%Y-%m-01')
            ORDER BY period DESC
        """),
        {"months": months},
    )
    return [dict(r._mapping) for r in rows]
