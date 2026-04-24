from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.models.support import Support

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Support:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": False},  # node.js tokens without expiry
        )
        user_id = payload.get("id")
        if user_id is None:
            raise CREDENTIALS_EXCEPTION
    except JWTError:
        raise CREDENTIALS_EXCEPTION

    result = await db.execute(select(Support).where(Support.id == int(user_id)))
    support = result.scalar_one_or_none()

    if not support or not support.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive account",
        )

    return support


def require_roles(*roles: str):
    async def checker(current_user: Support = Depends(get_current_user)) -> Support:
        if current_user.role == "SUPERADMIN":
            return current_user
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user
    return checker


require_admin = require_roles("SUPERADMIN")
require_manager = require_roles("MANAGER", "EX_ADMIN", "SUPERADMIN")
require_auth = require_roles("OPERATOR", "CASHIER", "MANAGER", "EX_ADMIN", "SUPERADMIN")



