from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class Rate(Base):
    __tablename__ = "rates"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    coin = Column(String(4), unique=True, nullable=False) # BTC | LTC | XMR | USDT
    rate_rub = Column(Numeric(20, 8), nullable=False)
    manual_rate_rub = Column(Numeric(20, 8), nullable=True)
    is_manual = Column(Boolean, default=False)
    src = Column(String(32), nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RateFeeTier(Base):
    __tablename__ = "rate_fee_tiers"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    coin = Column(String(4), nullable=False)              # BTC | LTC | XMR | USDT
    dir = Column(String(4), nullable=False)               # BUY | SELL
    min_amount = Column(Numeric(15, 2), default=0)
    max_amount = Column(Numeric(15, 2), nullable=True)
    fee_percent = Column(Numeric(6, 4), default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
