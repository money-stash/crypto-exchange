from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel as _BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Optional as _Optional
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

    period_cond = {
        "day":   "DATE(o.completed_at) = CURDATE()",
        "week":  "DATE(o.completed_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(o.completed_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]

    params: dict = {}
    where_parts = [
        "o.status = 'COMPLETED'",
        period_cond,
    ]

    if filter_uid:
        where_parts.append("o.support_id = :uid")
        params["uid"] = filter_uid

    # operator_type filter removed — column does not exist in supports table

    where = " AND ".join(where_parts)

    # Общие итоги (с fallback если колонки миграции ещё не применены)
    try:
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
    except Exception:
        totals_row = await db.execute(
            text(f"""
                SELECT COUNT(*) AS orders_count, COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                       0 AS profit_rub, 0 AS avg_profit_rub
                FROM orders o WHERE {where}
            """),
            {k: v for k, v in params.items() if k != "op_type"},
        )
        totals = dict(totals_row.mappings().one())

    # По операторам
    try:
        op_rows = await db.execute(
            text(f"""
                SELECT
                    sp.id AS support_id,
                    sp.login,
                    COUNT(*) AS orders_count,
                    COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                    COALESCE(SUM(o.operator_profit_rub), 0) AS profit_rub,
                    COUNT(DISTINCT o.shift_id) AS shifts_count
                FROM orders o
                LEFT JOIN supports sp ON sp.id = o.support_id
                WHERE {where}
                GROUP BY sp.id, sp.login
                ORDER BY volume_rub DESC
            """),
            params,
        )
        by_operator = [dict(r._mapping) for r in op_rows]
    except Exception:
        try:
            op_rows = await db.execute(
                text(f"""
                    SELECT sp.id AS support_id, sp.login,
                           COUNT(*) AS orders_count, COALESCE(SUM(o.sum_rub), 0) AS volume_rub,
                           0 AS profit_rub, 0 AS shifts_count
                    FROM orders o
                    LEFT JOIN supports sp ON sp.id = o.support_id
                    WHERE {where}
                    GROUP BY sp.id, sp.login
                    ORDER BY volume_rub DESC
                """),
                {k: v for k, v in params.items() if k != "op_type"},
            )
            by_operator = [dict(r._mapping) for r in op_rows]
        except Exception:
            by_operator = []

    # График по дням
    try:
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
    except Exception:
        chart_rows = await db.execute(
            text(f"""
                SELECT DATE(o.completed_at) AS date, COUNT(*) AS orders_count,
                       COALESCE(SUM(o.sum_rub), 0) AS volume_rub, 0 AS profit_rub
                FROM orders o WHERE {where}
                GROUP BY DATE(o.completed_at) ORDER BY date ASC
            """),
            {k: v for k, v in params.items() if k != "op_type"},
        )
        chart = [dict(r._mapping) for r in chart_rows]
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

    period_cond_o = {
        "day":   "DATE(o.completed_at) = CURDATE()",
        "week":  "DATE(o.completed_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(o.completed_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]
    period_cond_s = {
        "day":   "DATE(started_at) = CURDATE()",
        "week":  "DATE(started_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(started_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]

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
              AND {period_cond_o}
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
              AND {period_cond_s}
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

    period_cond_export = {
        "day":   "DATE(o.completed_at) = CURDATE()",
        "week":  "DATE(o.completed_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(o.completed_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]
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
                sp.login AS operator_login
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE o.status = 'COMPLETED'
              AND {period_cond_export}
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
        "Завершена", "Смена", "Оператор"
    ])
    for r in data:
        writer.writerow([
            r["id"], r["unique_id"], r["dir"], r["coin"],
            r["sum_rub"], r["amount_coin"], r["rate_rub"],
            r["operator_received_usdt"], r["operator_rate_rub"], r["operator_profit_rub"],
            r["completed_at"], r["shift_id"], r["operator_login"]
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


class CryptoPurchaseCreate(_BaseModel):
    coin: str = "BTC"
    amount_coin: float
    amount_usdt: float
    usdt_rate_rub: float  # RUB per USDT
    note: _Optional[str] = None


@router.get("/orders-detail")
async def get_orders_detail(
    period: str = Query("day", regex="^(day|week|month)$"),
    operator_type: _Optional[str] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Детальная таблица заявок: дата, ID, оператор, поступление, метод оплаты, ЗП оператора, курс монеты, прибыль."""
    period_cond = {
        "day":   "DATE(o.completed_at) = CURDATE()",
        "week":  "DATE(o.completed_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(o.completed_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]

    where = f"o.status = 'COMPLETED' AND {period_cond}"
    params: dict = {}

    if current_user.role == "OPERATOR":
        where += " AND o.support_id = :uid"
        params["uid"] = current_user.id

    # operator_type filter removed — column does not exist in supports table

    # Get current USDT rate for salary calculation
    usdt_row = await db.execute(
        text("SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'")
    )
    usdt_rec = usdt_row.mappings().one_or_none()
    usdt_rate = 0.0
    if usdt_rec:
        usdt_rate = float(
            usdt_rec["manual_rate_rub"]
            if usdt_rec["is_manual"] and usdt_rec["manual_rate_rub"]
            else usdt_rec["rate_rub"]
        )

    try:
        rows = await db.execute(text(f"""
            SELECT
                o.id,
                o.unique_id,
                o.completed_at,
                o.sum_rub,
                o.coin,
                o.rate_rub,
                o.dir,
                CASE
                    WHEN o.exch_sbp_phone IS NOT NULL AND o.exch_sbp_phone != '' THEN 'СБП'
                    WHEN o.exch_card_number IS NOT NULL AND o.exch_card_number != '' THEN 'Карта'
                    WHEN o.exch_crypto_address IS NOT NULL THEN 'Крипта'
                    WHEN o.user_card_number IS NOT NULL AND o.user_card_number != '' THEN 'Карта'
                    ELSE '—'
                END AS payment_method,
                sp.login AS operator_login,
                COALESCE(sp.per_order_rate_usd, 0) AS per_order_rate_usd,
                COALESCE(sp.daily_rate_usd, 0) AS daily_rate_usd,
                o.operator_profit_rub
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE {where}
            ORDER BY o.completed_at DESC
            LIMIT 500
        """), params)
        orders = [dict(r._mapping) for r in rows]
    except Exception as e:
        logger.error(f"orders-detail error: {e}")
        return {"orders": [], "usdt_rate": usdt_rate}

    result = []
    for o in orders:
        per_order_rub = float(o.get("per_order_rate_usd") or 0) * usdt_rate
        sum_rub = float(o.get("sum_rub") or 0)
        profit_rub = sum_rub - per_order_rub
        result.append({
            **o,
            "sum_rub": sum_rub,
            "rate_rub": float(o.get("rate_rub") or 0),
            "operator_salary_rub": round(per_order_rub, 2),
            "profit_rub": round(profit_rub, 2),
            "completed_at": str(o["completed_at"]) if o.get("completed_at") else None,
        })

    return {"orders": result, "usdt_rate": usdt_rate}


@router.get("/purchases")
async def list_crypto_purchases(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Недостаточно прав")
    try:
        rows = await db.execute(text("""
            SELECT * FROM crypto_purchases ORDER BY created_at DESC LIMIT :lim OFFSET :off
        """), {"lim": limit, "off": offset})
        items = [dict(r._mapping) for r in rows]
        total_row = await db.execute(text("SELECT COUNT(*) FROM crypto_purchases"))
        total = total_row.scalar() or 0
    except Exception:
        items = []
        total = 0
    return {"items": items, "total": total}


@router.post("/purchases", status_code=201)
async def add_crypto_purchase(
    body: CryptoPurchaseCreate,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Недостаточно прав")
    if body.amount_coin <= 0 or body.amount_usdt <= 0:
        raise HTTPException(400, "Суммы должны быть > 0")
    if body.usdt_rate_rub <= 0:
        raise HTTPException(400, "Курс USDT должен быть > 0")

    coin_rate_rub = (body.amount_usdt / body.amount_coin) * body.usdt_rate_rub

    try:
        result = await db.execute(text("""
            INSERT INTO crypto_purchases (coin, amount_coin, amount_usdt, usdt_rate_rub, coin_rate_rub, note)
            VALUES (:coin, :amount_coin, :amount_usdt, :usdt_rate_rub, :coin_rate_rub, :note)
        """), {
            "coin": body.coin.upper(),
            "amount_coin": body.amount_coin,
            "amount_usdt": body.amount_usdt,
            "usdt_rate_rub": body.usdt_rate_rub,
            "coin_rate_rub": coin_rate_rub,
            "note": body.note or None,
        })
        await db.commit()
        purchase_id = result.lastrowid
    except Exception as e:
        raise HTTPException(500, f"Ошибка сохранения: {e}")

    return {
        "success": True,
        "id": purchase_id,
        "coin": body.coin.upper(),
        "amount_coin": body.amount_coin,
        "amount_usdt": body.amount_usdt,
        "usdt_rate_rub": body.usdt_rate_rub,
        "coin_rate_rub": round(coin_rate_rub, 2),
        "cost_rub": round(body.amount_usdt * body.usdt_rate_rub, 2),
    }


@router.delete("/purchases/{purchase_id}")
async def delete_crypto_purchase(
    purchase_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != "SUPERADMIN":
        raise HTTPException(403, "Только суперадмин")
    await db.execute(text("DELETE FROM crypto_purchases WHERE id = :id"), {"id": purchase_id})
    await db.commit()
    return {"success": True}


@router.get("/profit-stats")
async def get_profit_stats(
    period: str = Query("day", regex="^(day|week|month)$"),
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Чистая прибыль суперадмина по заявкам.

    Формула для обычного оператора (OPERATOR):
      received_usdt = sum_rub / bb_rate
      net = received_usdt - per_order_fee - shift_salary_per_order - payout_cost_usdt

    Формула для кассира (CASHIER):
      received_usdt = sum_rub * (1 - rate_percent/100) / purchase_usdt_rate
      net = received_usdt - payout_cost_usdt
    """
    if current_user.role not in ("SUPERADMIN", "MANAGER"):
        raise HTTPException(403, "Недостаточно прав")

    period_cond = {
        "day":   "DATE(o.completed_at) = CURDATE()",
        "week":  "DATE(o.completed_at) >= CURDATE() - INTERVAL 6 DAY",
        "month": "DATE(o.completed_at) >= CURDATE() - INTERVAL 29 DAY",
    }[period]

    # BB rate — текущий рыночный курс USDT (RUB за 1 USDT)
    usdt_row = await db.execute(text(
        "SELECT rate_rub, is_manual, manual_rate_rub FROM rates WHERE coin = 'USDT'"
    ))
    usdt_rec = usdt_row.mappings().one_or_none()
    bb_rate = 0.0
    if usdt_rec:
        bb_rate = float(
            usdt_rec["manual_rate_rub"]
            if usdt_rec["is_manual"] and usdt_rec["manual_rate_rub"]
            else usdt_rec["rate_rub"] or 0
        )

    # Закупочные курсы — последняя запись crypto_purchases на каждую монету
    # usdt_per_coin = amount_usdt / amount_coin  (сколько USDT стоит 1 монета по закупу)
    # usdt_rate_rub = курс USDT в RUB на момент закупа (используется кассиром)
    try:
        purch_rows = await db.execute(text("""
            SELECT p.coin,
                   p.amount_usdt / p.amount_coin AS usdt_per_coin,
                   p.usdt_rate_rub,
                   p.coin_rate_rub
            FROM crypto_purchases p
            INNER JOIN (
                SELECT coin, MAX(created_at) AS max_ts
                FROM crypto_purchases
                GROUP BY coin
            ) latest ON latest.coin = p.coin AND latest.max_ts = p.created_at
        """))
        purchase_rates: dict = {r["coin"]: dict(r._mapping) for r in purch_rows.mappings()}
    except Exception:
        purchase_rates = {}

    # Заявки периода (только BUY — клиент платит RUB, получает крипту)
    try:
        orders_rows = await db.execute(text(f"""
            SELECT
                o.id,
                o.unique_id,
                o.coin,
                o.sum_rub,
                o.amount_coin,
                o.completed_at,
                o.shift_id,
                sp.id          AS support_id,
                sp.login       AS support_login,
                COALESCE(sp.role, 'OPERATOR')            AS support_role,
                COALESCE(sp.rate_percent, 0)             AS cashier_fee_pct,
                COALESCE(sp.per_order_rate_usd, 0)       AS per_order_usd,
                COALESCE(sp.daily_rate_usd, 0)           AS daily_rate_usd
            FROM orders o
            LEFT JOIN supports sp ON sp.id = o.support_id
            WHERE o.status = 'COMPLETED'
              AND o.dir = 'BUY'
              AND {period_cond}
            ORDER BY o.completed_at DESC
        """))
        orders = [dict(r._mapping) for r in orders_rows]
    except Exception as exc:
        logger.error(f"profit-stats orders query failed: {exc}")
        orders = []

    # Кол-во заявок в каждой смене (для распределения дневной ставки)
    shift_order_counts: dict[int, int] = {}
    for o in orders:
        sid = o.get("shift_id")
        if sid:
            shift_order_counts[sid] = shift_order_counts.get(sid, 0) + 1

    # Расчёт прибыли по каждой заявке
    result_orders: list[dict] = []
    total_received   = 0.0
    total_payout     = 0.0
    total_op_fees    = 0.0
    total_shift_cost = 0.0
    total_net        = 0.0

    for o in orders:
        coin        = o["coin"]
        sum_rub     = float(o["sum_rub"]    or 0)
        amount_coin = float(o["amount_coin"] or 0)
        role        = o["support_role"]
        cashier_pct = float(o["cashier_fee_pct"] or 0)
        per_order   = float(o["per_order_usd"]  or 0)
        daily_usd   = float(o["daily_rate_usd"] or 0)
        shift_id    = o.get("shift_id")

        purch            = purchase_rates.get(coin, {})
        usdt_per_coin    = float(purch.get("usdt_per_coin")  or 0)
        purch_usdt_rate  = float(purch.get("usdt_rate_rub")  or bb_rate)

        # Стоимость выплаты клиенту (одинакова для всех типов)
        payout_usdt = amount_coin * usdt_per_coin if usdt_per_coin > 0 else 0.0

        if role == "CASHIER":
            # Кассир: сумма за минусом своей комиссии, делённая на курс закупа USDT
            net_rub       = sum_rub * (1.0 - cashier_pct / 100.0)
            received_usdt = net_rub / purch_usdt_rate if purch_usdt_rate > 0 else 0.0
            op_fee_usdt   = 0.0
            shift_usdt    = 0.0
        else:
            # Обычный оператор: конвертируем по BB курсу
            received_usdt = sum_rub / bb_rate if bb_rate > 0 else 0.0
            op_fee_usdt   = per_order
            # Доля дневной ставки на одну заявку
            orders_in_shift = shift_order_counts.get(shift_id, 0) if shift_id else 0
            shift_usdt = daily_usd / orders_in_shift if orders_in_shift > 0 else 0.0

        net_usdt = received_usdt - op_fee_usdt - shift_usdt - payout_usdt

        total_received   += received_usdt
        total_payout     += payout_usdt
        total_op_fees    += op_fee_usdt
        total_shift_cost += shift_usdt
        total_net        += net_usdt

        result_orders.append({
            "order_id":         o["id"],
            "unique_id":        o["unique_id"],
            "coin":             coin,
            "sum_rub":          round(sum_rub, 2),
            "amount_coin":      amount_coin,
            "support_login":    o["support_login"],
            "support_role":     role,
            "bb_rate":          round(bb_rate, 2),
            "purchase_usdt_rate": round(purch_usdt_rate, 2),
            "usdt_per_coin":    round(usdt_per_coin, 4),
            "received_usdt":    round(received_usdt, 4),
            "operator_fee_usdt": round(op_fee_usdt, 4),
            "shift_cost_usdt":  round(shift_usdt, 4),
            "payout_usdt":      round(payout_usdt, 4),
            "net_profit_usdt":  round(net_usdt, 4),
            "completed_at":     str(o["completed_at"]) if o.get("completed_at") else None,
        })

    # Агрегация по операторам
    by_operator: dict[str, dict] = {}
    for r in result_orders:
        key = r["support_login"] or "—"
        if key not in by_operator:
            by_operator[key] = {
                "login":              key,
                "role":               r["support_role"],
                "orders_count":       0,
                "received_usdt":      0.0,
                "payout_usdt":        0.0,
                "operator_fees_usdt": 0.0,
                "shift_cost_usdt":    0.0,
                "net_profit_usdt":    0.0,
            }
        op = by_operator[key]
        op["orders_count"]       += 1
        op["received_usdt"]       = round(op["received_usdt"]      + r["received_usdt"],      4)
        op["payout_usdt"]         = round(op["payout_usdt"]        + r["payout_usdt"],         4)
        op["operator_fees_usdt"]  = round(op["operator_fees_usdt"] + r["operator_fee_usdt"],   4)
        op["shift_cost_usdt"]     = round(op["shift_cost_usdt"]    + r["shift_cost_usdt"],     4)
        op["net_profit_usdt"]     = round(op["net_profit_usdt"]    + r["net_profit_usdt"],     4)

    return {
        "period": period,
        "bb_rate": round(bb_rate, 2),
        "purchase_rates": {
            coin: {
                "usdt_per_coin":   round(float(v.get("usdt_per_coin") or 0), 4),
                "usdt_rate_rub":   round(float(v.get("usdt_rate_rub") or 0), 2),
                "coin_rate_rub":   round(float(v.get("coin_rate_rub") or 0), 2),
            }
            for coin, v in purchase_rates.items()
        },
        "totals": {
            "orders_count":       len(result_orders),
            "received_usdt":      round(total_received,   4),
            "payout_usdt":        round(total_payout,     4),
            "operator_fees_usdt": round(total_op_fees,    4),
            "shift_cost_usdt":    round(total_shift_cost, 4),
            "net_profit_usdt":    round(total_net,        4),
        },
        "by_operator": sorted(
            by_operator.values(),
            key=lambda x: x["net_profit_usdt"],
            reverse=True,
        ),
        "orders": result_orders,
    }
