from sqlalchemy import Column, BigInteger, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class Support(Base):
    __tablename__ = "supports"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    login = Column(String(120), unique=True, nullable=True)
    pass_hash = Column(String(255), nullable=False)
    # MANAGER | OPERATOR | EX_ADMIN | SUPERADMIN
    role = Column(String(12), nullable=True)
    manager_id = Column(BigInteger, nullable=True)        # FK supports.id (self-ref)
    chat_language = Column(String(2), default="RU")       # RU | EN
    can_write_chat = Column(Boolean, default=True)
    can_cancel_order = Column(Boolean, default=True)
    can_edit_requisites = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    active_limit = Column(Integer, default=4)
    rate_percent = Column(Numeric(6, 2), default=0)
    rating = Column(Integer, default=100)
    created_at = Column(DateTime, server_default=func.now())
    deposit = Column(Numeric(14, 2), default=0)
    deposit_paid = Column(Numeric(14, 2), default=0)
    deposit_work = Column(Numeric(14, 2), default=0)
    tg_id = Column(BigInteger, nullable=True)   # Personal Telegram ID (cashier notifications)
    team_id = Column(BigInteger, nullable=True) # FK cashier_teams.id
    daily_rate_usd    = Column(Numeric(10, 2), default=0)
    per_order_rate_usd = Column(Numeric(10, 2), default=0)
    can_use_coupons   = Column(Boolean, default=False)
