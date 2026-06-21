import logging
import os
import threading
from contextvars import ContextVar

from flask import current_app
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from app.errors import APIClientError
from app.models import SystemAgent
from app.services.db_provisioning import agent_database_url, agent_schema_name, department_schema_name
from app.services.email import send_email
from app.services.workspace import list_path, write_file

logger = logging.getLogger(__name__)

_run_context: ContextVar[dict] = ContextVar("run_context", default={})
_agent_engines: dict[str, Engine] = {}
_engine_lock = threading.Lock()


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


def _require_agent() -> SystemAgent:
    ctx = get_run_context()
    agent_name = ctx.get("agent_name", "").strip()
    if not agent_name:
        raise APIClientError("Agent context required", 403)
    agent = SystemAgent.query.filter_by(name=agent_name).first()
    if not agent:
        raise APIClientError("Agent not found", 404)
    if not agent.db_user or not agent.db_password:
        raise APIClientError("Agent database credentials not configured", 404)
    return agent


def _agent_engine(agent: SystemAgent) -> Engine:
    with _engine_lock:
        cached = _agent_engines.get(agent.name)
        if cached is not None:
            return cached

        url = agent_database_url(
            host=os.getenv("PSQL_HOST", "localhost"),
            port=os.getenv("PSQL_PORT", "5432"),
            database=os.getenv("PSQL_DB", "agents44"),
            db_user=agent.db_user,
            db_password=agent.db_password,
            agent_schema=agent_schema_name(agent.name),
            department_schema=department_schema_name(agent.department),
        )
        engine = create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=0)
        _agent_engines[agent.name] = engine
        return engine


def _execute_agent_sql(query: str, *, commit: bool):
    sql = query.strip()
    if not sql:
        raise APIClientError("Query is required", 400)

    agent = _require_agent()
    conn = _agent_engine(agent).connect()
    try:
        result = conn.execute(text(sql))
        if commit:
            conn.commit()
        if result.returns_rows:
            return [dict(row._mapping) for row in result]
        rowcount = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else 0
        return {"rowcount": rowcount}
    except SQLAlchemyError as exc:
        conn.rollback()
        message = str(exc.orig) if getattr(exc, "orig", None) else str(exc)
        raise APIClientError(message, 400) from exc
    finally:
        conn.close()


def tool_read_db(query: str) -> list[dict]:
    result = _execute_agent_sql(query, commit=False)
    if isinstance(result, list):
        return result
    return []


def tool_write_db(query: str) -> dict:
    result = _execute_agent_sql(query, commit=True)
    if isinstance(result, dict):
        return result
    return {"rowcount": len(result)}


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
