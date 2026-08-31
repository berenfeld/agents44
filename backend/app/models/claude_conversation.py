import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.system_agent import SystemAgent

DEFAULT_CONVERSATION_TITLE = "New conversation"
MAX_CONVERSATION_TITLE_LEN = 128


class ClaudeMessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"


class ClaudeMessageStatus(str, enum.Enum):
    pending = "pending"
    complete = "complete"
    failed = "failed"


class SystemClaudeConversation(db.Model):
    __tablename__ = "system_claude_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(
        String(MAX_CONVERSATION_TITLE_LEN), nullable=False, default=DEFAULT_CONVERSATION_TITLE
    )
    agent_id: Mapped[int] = mapped_column(ForeignKey("system_agents.id"), nullable=False, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    agent: Mapped["SystemAgent"] = relationship()
    messages: Mapped[list["SystemClaudeMessage"]] = relationship(
        back_populates="conversation",
        order_by="SystemClaudeMessage.id",
    )

    def to_dict(self, *, include_messages: bool = False, busy: bool | None = None) -> dict:
        if busy is None:
            busy = any(message.status == ClaudeMessageStatus.pending for message in self.messages)
        payload = {
            "id": self.id,
            "title": self.title,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "agent_model": self.agent.model if self.agent else None,
            "agent_enabled": self.agent.enabled if self.agent else False,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "busy": busy,
        }
        if include_messages:
            payload["messages"] = [message.to_dict() for message in self.messages]
        return payload


class SystemClaudeMessage(db.Model):
    __tablename__ = "system_claude_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("system_claude_conversations.id"), nullable=False, index=True
    )
    role: Mapped[ClaudeMessageRole] = mapped_column(
        Enum(ClaudeMessageRole, name="claudemessagerole", values_callable=lambda items: [item.value for item in items]),
        nullable=False,
    )
    status: Mapped[ClaudeMessageStatus] = mapped_column(
        Enum(
            ClaudeMessageStatus,
            name="claudemessagestatus",
            values_callable=lambda items: [item.value for item in items],
        ),
        nullable=False,
        default=ClaudeMessageStatus.complete,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversation: Mapped["SystemClaudeConversation"] = relationship(back_populates="messages")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "role": self.role.value,
            "status": self.status.value,
            "content": self.content,
            "error_message": self.error_message,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "estimated_cost_usd": float(self.estimated_cost_usd) if self.estimated_cost_usd is not None else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }
