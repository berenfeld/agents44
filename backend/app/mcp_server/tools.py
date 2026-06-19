import json
import logging
import re
import threading
from contextvars import ContextVar

from flask import current_app
from sqlalchemy import text

from app.errors import APIClientError
from app.extensions import db
from app.services.email import send_email
from app.services.workspace import list_path, safe_path, workspace_root, write_file

logger = logging.getLogger(__name__)

_run_context: ContextVar[dict] = ContextVar("run_context", default={})


def set_run_context(agent_name: str, department: str, run_id: int) -> None:
    _run_context.set({"agent_name": agent_name, "department": department, "run_id": run_id})


def get_run_context() -> dict:
    return _run_context.get()


def tool_read_workspace(path: str = "") -> dict:
    return list_path(path)


def tool_write_workspace(path: str, content: str) -> dict:
    ctx = get_run_context()
    agent_name = ctx.get("agent_name", "")
    department = ctx.get("department", "")
    rel = path.strip().lstrip("/")
    allowed_prefixes = [f"{agent_name}/", f"{department}/"]
    if not any(rel.startswith(prefix) for prefix in allowed_prefixes):
        raise APIClientError("Write not allowed for this path", 403)
    return write_file(rel, content)


def tool_read_db(query: str) -> list[dict]:
    if not query.strip().lower().startswith("select"):
        raise APIClientError("Only SELECT queries are allowed", 403)
    result = db.session.execute(text(query))
    rows = [dict(row._mapping) for row in result]
    return rows


def tool_write_db(query: str) -> dict:
    ctx = get_run_context()
    agent_name = ctx.get("agent_name", "")
    department = ctx.get("department", "")
    lowered = query.strip().lower()
    if not lowered.startswith(("insert", "update", "delete")):
        raise APIClientError("Only INSERT/UPDATE/DELETE allowed", 403)
    table_match = re.search(r"(?:into|update|from)\s+([a-zA-Z0-9_]+)", lowered)
    if not table_match:
        raise APIClientError("Invalid query", 400)
    table = table_match.group(1)
    if not (table.startswith(f"{department}_") or table.startswith(f"{agent_name}_")):
        raise APIClientError("Write not allowed for this table", 403)
    result = db.session.execute(text(query))
    db.session.commit()
    return {"rowcount": result.rowcount}


def tool_send_email(subject: str, body: str) -> dict:
    send_email(subject, body, current_app.config["ADMIN_EMAIL"])
    return {"sent": True, "to": current_app.config["ADMIN_EMAIL"]}


TOOLS = {
    "read_workspace": tool_read_workspace,
    "write_workspace": tool_write_workspace,
    "read_db": tool_read_db,
    "write_db": tool_write_db,
    "send_email": tool_send_email,
}
