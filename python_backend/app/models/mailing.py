from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Mailing(Base):
    __tablename__ = "mailings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    status = Column(String(6), default="active")          # end | active | cancel
    bot_id = Column(Integer, nullable=False)              # FK bots.id
    text = Column(Text, nullable=False)
    total_count = Column(Integer, nullable=False)
    send_count = Column(Integer, default=0)
    error_send_count = Column(Integer, default=0)
    attachments = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    end_at = Column(DateTime, nullable=True)
