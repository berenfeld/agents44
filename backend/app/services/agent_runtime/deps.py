from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class RuntimeDeps:
    agent_name: str
    department: str
    run_id: int
    conversation_id: int | None
    cwd: str
    shell_env: dict[str, str]
    on_event: Callable[[str], None] = field(default=lambda _line: None)
    # Wall-clock soft-cancel deadline (time.monotonic). Updated each model turn via instructions.
    started_monotonic: float = 0.0
    soft_cancel_deadline_monotonic: float = 0.0
    require_run_summary: bool = False
