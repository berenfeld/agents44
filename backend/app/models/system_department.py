from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.email import SystemEmailConf


class SystemDepartment(db.Model):
    __tablename__ = "system_departments"
    __table_args__ = (
        Index(
            "uq_system_departments_whatsapp_from_number",
            "whatsapp_from_number",
            unique=True,
            postgresql_where=text("whatsapp_from_number IS NOT NULL"),
        ),
        Index(
            "uq_system_departments_wati_webhook_secret",
            "wati_webhook_secret",
            unique=True,
            postgresql_where=text("wati_webhook_secret IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    whatsapp_from_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    wati_api_endpoint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    wati_api_token: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    wati_webhook_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)

    email_conf: Mapped["SystemEmailConf | None"] = relationship(
        "SystemEmailConf",
        back_populates="department",
        uselist=False,
        cascade="all, delete-orphan",
    )

    def wati_configured(self) -> bool:
        return bool(
            self.whatsapp_from_number
            and self.wati_api_endpoint
            and self.wati_api_token
            and self.wati_webhook_secret
        )

    def to_dict(self, *, webhook_url: str | None = None) -> dict:
        payload = {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "whatsapp_from_number": self.whatsapp_from_number,
            "wati_configured": self.wati_configured(),
            "email_address": self.email_conf.email_address if self.email_conf else None,
            "email_configured": bool(self.email_conf),
        }
        if webhook_url is not None:
            payload["wati_webhook_url"] = webhook_url
        return payload
