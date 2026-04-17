from sqlalchemy import Column, BigInteger, Integer, String, Text, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class ReferralBonus(Base):
    __tablename__ = "referral_bonuses"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    referrer_userbot_id = Column(BigInteger, nullable=False)  # FK user_bots.id
    referred_userbot_id = Column(BigInteger, nullable=False)  # FK user_bots.id
    order_id = Column(BigInteger, nullable=False)             # FK orders.id
    bot_id = Column(Integer, nullable=False)                  # FK bots.id
    bonus_amount = Column(Numeric(15, 2), nullable=False)
    bonus_percentage = Column(Numeric(5, 4), nullable=False)
    referrer_level = Column(String(20), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class ReferralWithdraw(Base):
    __tablename__ = "referrals_withdraw"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    userbot_id = Column(BigInteger, nullable=False)           # FK user_bots.id
    amount_rub = Column(Numeric(15, 2), nullable=False)
    amount_crypto = Column(Numeric(20, 8), nullable=False)
    currency = Column(String(3), nullable=False)              # BTC | LTC | XMR
    wallet_address = Column(Text, nullable=False)
    status = Column(String(12), default="CREATED")            # CREATED | COMPLETED | CANCELLED
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)
