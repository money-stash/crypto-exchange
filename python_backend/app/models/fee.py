from sqlalchemy import Column, BigInteger, Integer, String, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class Fee(Base):
    __tablename__ = "fees"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    coin = Column(String(4), nullable=False)              # BTC | LTC | XMR | USDT
    bot_id = Column(Integer, nullable=True)               # FK bots.id
    buy_fee = Column(Numeric(6, 4), nullable=False)
    sell_fee = Column(Numeric(6, 4), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


    
