from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
import bcrypt
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.support import Support
from app.schemas.auth import LoginRequest, LoginResponse, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(support: Support) -> str:
    payload = {
        "id": support.id,
        "login": support.login,
        "role": support.role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def support_to_user_out(support: Support) -> UserOut:
    return UserOut(
        id=support.id,
        login=support.login,
        role=support.role,
        manager_id=int(support.manager_id) if support.manager_id else None,
        chat_language=support.chat_language or "RU",
        can_write_chat=int(support.can_write_chat if support.can_write_chat is not None else 1),
        can_cancel_order=int(support.can_cancel_order if support.can_cancel_order is not None else 1),
        can_edit_requisites=int(support.can_edit_requisites if support.can_edit_requisites is not None else 1),
        can_use_coupons=int(support.can_use_coupons if support.can_use_coupons is not None else 0),
        rating=support.rating,
        active_limit=support.active_limit,
        is_active=support.is_active,
    )


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Support).where(Support.login == body.login))
    support = result.scalar_one_or_none()

    if not support or not support.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not verify_password(body.password, support.pass_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return LoginResponse(token=create_token(support), user=support_to_user_out(support))


@router.get("/me", response_model=UserOut)
async def me(
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Свежие данные из БД (роль/флаги могли измениться)
    result = await db.execute(select(Support).where(Support.id == current_user.id))
    support = result.scalar_one_or_none()
    if not support:
        raise HTTPException(status_code=404, detail="User not found")
    return support_to_user_out(support)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    current_user: Support = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Support).where(Support.id == current_user.id))
    support = result.scalar_one_or_none()
    if not support or not support.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not active")
    return TokenResponse(token=create_token(support))



