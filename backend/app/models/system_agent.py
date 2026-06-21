from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.system_agent_run import SystemAgentRun


class SystemAgent(db.Model):
    __tablename__ = "system_agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    department: Mapped[str] = mapped_column(
        String(128), ForeignKey("system_departments.name"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    crond: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    db_user: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    db_password: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    runs: Mapped[list["SystemAgentRun"]] = relationship(back_populates="agent")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "department": self.department,
            "model": self.model,
            "crond": self.crond,
            "enabled": self.enabled,
            "timeout_seconds": self.timeout_seconds,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
