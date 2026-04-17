from sqlalchemy import Column, BigInteger, String, DateTime, JSON
from sqlalchemy.sql import func

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    actor = Column(String(64), nullable=True)
    action = Column(String(64), nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
