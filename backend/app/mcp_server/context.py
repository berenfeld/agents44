import logging

from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ToolError

from app.errors import APIClientError
from app.mcp_server.tools import set_run_context

logger = logging.getLogger(__name__)


def apply_run_context(ctx: Context) -> None:
    headers = ctx.headers or {}
    # Starlette headers are case-insensitive; normalize for lookup.
    lowered = {str(k).lower(): str(v) for k, v in headers.items()}
    agent_name = (lowered.get("x-agent-name") or "").strip()
    if not agent_name:
        raise ToolError("Agent context required (missing X-Agent-Name header)")

    set_run_context(
        agent_name,
        (lowered.get("x-agent-department") or "").strip(),
        int(lowered.get("x-run-id") or "0"),
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
