"""
Coupon / promo-code management.

Access rules:
  SUPERADMIN  — full access, sees all coupons from everyone
  MANAGER / EX_ADMIN / OPERATOR — need can_use_coupons=1 in DB, see own coupons only
  CASHIER     — no access at all
"""
import random
import string
import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.middleware.auth import get_current_user

router = APIRouter(prefix="/api/coupons", tags=["coupons"])


def _assert_access(current_user) -> None:
    role = (current_user.role or "").upper()
    if role == "CASHIER":
        raise HTTPException(403, "Нет доступа к промокодам")
    if role != "SUPERADMIN" and not bool(current_user.can_use_coupons):
        raise HTTPException(403, "Доступ к промокодам не предоставлен администратором")


def _is_superadmin(current_user) -> bool:
    return (current_user.role or "").upper() == "SUPERADMIN"


def _generate_code(brand: str) -> str:
    chars = string.ascii_lowercase + string.digits
    suffix = "".join(random.choices(chars, k=8))
    brand_clean = "".join(c for c in brand.lower() if c.isalnum())[:16] or "promo"
    return f"{brand_clean}${suffix}"


# ── List ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_coupons(current_user=Depends(get_current_user)):
    _assert_access(current_user)
    async with AsyncSessionLocal() as db:
        if _is_superadmin(current_user):
            rows = await db.execute(text("""
                SELECT c.*,
                       s.login            AS creator_login,
                       u.username          AS assigned_username,
                       u.tg_id            AS assigned_tg_id_val
                FROM coupons c
                LEFT JOIN supports s ON s.id = c.created_by_support_id
                LEFT JOIN users u   ON u.id  = c.assigned_user_id
                ORDER BY c.created_at DESC
            """))
        else:
            rows = await db.execute(text("""
                SELECT c.*,
                       s.login            AS creator_login,
                       u.username          AS assigned_username,
                       u.tg_id            AS assigned_tg_id_val
                FROM coupons c
                LEFT JOIN supports s ON s.id = c.created_by_support_id
                LEFT JOIN users u   ON u.id  = c.assigned_user_id
                WHERE c.created_by_support_id = :sid
                ORDER BY c.created_at DESC
            """), {"sid": current_user.id})
        coupons = [dict(r) for r in rows.mappings()]
    return {"coupons": coupons}


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("")
async def create_coupon(body: dict, current_user=Depends(get_current_user)):
    _assert_access(current_user)

    brand = str(body.get("brand") or "promo").strip()
    discount_rub = float(body.get("discount_rub") or 0)
    if discount_rub <= 0:
        raise HTTPException(400, "Скидка должна быть больше 0")
    min_order_rub = float(body.get("min_order_rub") or 0)
    max_uses = int(body.get("max_uses") or 1)
    if max_uses < 0:
        max_uses = 0
    assigned_tg_id = body.get("assigned_tg_id")
    expires_at = body.get("expires_at") or None

    async with AsyncSessionLocal() as db:
        assigned_user_id = None
        if assigned_tg_id:
            row = await db.execute(
                text("SELECT id FROM users WHERE tg_id = :t"),
                {"t": int(assigned_tg_id)},
            )
            u = row.mappings().one_or_none()
            if not u:
                raise HTTPException(404, "Пользователь с таким Telegram ID не найден")
            assigned_user_id = u["id"]

        # Generate unique code
        code = None
        for _ in range(20):
            candidate = _generate_code(brand)
            exists = await db.execute(
                text("SELECT id FROM coupons WHERE code = :c"), {"c": candidate}
            )
            if not exists.fetchone():
                code = candidate
                break
        if not code:
            raise HTTPException(500, "Не удалось сгенерировать уникальный код. Попробуйте снова.")

        await db.execute(text("""
            INSERT INTO coupons
              (code, brand, discount_rub, min_order_rub, max_uses,
               assigned_user_id, assigned_tg_id, created_by_support_id, expires_at)
            VALUES
              (:code, :brand, :discount_rub, :min_order_rub, :max_uses,
               :assigned_user_id, :assigned_tg_id, :created_by, :expires_at)
        """), {
            "code": code,
            "brand": brand,
            "discount_rub": discount_rub,
            "min_order_rub": min_order_rub,
            "max_uses": max_uses,
            "assigned_user_id": assigned_user_id,
            "assigned_tg_id": int(assigned_tg_id) if assigned_tg_id else None,
            "created_by": current_user.id,
            "expires_at": expires_at,
        })
        await db.commit()

        row = await db.execute(text("SELECT * FROM coupons WHERE code = :c"), {"c": code})
        coupon = dict(row.mappings().one())

    return coupon


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{coupon_id}")
async def update_coupon(coupon_id: int, body: dict, current_user=Depends(get_current_user)):
    _assert_access(current_user)
    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT * FROM coupons WHERE id = :id"), {"id": coupon_id})
        coupon = row.mappings().one_or_none()
        if not coupon:
            raise HTTPException(404, "Купон не найден")
        if not _is_superadmin(current_user) and coupon["created_by_support_id"] != current_user.id:
            raise HTTPException(403, "Нет прав на редактирование этого купона")

        fields: dict = {}
        if "discount_rub" in body:
            fields["discount_rub"] = float(body["discount_rub"])
        if "min_order_rub" in body:
            fields["min_order_rub"] = float(body["min_order_rub"])
        if "max_uses" in body:
            fields["max_uses"] = int(body["max_uses"])
        if "is_active" in body:
            fields["is_active"] = int(bool(body["is_active"]))
        if "expires_at" in body:
            fields["expires_at"] = body["expires_at"] or None

        if fields:
            set_clause = ", ".join(f"`{k}` = :{k}" for k in fields)
            fields["id"] = coupon_id
            await db.execute(text(f"UPDATE coupons SET {set_clause} WHERE id = :id"), fields)
            await db.commit()

    return {"ok": True}


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{coupon_id}")
async def delete_coupon(coupon_id: int, current_user=Depends(get_current_user)):
    _assert_access(current_user)
    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT * FROM coupons WHERE id = :id"), {"id": coupon_id})
        coupon = row.mappings().one_or_none()
        if not coupon:
            raise HTTPException(404, "Купон не найден")
        if not _is_superadmin(current_user) and coupon["created_by_support_id"] != current_user.id:
            raise HTTPException(403, "Нет прав на удаление этого купона")
        await db.execute(text("DELETE FROM coupons WHERE id = :id"), {"id": coupon_id})
        await db.commit()
    return {"ok": True}


