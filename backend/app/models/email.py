import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.system_agent import SystemAgent
    from app.models.system_department import SystemDepartment


class EmailSendingStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    fail = "fail"
    canceled = "canceled"


class EmailContentType(str, enum.Enum):
    html = "html"
    plain = "plain"


class SystemEmailConf(db.Model):
    __tablename__ = "system_email_conf"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("system_departments.id"), nullable=False, unique=True, index=True
    )
    email_address: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    app_password: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    department: Mapped["SystemDepartment"] = relationship(back_populates="email_conf")

    def to_public_dict(self) -> dict:
        return {
            "email_address": self.email_address,
            "email_configured": True,
        }


class SystemEmailMessage(db.Model):
    __tablename__ = "system_email_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int | None] = mapped_column(ForeignKey("system_agents.id"), nullable=True, index=True)
    agent_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    from_email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(998), nullable=False, default="")
    recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    cc: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    bcc: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_type: Mapped[EmailContentType] = mapped_column(
        Enum(
            EmailContentType,
            name="emailcontenttype",
            values_callable=lambda items: [item.value for item in items],
        ),
        nullable=False,
        default=EmailContentType.html,
    )
    sending_status: Mapped[EmailSendingStatus] = mapped_column(
        Enum(
            EmailSendingStatus,
            name="emailsendingstatus",
            values_callable=lambda items: [item.value for item in items],
        ),
        nullable=False,
        default=EmailSendingStatus.pending,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    agent: Mapped["SystemAgent | None"] = relationship()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else self.agent_name,
            "department": self.agent.department if self.agent else None,
            "from_email": self.from_email,
            "subject": self.subject,
            "recipients": list(self.recipients or []),
            "cc": list(self.cc or []),
            "bcc": list(self.bcc or []),
            "message": self.message,
            "content_type": self.content_type.value,
            "sending_status": self.sending_status.value,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_attempt_at": self.last_attempt_at.isoformat() if self.last_attempt_at else None,
            "sent_at": self.sent_at.isoformat() if self.sent_at else None,
            "attempt_count": self.attempt_count,
            "error_message": self.error_message,
        }

    def to_agent_dict(self) -> dict:
        payload = self.to_dict()
        payload.pop("agent_name", None)
        payload.pop("department", None)
        return payload
