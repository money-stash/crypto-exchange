from sqlalchemy import Column, BigInteger, Integer, String, Boolean, Text, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class Bot(Base):
    __tablename__ = "bots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    identifier = Column(String(50), unique=True, nullable=False)
    token = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    exchange_chat_link = Column(String(255), nullable=True)
    reviews_chat_link = Column(String(255), nullable=True)
    reviews_chat_id = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    owner_id = Column(BigInteger, nullable=True)          # FK supports.id
    start_message = Column(Text, nullable=True)
    contacts_message = Column(Text, nullable=True)


class BotRequisite(Base):
    __tablename__ = "bot_requisites"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    bot_id = Column(Integer, nullable=False)              # FK bots.id
    support_id = Column(BigInteger, nullable=True)        # FK supports.id
    # CARD | SBP | CRYPTO | BTC | XMR | LTC | USDT
    type = Column(String(6), nullable=False)
    address = Column(Text, nullable=False)
    bank_name = Column(String(100), nullable=True)
    holder_name = Column(String(100), nullable=True)
    label = Column(String(256), nullable=True)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class BotFeeTier(Base):
    __tablename__ = "bot_fee_tiers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bot_id = Column(Integer, nullable=False)              # FK bots.id
    coin = Column(String(4), nullable=False)              # BTC | LTC | XMR | USDT
    min_amount = Column(Numeric(15, 2), default=0)
    max_amount = Column(Numeric(15, 2), nullable=True)
    buy_fee = Column(Numeric(6, 4), default=0)
    sell_fee = Column(Numeric(6, 4), default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    
