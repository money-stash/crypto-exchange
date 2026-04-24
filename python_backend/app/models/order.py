from sqlalchemy import Column, BigInteger, Integer, String, Boolean, Text, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    unique_id = Column(Integer, unique=True, nullable=True)
    user_id = Column(BigInteger, nullable=False)          # FK users.id
    bot_id = Column(Integer, nullable=True)               # FK bots.id
    dir = Column(String(4), nullable=False)               # BUY | SELL
    coin = Column(String(4), nullable=False)              # BTC | LTC | XMR | USDT
    amount_coin = Column(Numeric(30, 10), nullable=False)
    rate_rub = Column(Numeric(20, 8), nullable=False)
    fee = Column(Numeric(6, 4), nullable=False)
    ref_percent = Column(Numeric(5, 4), default=0)
    user_discount = Column(Numeric(5, 4), default=0)
    sum_rub = Column(Numeric(20, 2), nullable=False)
    # CREATED | AWAITING_CONFIRM | QUEUED | PAYMENT_PENDING | COMPLETED | CANCELLED | AWAITING_HASH
    status = Column(String(20), default="CREATED")
    req_id = Column(BigInteger, nullable=True)
    user_requisite_id = Column(BigInteger, nullable=True) # FK requisites.id
    user_card_number = Column(String(19), nullable=True)
    user_card_holder = Column(String(255), nullable=True)
    user_bank_name = Column(String(255), nullable=True)
    user_crypto_address = Column(String(255), nullable=True)
    exch_card_number = Column(String(19), nullable=True)
    exch_card_holder = Column(String(255), nullable=True)
    exch_bank_name = Column(String(255), nullable=True)
    exch_crypto_address = Column(String(255), nullable=True)
    exch_sbp_phone = Column(String(20), nullable=True)
    exch_req_id = Column(BigInteger, nullable=True)
    cashier_card_id = Column(BigInteger, nullable=True)    # FK cashier_cards.id (auto-payout)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    user_bot_id = Column(Integer, nullable=True)
    support_id = Column(BigInteger, nullable=True)        # FK supports.id
    support_note = Column(String(255), nullable=True)
    hash = Column(Text, nullable=True)
    receipt_path = Column(String(512), nullable=True)
    sla_started_at = Column(DateTime, nullable=True)
    sla_requisites_setup_at = Column(DateTime, nullable=True)
    sla_user_paid_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    complaint_count = Column(Integer, default=0)


class DealMessage(Base):
    __tablename__ = "deal_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_id = Column(BigInteger, nullable=False)         # FK orders.id
    sender_type = Column(String(8), nullable=False)       # USER | OPERATOR
    sender_id = Column(BigInteger, nullable=True)
    message = Column(Text, nullable=True)
    original_message = Column(Text, nullable=True)
    translated_message = Column(Text, nullable=True)
    source_lang = Column(String(8), nullable=True)
    translated_at = Column(DateTime, nullable=True)
    attachments_path = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    is_read = Column(Boolean, default=False)


class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_id = Column(BigInteger, nullable=False)         # FK orders.id
    reason = Column(String(255), nullable=True)
    justified = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class OrderServiceMessage(Base):
    __tablename__ = "order_service_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    order_id = Column(BigInteger, nullable=False)         # FK orders.id
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
