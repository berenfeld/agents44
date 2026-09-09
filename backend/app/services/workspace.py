import shutil
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

from app.errors import APIClientError
from app.extensions import db
from app.services.db_provisioning import (
    DEPARTMENT_NAME_RE,
    SYSTEM_SCHEMAS,
    create_department_schema,
    refresh_all_cross_grants,
)

COMMON_INPUT = "common_input"
DEPARTMENT_INPUT = "input"
AGENT_MEMORY_FILE = "MEMORY.md"
RESERVED_AGENT_NAMES = frozenset({DEPARTMENT_INPUT, COMMON_INPUT, ".runs", ".venv"})


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
    if normalized in SYSTEM_SCHEMAS:
        raise APIClientError(f"Department name '{normalized}' is reserved", 400)
    safe_path(normalized)
    return normalized


def validate_agent_folder_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise APIClientError("Agent name is required", 400)
    if "/" in normalized or "\\" in normalized:
        raise APIClientError("Agent name cannot contain slashes", 400)
    if normalized in RESERVED_AGENT_NAMES or normalized.lower() in RESERVED_AGENT_NAMES:
        raise APIClientError(f"Agent name '{normalized}' is reserved", 400)
    safe_path(normalized)
    return normalized


def ensure_department_folder(department: str) -> None:
    dept_dir = safe_path(department)
    dept_dir.mkdir(parents=True, exist_ok=True)
    (dept_dir / DEPARTMENT_INPUT).mkdir(exist_ok=True)


def agent_workspace_rel(department: str, agent_name: str) -> str:
    return f"{department}/{agent_name}"


def ensure_workspace_layout() -> None:
    from app.models import SystemAgent, SystemDepartment

    root = workspace_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / COMMON_INPUT).mkdir(exist_ok=True)
    departments = SystemDepartment.query.order_by(SystemDepartment.name).all()
    for dept in departments:
        ensure_department_folder(dept.name)
    for agent in SystemAgent.query.order_by(SystemAgent.name).all():
        ensure_agent_folder(agent.department, agent.name)

    conn = db.session.connection()
    for dept in departments:
        create_department_schema(conn, dept.name)
    refresh_all_cross_grants(conn)
    db.session.commit()


RUN_PROMPT_FILE = "prompt.txt"
RUN_LOG_FILE = "log.txt"
RUN_SUMMARY_FILE = "summary.md"
PROMPT_PREVIEW_CHARS = 120


def run_folder_name(started_at: datetime, run_id: int) -> str:
    return f"{started_at.strftime('%Y%m%d-%H%M%S')}-{run_id}"


def agent_run_dir(department: str, agent_name: str, started_at: datetime, run_id: int) -> str:
    return f"{agent_workspace_rel(department, agent_name)}/.runs/{run_folder_name(started_at, run_id)}"


