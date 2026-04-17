from sqlalchemy import Column, BigInteger, Integer, String, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class OperatorUsdtDebt(Base):
    __tablename__ = "operator_usdt_debts"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    support_id = Column(BigInteger, nullable=False)       # FK supports.id
    order_id = Column(BigInteger, nullable=False, unique=True)  # FK orders.id
    sum_rub_locked = Column(Numeric(20, 2), nullable=False)
    rapira_rate_rub = Column(Numeric(20, 8), nullable=False)
    markup_rub = Column(Numeric(20, 8), default=4)
    usdt_due = Column(Numeric(20, 6), nullable=False)
    usdt_paid = Column(Numeric(20, 6), default=0)
    rub_released = Column(Numeric(20, 2), default=0)
    status = Column(String(15), default="OPEN")           # OPEN | PARTIALLY_PAID | PAID
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OperatorUsdtPaymentIntent(Base):
    __tablename__ = "operator_usdt_payment_intents"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    support_id = Column(BigInteger, nullable=False)       # FK supports.id
    requested_usdt = Column(Numeric(20, 6), nullable=False)
    exact_usdt = Column(Numeric(20, 6), nullable=False)
    company_wallet = Column(String(128), nullable=False)
    status = Column(String(10), default="OPEN")           # OPEN | CONSUMED | EXPIRED | CANCELLED
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    consumed_at = Column(DateTime, nullable=True)


class OperatorUsdtPayment(Base):
    __tablename__ = "operator_usdt_payments"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    support_id = Column(BigInteger, nullable=False)       # FK supports.id
    intent_id = Column(BigInteger, nullable=False)        # FK operator_usdt_payment_intents.id
    tx_hash = Column(String(128), unique=True, nullable=False)
    declared_amount_usdt = Column(Numeric(20, 6), nullable=True)
    actual_amount_usdt = Column(Numeric(20, 6), nullable=True)
    confirmations = Column(Integer, default=0)
    to_address = Column(String(128), nullable=True)
    from_address = Column(String(128), nullable=True)
    status = Column(String(10), default="PENDING")        # PENDING | CONFIRMED | REJECTED
    reject_reason = Column(String(255), nullable=True)
    network = Column(String(5), default="TRC20")
    created_at = Column(DateTime, server_default=func.now())
    confirmed_at = Column(DateTime, nullable=True)


class OperatorUsdtPaymentAllocation(Base):
    __tablename__ = "operator_usdt_payment_allocations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    payment_id = Column(BigInteger, nullable=False)       # FK operator_usdt_payments.id
    debt_id = Column(BigInteger, nullable=False)          # FK operator_usdt_debts.id
    usdt_applied = Column(Numeric(20, 6), nullable=False)
    rub_released = Column(Numeric(20, 2), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
