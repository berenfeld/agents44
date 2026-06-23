import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

from app.errors import APIClientError

logger = logging.getLogger(__name__)

COMMON_INPUT = "common_input"
DEPARTMENT_INPUT = "input"
DEPARTMENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,127}$")


def workspace_root() -> Path:
    return Path(current_app.config["WORKSPACE_PATH"]).resolve()


def safe_path(relative: str = "") -> Path:
    root = workspace_root()
    rel = relative.strip().lstrip("/")
    target = (root / rel).resolve()
    if not str(target).startswith(str(root)):
        raise APIClientError("Invalid path", 400)
    return target


def validate_department_name(name: str) -> str:
    normalized = name.strip().lower()
    if not DEPARTMENT_NAME_RE.fullmatch(normalized):
        raise APIClientError(
            "Department name must start with a letter and use only lowercase letters, numbers, underscores, or hyphens",
            400,
        )
    return normalized


def ensure_department_folder(department: str) -> None:
    dept_dir = safe_path(department)
    dept_dir.mkdir(parents=True, exist_ok=True)
    (dept_dir / DEPARTMENT_INPUT).mkdir(exist_ok=True)


def ensure_workspace_layout() -> None:
    from app.models import SystemAgent, SystemDepartment

    root = workspace_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / COMMON_INPUT).mkdir(exist_ok=True)
    for dept in SystemDepartment.query.order_by(SystemDepartment.name).all():
        ensure_department_folder(dept.name)
    for agent in SystemAgent.query.order_by(SystemAgent.name).all():
        ensure_agent_folder(agent.name)


RUN_PROMPT_FILE = "prompt.txt"
RUN_LOG_FILE = "log.txt"
RUN_SUMMARY_FILE = "summary.md"
PROMPT_PREVIEW_CHARS = 120


def run_folder_name(started_at: datetime, run_id: int) -> str:
    return f"{started_at.strftime('%Y%m%d-%H%M%S')}-{run_id}"


def agent_run_dir(agent_name: str, started_at: datetime, run_id: int) -> str:
    return f"{agent_name}/.runs/{run_folder_name(started_at, run_id)}"


def ensure_run_folder(agent_name: str, started_at: datetime, run_id: int) -> dict[str, str]:
    run_dir = safe_path(agent_run_dir(agent_name, started_at, run_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    root = workspace_root()
    return {
        "run_dir": str(run_dir.relative_to(root)),
        "prompt_path": str((run_dir / RUN_PROMPT_FILE).relative_to(root)),
        "log_path": str((run_dir / RUN_LOG_FILE).relative_to(root)),
        "summary_path": str((run_dir / RUN_SUMMARY_FILE).relative_to(root)),
    }


def ensure_agent_folder(agent_name: str) -> None:
    agent_dir = safe_path(agent_name)
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / DEPARTMENT_INPUT).mkdir(exist_ok=True)
    (agent_dir / ".runs").mkdir(exist_ok=True)


def _file_stat_fields(path: Path) -> dict:
    if not path.exists() or path.is_dir():
        return {"size_bytes": None, "modified_at": None}
    stat = path.stat()
    return {
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def list_path(path: str = "") -> dict:
    target = safe_path(path)
    if not target.exists():
        raise FileNotFoundError(path)
    if target.is_file():
        content = target.read_text(encoding="utf-8")
        rel = str(target.relative_to(workspace_root()))
        return {"path": rel, "is_dir": False, "content": content, **_file_stat_fields(target)}
    children = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        rel = str(child.relative_to(workspace_root()))
        stat_fields = _file_stat_fields(child) if child.is_file() else {"size_bytes": None, "modified_at": None}
        children.append(
            {
                "path": rel,
                "name": child.name,
                "is_dir": child.is_dir(),
                **stat_fields,
            }
        )
    rel = str(target.relative_to(workspace_root())) if target != workspace_root() else ""
    return {"path": rel, "is_dir": True, "children": children}


def write_file(path: str, content: str) -> dict:
    target = safe_path(path)
    if target.exists() and target.is_dir():
        raise APIClientError("Path is a directory", 400)
    parent = target.parent
    if not str(parent).startswith(str(workspace_root())):
        raise APIClientError("Invalid path", 400)
    if not parent.exists():
        raise APIClientError("Parent directory does not exist", 400)
    target.write_text(content, encoding="utf-8")
    return {"path": str(target.relative_to(workspace_root())), "is_dir": False}


def rename_file(old_path: str, new_path: str) -> dict:
    src = safe_path(old_path)
    dst = safe_path(new_path)
    if not src.exists() or src.is_dir():
        raise APIClientError("Source must be an existing file", 400)
    if dst.exists():
        raise APIClientError("Destination already exists", 400)
    if not str(dst.parent).startswith(str(workspace_root())):
        raise APIClientError("Invalid path", 400)
    if not dst.parent.exists():
        raise APIClientError("Destination parent does not exist", 400)
    src.rename(dst)
    return {"path": str(dst.relative_to(workspace_root())), "is_dir": False}


def delete_file(path: str) -> dict:
    target = safe_path(path)
    if not target.exists() or target.is_dir():
        raise APIClientError("Path must be an existing file", 400)
    target.unlink()
    return {"deleted": path}


def _read_folder_files(relative_dir: str, max_chars: int, used: int) -> tuple[list[str], int]:
    parts: list[str] = []
    folder = safe_path(relative_dir)
    if not folder.exists():
        return parts, used
    for file_path in sorted(folder.rglob("*")):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(workspace_root())
        text = file_path.read_text(encoding="utf-8")
        chunk = f"### {rel}\n{text}\n"
        if used + len(chunk) > max_chars:
            remaining = max_chars - used
            if remaining > 0:
                parts.append(chunk[:remaining])
                used = max_chars
            break
        parts.append(chunk)
        used += len(chunk)
    return parts, used


def read_prompt_inputs(department: str, agent_name: str, max_chars: int = 50000) -> str:
    sections: list[str] = []
    used = 0

    global_parts, used = _read_folder_files(COMMON_INPUT, max_chars, used)
    if global_parts:
        sections.append("# Global common input\n" + "\n".join(global_parts))

    dept_parts, used = _read_folder_files(f"{department}/{DEPARTMENT_INPUT}", max_chars, used)
    if dept_parts:
        sections.append(f"# Department common input ({department})\n" + "\n".join(dept_parts))

    agent_parts, _ = _read_folder_files(f"{agent_name}/{DEPARTMENT_INPUT}", max_chars, used)
    if agent_parts:
        sections.append(f"# Agent input ({agent_name})\n" + "\n".join(agent_parts))

    return "\n\n".join(sections)
