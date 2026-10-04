"""Controlled shell/exec tool scoped to the workspace root."""

from __future__ import annotations

import subprocess
from pathlib import Path

from pydantic_ai import RunContext, Tool

from app.services.agent_runtime.deps import RuntimeDeps

DEFAULT_SHELL_TIMEOUT_SECONDS = 120
MAX_SHELL_OUTPUT_CHARS = 40_000


def _truncate(text: str, limit: int = MAX_SHELL_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n...[truncated {len(text) - limit} chars]"


def run_shell(ctx: RunContext[RuntimeDeps], command: str, timeout_seconds: int = DEFAULT_SHELL_TIMEOUT_SECONDS) -> str:
    """Run a shell command with cwd set to the workspace root.

    Use for python3/playwright/scripts. Do not apt-get. Prefer agent private venvs
    under {department}/{agent_name}/.venv for pip installs.
    """
    deps = ctx.deps
    cwd = Path(deps.cwd)
    if not cwd.is_dir():
        return f"error: workspace cwd does not exist: {cwd}"

    timeout = max(1, min(int(timeout_seconds or DEFAULT_SHELL_TIMEOUT_SECONDS), 600))
    try:
        completed = subprocess.run(
            command,
            shell=True,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=deps.shell_env,
        )
    except subprocess.TimeoutExpired:
        return f"error: command timed out after {timeout}s"
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"

    parts = [f"exit_code={completed.returncode}"]
    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    if stdout:
        parts.append(f"stdout:\n{_truncate(stdout)}")
    if stderr:
        parts.append(f"stderr:\n{_truncate(stderr)}")
    return "\n".join(parts)


def build_shell_tool() -> Tool[RuntimeDeps]:
    return Tool(run_shell, takes_ctx=True, name="run_shell")
