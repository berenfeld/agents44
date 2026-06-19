from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db
from app.models.run_status import RunStatus
from app.models.trigger_source import TriggerSource

if TYPE_CHECKING:
    from app.models.system_agent import SystemAgent


class SystemAgentRun(db.Model):
    __tablename__ = "system_agents_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("system_agents.id"), nullable=False, index=True)
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus), nullable=False, default=RunStatus.pending)
    trigger_source: Mapped[TriggerSource] = mapped_column(Enum(TriggerSource), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    run_dir: Mapped[str | None] = mapped_column(String(512), nullable=True)
    prompt_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    log_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    agent: Mapped["SystemAgent"] = relationship(back_populates="runs")

    def to_dict(self) -> dict:
        prompt_preview = self._read_prompt_preview()
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "status": self.status.value,
            "trigger_source": self.trigger_source.value,
            "model": self.model,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "estimated_cost_usd": float(self.estimated_cost_usd) if self.estimated_cost_usd is not None else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "run_dir": self.run_dir,
            "prompt_path": self.prompt_path,
            "log_path": self.log_path,
            "prompt_preview": prompt_preview,
            "error_message": self.error_message,
        }

    def _read_prompt_preview(self) -> str | None:
        from app.services.workspace import PROMPT_PREVIEW_CHARS, workspace_root

        if not self.prompt_path:
            return None
        prompt_file = workspace_root() / self.prompt_path
        if not prompt_file.exists():
            return None
        text = prompt_file.read_text(encoding="utf-8").strip()
        if not text:
            return ""
        one_line = " ".join(text.split())
        if len(one_line) <= PROMPT_PREVIEW_CHARS:
            return one_line
        return f"{one_line[:PROMPT_PREVIEW_CHARS]}..."
