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
