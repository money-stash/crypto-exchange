from sqlalchemy import Column, BigInteger, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tg_id = Column(BigInteger, unique=True, nullable=True)
    username = Column(String(64), nullable=True)
    phone = Column(String(32), nullable=True)
    ref_code = Column(String(32), nullable=True)
    has_ref = Column(Boolean, default=False)
    discount_v = Column(Numeric(5, 4), default=0)
    created_at = Column(DateTime, server_default=func.now())
    is_blocked = Column(Boolean, default=False)
    last_activity = Column(DateTime, server_default=func.now(), onupdate=func.now())


class UserBot(Base):
    __tablename__ = "user_bots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False)          # FK users.id
    bot_id = Column(Integer, nullable=False)              # FK bots.id
    tg_id = Column(BigInteger, nullable=False)
    username = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    ref_code = Column(String(50), nullable=True)
    has_ref = Column(Boolean, default=False)
    discount_v = Column(Numeric(5, 4), default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    referral_code = Column(String(20), nullable=True)
    invited_by = Column(BigInteger, nullable=True)        # FK user_bots.id
    referral_level = Column(String(20), default="BASIC")
    referral_bonus_balance = Column(Numeric(15, 2), default=0)
    captcha_passed = Column(Boolean, default=True)
    captcha_passed_at = Column(DateTime, nullable=True)


