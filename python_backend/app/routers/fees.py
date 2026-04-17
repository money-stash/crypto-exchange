from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.middleware.auth import require_roles, get_current_user
from app.models.support import Support

router = APIRouter(prefix="/api/fees", tags=["fees"])


@router.get("/")
async def get_fees(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("SELECT * FROM fees ORDER BY id"))
    return [dict(r._mapping) for r in rows.fetchall()]


@router.put("/")
async def update_fees(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Support = Depends(require_roles("SUPERADMIN")),
):
    fees = body.get("fees", [])
    for fee in fees:
        coin = fee.get("coin")
        buy_fee = fee.get("buy_fee", 0)
        sell_fee = fee.get("sell_fee", 0)
        if not coin:
            continue
        await db.execute(text("""
            INSERT INTO fees (coin, buy_fee, sell_fee)
            VALUES (:coin, :buy, :sell)
            ON DUPLICATE KEY UPDATE buy_fee = :buy, sell_fee = :sell
        """), {"coin": coin, "buy": buy_fee, "sell": sell_fee})
    await db.commit()
    rows = await db.execute(text("SELECT * FROM fees ORDER BY id"))
    return [dict(r._mapping) for r in rows.fetchall()]
