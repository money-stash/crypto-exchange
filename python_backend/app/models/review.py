from sqlalchemy import Column, BigInteger, Integer, String, Text, DateTime, SmallInteger
from sqlalchemy.sql import func

from app.database import Base


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, nullable=False)
    user_raiting = Column(String(1), nullable=True)       # 1 | 2 | 3 | 4 | 5
    created_at = Column(DateTime, server_default=func.now())


class SupportReview(Base):
    __tablename__ = "support_reviews"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    support_id = Column(BigInteger, nullable=False)       # FK supports.id
    user_id = Column(BigInteger, nullable=False)          # FK users.id
    order_id = Column(BigInteger, nullable=True)          # FK orders.id
    rating = Column(SmallInteger, nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
