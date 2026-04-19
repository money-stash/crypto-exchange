"""
Deals router — обработка этапов заявки:
  POST /:id/mark-payment       — клиент/оператор отмечает оплату
  POST /:id/confirm-payment    — оператор подтверждает оплату + вводит финансовые данные
  POST /:id/complete           — завершить заявку
  POST /:id/transaction-hash   — сохранить хэш транзакции
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel
import logging

from app.database import get_db
from app.middleware.auth import require_auth
from app.models.support import Support
import app.socket.socket_service as sio

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/deals", tags=["deals"])

ORDER_SELECT = """
    SELECT
        o.*,
        u.tg_id, u.username AS user_username,
        s.login AS support_login,
        b.name AS bot_name,
        (SELECT COUNT(*) FROM deal_messages dm
         WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') AS unread_messages
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN supports s ON s.id = o.support_id
    LEFT JOIN bots b ON b.id = o.bot_id
"""


async def _get_order(order_id: int, db: AsyncSession) -> dict:
    row = await db.execute(text("SELECT * FROM orders WHERE id = :id"), {"id": order_id})
    order = row.mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    return dict(order)


async def _emit_updated(order_id: int, old_status: str, new_status: str, db: AsyncSession):
    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    order = dict(updated.mappings().one())
    await sio.emit_order_status_changed({
        "orderId": order_id,
        "oldStatus": old_status,
        "newStatus": new_status,
        "order": order,
    })
    return order


# ---------------------------------------------------------------------------
# POST /:id/mark-payment  — оператор переводит заявку в PAYMENT_PENDING
# ---------------------------------------------------------------------------

@router.post("/{order_id}/mark-payment")
async def mark_payment(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]

    if old_status not in ("QUEUED", "PAYMENT_PENDING"):
        raise HTTPException(400, f"Неверный статус: {old_status}")

    # Привязываем к текущей активной смене оператора
    shift_row = await db.execute(
        text("SELECT id FROM operator_shifts WHERE support_id = :uid AND status = 'active' LIMIT 1"),
        {"uid": current_user.id},
    )
    shift = shift_row.fetchone()
    shift_id = shift.id if shift else None

    await db.execute(
        text("UPDATE orders SET status = 'PAYMENT_PENDING', shift_id = :sid, updated_at = NOW() WHERE id = :id"),
        {"id": order_id, "sid": shift_id},
    )
    updated_order = await _emit_updated(order_id, old_status, "PAYMENT_PENDING", db)
    return {"success": True, "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# POST /:id/confirm-payment  — оператор подтверждает оплату + финансовые данные
# ---------------------------------------------------------------------------

class ConfirmPaymentBody(BaseModel):
    received_usdt: Optional[float] = None  # сколько USDT получил оператор


@router.post("/{order_id}/confirm-payment")
async def confirm_payment(
    order_id: int,
    body: Optional[ConfirmPaymentBody] = None,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]
    direction = order.get("dir", "BUY")

    # Валидация статуса
    if direction == "BUY":
        allowed = ("PAYMENT_PENDING", "AWAITING_CONFIRM")
    else:
        allowed = ("AWAITING_CONFIRM",)

    if old_status not in allowed:
        raise HTTPException(
            400,
            f"Неверный статус: {old_status}. Ожидается: {', '.join(allowed)}"
        )

    # Финансовые данные
    received_usdt = (body.received_usdt if body and body.received_usdt else None)
    amount_coin = float(order.get("amount_coin") or 0)
    sum_rub = float(order.get("sum_rub") or 0)
    rate_rub = float(order.get("rate_rub") or 0)

    operator_profit_rub = None
    operator_rate_rub = None

    if received_usdt and received_usdt > 0:
        # Фактический курс = сумма RUB / полученный USDT
        operator_rate_rub = round(sum_rub / received_usdt, 8) if received_usdt else None
        # Прибыль = разница между ожидаемым и фактическим кол-вом USDT × курс клиента
        # SELL: оператор продал крипту, получил received_usdt → должен отдать amount_coin клиенту
        # BUY: клиент заплатил sum_rub, оператор купил received_usdt ≈ amount_coin
        if direction == "SELL":
            # Прибыль = что получили минус что должны были получить, × курс
            operator_profit_rub = round((received_usdt - amount_coin) * rate_rub, 2)
        else:  # BUY
            # Прибыль = что клиент заплатил минус что потратили на покупку
            operator_profit_rub = round(sum_rub - received_usdt * rate_rub, 2)

    # Обновляем заявку
    update_fields = "status = 'AWAITING_HASH', updated_at = NOW()"
    params: dict = {"id": order_id}

    if received_usdt is not None:
        update_fields += ", operator_received_usdt = :received_usdt"
        params["received_usdt"] = received_usdt
    if operator_rate_rub is not None:
        update_fields += ", operator_rate_rub = :op_rate"
        params["op_rate"] = operator_rate_rub
    if operator_profit_rub is not None:
        update_fields += ", operator_profit_rub = :op_profit"
        params["op_profit"] = operator_profit_rub

    # sla_user_paid_at фиксируем если ещё не стоит
    if not order.get("sla_user_paid_at"):
        update_fields += ", sla_user_paid_at = NOW()"

    await db.execute(text(f"UPDATE orders SET {update_fields} WHERE id = :id"), params)
    updated_order = await _emit_updated(order_id, old_status, "AWAITING_HASH", db)

    return {"success": True, "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# POST /:id/transaction-hash
# ---------------------------------------------------------------------------

class HashBody(BaseModel):
    hash: str


@router.post("/{order_id}/transaction-hash")
async def set_transaction_hash(
    order_id: int,
    body: HashBody,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    if order["status"] != "AWAITING_HASH":
        raise HTTPException(400, f"Неверный статус: {order['status']}")

    await db.execute(
        text("UPDATE orders SET hash = :hash, updated_at = NOW() WHERE id = :id"),
        {"hash": body.hash, "id": order_id},
    )
    updated = await db.execute(text(f"{ORDER_SELECT} WHERE o.id = :id"), {"id": order_id})
    updated_order = dict(updated.mappings().one())
    await sio.emit_order_updated(updated_order)
    return {"success": True, "orderDetails": updated_order}


# ---------------------------------------------------------------------------
# POST /:id/complete
# ---------------------------------------------------------------------------

@router.post("/{order_id}/complete")
async def complete_deal(
    order_id: int,
    current_user: Support = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order(order_id, db)
    old_status = order["status"]

    if old_status not in ("AWAITING_HASH", "AWAITING_CONFIRM", "PAYMENT_PENDING"):
        raise HTTPException(400, f"Невозможно завершить заявку со статусом {old_status}")

    await db.execute(
        text("""
            UPDATE orders SET
                status = 'COMPLETED',
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = :id
        """),
        {"id": order_id},
    )

    # Обновляем итоги смены если привязана
    shift_id = order.get("shift_id")
    if shift_id:
        await db.execute(
            text("""
                UPDATE operator_shifts SET
                    orders_completed = orders_completed + 1,
                    total_volume_rub = total_volume_rub + :sum_rub,
                    total_profit_rub = total_profit_rub + COALESCE(:profit, 0)
                WHERE id = :sid
            """),
            {
                "sid": shift_id,
                "sum_rub": float(order.get("sum_rub") or 0),
                "profit": float(order.get("operator_profit_rub") or 0),
            },
        )

    updated_order = await _emit_updated(order_id, old_status, "COMPLETED", db)
    return {"success": True, "orderDetails": updated_order}
