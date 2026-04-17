from sqlalchemy import Column, BigInteger, Integer, String, Boolean, Text, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class OperatorManagerMessage(Base):
    __tablename__ = "operator_manager_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    operator_id = Column(BigInteger, nullable=False)      # FK supports.id
    manager_id = Column(BigInteger, nullable=False)       # FK supports.id
    sender_type = Column(String(12), nullable=False)      # OPERATOR | MANAGER | SUPERADMIN
    sender_id = Column(BigInteger, nullable=False)        # FK supports.id
    order_id = Column(BigInteger, nullable=True)          # FK orders.id
    order_unique_id = Column(Integer, nullable=True)
    order_sum_rub = Column(Numeric(20, 2), nullable=True)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    is_read_by_operator = Column(Boolean, default=False)
    is_read_by_manager = Column(Boolean, default=False)


    
