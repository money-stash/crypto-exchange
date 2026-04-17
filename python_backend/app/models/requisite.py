from sqlalchemy import Column, BigInteger, Integer, String, Boolean, DateTime, LargeBinary
from sqlalchemy.sql import func

from app.database import Base


class Requisite(Base):
    __tablename__ = "requisites"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False)          # FK users.id
    kind = Column(String(4), nullable=False)              # CARD | BTC | LTC | XMR | USDT
    value_cipher = Column(LargeBinary(1024), nullable=False)  # AES-encrypted value
    created_at = Column(DateTime, server_default=func.now())
    transaction_type = Column(String(4), nullable=False)  # BUY | SELL
    label = Column(String(64), nullable=True)
    is_display = Column(Boolean, default=True)
    bot_id = Column(Integer, nullable=True)               # FK bots.id