# ── Validate (used by bot and chat) ───────────────────────────────────────────

@router.post("/validate")
async def validate_coupon(body: dict):
    code = str(body.get("code") or "").strip()
    sum_rub = float(body.get("sum_rub") or 0)
    tg_id = body.get("tg_id")

    if not code:
        raise HTTPException(400, "Укажите код промокода")

    async with AsyncSessionLocal() as db:
        row = await db.execute(text("SELECT * FROM coupons WHERE code = :c"), {"c": code})
        coupon = row.mappings().one_or_none()

    if not coupon:
        raise HTTPException(404, "Промокод не найден")
    if not coupon["is_active"]:
        raise HTTPException(400, "Промокод деактивирован")
    if coupon["expires_at"] and coupon["expires_at"] < datetime.datetime.now():
        raise HTTPException(400, "Срок действия промокода истёк")
    if coupon["max_uses"] > 0 and int(coupon["used_count"]) >= int(coupon["max_uses"]):
        raise HTTPException(400, "Промокод уже использован максимальное количество раз")
    if sum_rub > 0 and float(coupon["min_order_rub"]) > 0 and sum_rub < float(coupon["min_order_rub"]):
        raise HTTPException(
            400,
            f"Минимальная сумма заявки для этого промокода: {float(coupon['min_order_rub']):,.0f} ₽"
        )
    if coupon["assigned_tg_id"] and tg_id:
        if int(coupon["assigned_tg_id"]) != int(tg_id):
            raise HTTPException(400, "Промокод привязан к другому пользователю")

    return {
        "coupon_id": coupon["id"],
        "code": coupon["code"],
        "discount_rub": float(coupon["discount_rub"]),
        "brand": coupon["brand"],
    }


# ── Access management (superadmin only) ──────────────────────────────────────

@router.get("/access-list")
async def get_access_list(current_user=Depends(get_current_user)):
    if not _is_superadmin(current_user):
        raise HTTPException(403, "Только для суперадмина")
    async with AsyncSessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, login, role, can_use_coupons
            FROM supports
            WHERE role NOT IN ('CASHIER', 'SUPERADMIN') AND is_active = 1
            ORDER BY role, login
        """))
        staff = [dict(r) for r in rows.mappings()]
    return {"staff": staff}


@router.patch("/access/{support_id}")
async def set_coupon_access(support_id: int, body: dict, current_user=Depends(get_current_user)):
    if not _is_superadmin(current_user):
        raise HTTPException(403, "Только для суперадмина")
    enabled = int(bool(body.get("can_use_coupons")))
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE supports SET can_use_coupons = :v WHERE id = :id"),
            {"v": enabled, "id": support_id},
        )
        await db.commit()
    return {"ok": True}
