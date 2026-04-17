from sqlalchemy import Column, BigInteger, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func

from app.database import Base


class SupportChat(Base):
    __tablename__ = "support_chats"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False)          # FK users.id
    bot_id = Column(Integer, nullable=False)              # FK bots.id
    last_message_at = Column(DateTime, nullable=True)
    unread_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SupportChatMessage(Base):
    __tablename__ = "support_chat_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    chat_id = Column(BigInteger, nullable=False)          # FK support_chats.id
    sender_type = Column(String(8), nullable=False)       # USER | OPERATOR
    sender_id = Column(BigInteger, nullable=True)
    message = Column(Text, nullable=True)
    attachments_path = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    is_read = Column(Boolean, default=False)
