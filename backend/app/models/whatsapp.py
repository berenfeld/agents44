import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.system_agent import SystemAgent


class WhatsAppMessageDirection(str, enum.Enum):
    inbound = "inbound"
    outbound = "outbound"


class SystemWhatsAppConversation(db.Model):
    __tablename__ = "system_whatsapp_conversations"
    __table_args__ = (
        UniqueConstraint("from_number", "to_number", name="uq_whatsapp_conversations_from_to"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("system_agents.id"), nullable=False, index=True)
    from_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    to_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    agent: Mapped["SystemAgent"] = relationship()
    messages: Mapped[list["SystemWhatsAppMessage"]] = relationship(
        back_populates="conversation",
        order_by="SystemWhatsAppMessage.id",
    )

    def to_list_dict(self, *, last_message_preview: str | None = None) -> dict:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "department": self.agent.department if self.agent else None,
            "from_number": self.from_number,
            "to_number": self.to_number,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_message_preview": last_message_preview,
        }

    def to_detail_dict(self) -> dict:
        payload = self.to_list_dict()
        payload["messages"] = [message.to_dict() for message in self.messages]
        return payload

    def to_agent_dict(self) -> dict:
        return {
            "id": self.id,
            "from_number": self.from_number,
            "to_number": self.to_number,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "messages": [message.to_dict() for message in self.messages],
        }


class SystemWhatsAppMessage(db.Model):
    __tablename__ = "system_whatsapp_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("system_whatsapp_conversations.id"), nullable=False, index=True
    )
    direction: Mapped[WhatsAppMessageDirection] = mapped_column(
        Enum(
            WhatsAppMessageDirection,
            name="whatsappmessagedirection",
            values_callable=lambda items: [item.value for item in items],
        ),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    wati_message_id: Mapped[str | None] = mapped_column(String(256), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped["SystemWhatsAppConversation"] = relationship(back_populates="messages")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "direction": self.direction.value,
            "body": self.body,
            "wati_message_id": self.wati_message_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