def ensure_run_folder(department: str, agent_name: str, started_at: datetime, run_id: int) -> dict[str, str]:
    run_dir = safe_path(agent_run_dir(department, agent_name, started_at, run_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    root = workspace_root()
    return {
        "run_dir": str(run_dir.relative_to(root)),
        "prompt_path": str((run_dir / RUN_PROMPT_FILE).relative_to(root)),
        "log_path": str((run_dir / RUN_LOG_FILE).relative_to(root)),
        "summary_path": str((run_dir / RUN_SUMMARY_FILE).relative_to(root)),
    }


def agent_memory_rel(department: str, agent_name: str) -> str:
    return f"{agent_workspace_rel(department, agent_name)}/{DEPARTMENT_INPUT}/{AGENT_MEMORY_FILE}"


def ensure_agent_folder(department: str, agent_name: str) -> None:
    agent_dir = safe_path(agent_workspace_rel(department, agent_name))
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / DEPARTMENT_INPUT).mkdir(exist_ok=True)
    (agent_dir / ".runs").mkdir(exist_ok=True)
    memory = agent_dir / DEPARTMENT_INPUT / AGENT_MEMORY_FILE
    if not memory.exists():
        memory.write_text("", encoding="utf-8")


def protected_path_error(path: str, *, action: str = "delete") -> str | None:
    rel = path.strip().lstrip("/").rstrip("/")
    parts = [part for part in rel.split("/") if part]
    if len(parts) == 2 and parts[1] == DEPARTMENT_INPUT:
        return f"Cannot {action} the input folder"
    if len(parts) == 3 and parts[2] == DEPARTMENT_INPUT:
        return f"Cannot {action} the input folder"
    if len(parts) == 3 and parts[1] == DEPARTMENT_INPUT and parts[2] == AGENT_MEMORY_FILE:
        return f"Cannot {action} MEMORY.md"
    if len(parts) == 4 and parts[2] == DEPARTMENT_INPUT and parts[3] == AGENT_MEMORY_FILE:
        return f"Cannot {action} MEMORY.md"
    return None


def agent_may_write_path(relative: str, *, department: str, agent_name: str) -> bool:
    from app.models import SystemAgent

    rel = relative.strip().lstrip("/")
    if not rel or not department or not agent_name:
        return False
    own_dir = agent_workspace_rel(department, agent_name)
    if rel == own_dir or rel.startswith(f"{own_dir}/"):
        return True
    if rel != department and not rel.startswith(f"{department}/"):
        return False
    rest = rel[len(department) :].lstrip("/")
    first = rest.split("/")[0] if rest else ""
    if not first or first == DEPARTMENT_INPUT or first == agent_name:
        return True
    sibling = SystemAgent.query.filter_by(department=department, name=first).first()
    return sibling is None


def _file_stat_fields(path: Path) -> dict:
    if not path.exists() or path.is_dir():
        return {"size_bytes": None, "modified_at": None}
    stat = path.stat()
    return {
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def workspace_file_path(relative: str) -> Path:
    if not str(relative or "").strip():
        raise APIClientError("path is required", 400)
    target = safe_path(relative)
    if not target.exists():
        raise FileNotFoundError(relative)
    if target.is_dir():
        raise APIClientError("Path is a directory", 400)
    return target


def list_path(path: str = "") -> dict:
    target = safe_path(path)
    if not target.exists():
        raise FileNotFoundError(path)
    if target.is_file():
        rel = str(target.relative_to(workspace_root()))
        payload = {"path": rel, "is_dir": False, **_file_stat_fields(target)}
        if target.suffix.lower() == ".pdf":
            return payload
        try:
            payload["content"] = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            pass
        return payload
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
    blocked = protected_path_error(old_path, action="rename")
    if blocked:
        raise APIClientError(blocked, 400)
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


def delete_path(path: str) -> dict:
    rel_in = path.strip().lstrip("/")
    if not rel_in:
        raise APIClientError("Cannot delete the workspace root", 400)
    blocked = protected_path_error(rel_in, action="delete")
    if blocked:
        raise APIClientError(blocked, 400)
    target = safe_path(rel_in)
    root = workspace_root()
    if target == root:
        raise APIClientError("Cannot delete the workspace root", 400)
    if not target.exists():
        raise APIClientError("Path does not exist", 400)
    rel = str(target.relative_to(root))
    if target.is_dir():
        shutil.rmtree(target)
        return {"deleted": rel, "is_dir": True}
    target.unlink()
    return {"deleted": rel, "is_dir": False}


def _read_folder_files(
    relative_dir: str,
    max_chars: int,
    used: int,
    skip_rels: set[str] | None = None,
) -> tuple[list[str], int]:
    parts: list[str] = []
    folder = safe_path(relative_dir)
    if not folder.exists():
        return parts, used
    skip = skip_rels or set()
    for file_path in sorted(folder.rglob("*")):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(workspace_root())
        if str(rel) in skip:
            continue
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

    agent_parts, _ = _read_folder_files(
        f"{agent_workspace_rel(department, agent_name)}/{DEPARTMENT_INPUT}",
        max_chars,
        used,
        skip_rels={agent_memory_rel(department, agent_name)},
    )
    if agent_parts:
        sections.append(f"# Agent input ({agent_name})\n" + "\n".join(agent_parts))

    return "\n\n".join(sections)


def read_agent_memory(department: str, agent_name: str) -> str:
    target = safe_path(agent_memory_rel(department, agent_name))
    if not target.exists() or not target.is_file():
        return ""
    return target.read_text(encoding="utf-8")


def build_memory_instructions(department: str, agent_name: str) -> str:
    rel = agent_memory_rel(department, agent_name)
    body = read_agent_memory(department, agent_name).strip()
    content = body if body else "(empty)"
    return "\n".join(
        [
            "# Agent memory",
            "",
            f"`{rel}` is automatically included in every prompt for this agent.",
            "Use the `write_memory` tool to update it. Pass the full file contents; the previous file is replaced.",
            "Store only very important standing knowledge you learn and will need on later runs:",
            "identities, conventions, stable IDs, learned pitfalls, and durable decisions.",
            "Do not store secrets, one-off run notes, or large dumps. Keep it short.",
            "This file and the `input` folder cannot be deleted.",
            "",
            f"### {rel}",
            content,
        ]
    )
