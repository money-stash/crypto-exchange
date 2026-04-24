from sqlalchemy import Column, BigInteger, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class CashierCard(Base):
    __tablename__ = "cashier_cards"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    cashier_id = Column(BigInteger, nullable=False)       # FK supports.id (role=CASHIER)
    card_number = Column(String(19), nullable=False)
    card_holder = Column(String(255), nullable=True)
    bank_name = Column(String(255), nullable=True)
    min_amount = Column(Numeric(10, 2), default=0)         # min RUB per transaction
    max_amount = Column(Numeric(10, 2), default=999999)    # max RUB per transaction
    total_volume_limit = Column(Numeric(14, 2), default=0) # 0 = unlimited
    current_volume = Column(Numeric(14, 2), default=0)
    interval_minutes = Column(Integer, default=0)          # 0 = no cooldown
    last_used_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    limit_reached_notified = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
