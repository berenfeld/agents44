import logging

from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from starlette.requests import Request

from app.errors import APIClientError
from app.mcp_server.tools import set_run_context

logger = logging.getLogger(__name__)


def apply_run_context(ctx: Context) -> None:
    request = _request_from_context(ctx)
    if request is None:
        raise ToolError("Agent context required")

    agent_name = request.headers.get("X-Agent-Name", "").strip()
    if not agent_name:
        raise ToolError("Agent context required (missing X-Agent-Name header)")

    set_run_context(
        agent_name,
        request.headers.get("X-Agent-Department", ""),
        int(request.headers.get("X-Run-Id", "0") or 0),
    )


def run_tool(ctx: Context, fn, /, *args, **kwargs):
    from app import get_app

    apply_run_context(ctx)
    app = get_app()
    try:
        with app.app_context():
            return fn(*args, **kwargs)
    except APIClientError as exc:
        raise ToolError(exc.message) from exc
    except ToolError:
        raise
    except Exception as exc:
        logger.exception("MCP tool %s failed", getattr(fn, "__name__", "unknown"))
        raise ToolError("Tool execution failed") from exc


def _request_from_context(ctx: Context) -> Request | None:
    request_context = ctx.request_context
    if request_context is None:
        return None
    request = request_context.request
    if isinstance(request, Request):
        return request
    return None
