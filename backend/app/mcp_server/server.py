import asyncio
import logging
import threading

import uvicorn
from mcp.server.fastmcp import Context, FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.mcp_server.context import run_tool
from app.mcp_server.tools import (
    tool_read_db,
    tool_read_workspace,
    tool_send_email,
    tool_write_db,
    tool_write_workspace,
)

logger = logging.getLogger(__name__)

_mcp_thread: threading.Thread | None = None
_mcp_started = False
_mcp_instance: FastMCP | None = None
_mcp_port: int | None = None


def _build_mcp_server(port: int) -> FastMCP:
    global _mcp_instance, _mcp_port
    if _mcp_instance is not None and _mcp_port == port:
        return _mcp_instance

    mcp = FastMCP(
        "agents44",
        instructions="Agents44 platform tools for workspace files, PostgreSQL, and email.",
        host="127.0.0.1",
        port=port,
        sse_path="/sse",
        message_path="/messages/",
    )

    @mcp.custom_route("/health", methods=["GET"])
    async def health_check(request: Request) -> Response:
        return JSONResponse({"ok": True})

    @mcp.tool(
        description="List files and folders under a workspace path relative to the workspace root.",
    )
    def read_workspace(path: str = "", ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_read_workspace, path)

    @mcp.tool(
        description="Write a file under the agent or department workspace prefix.",
    )
    def write_workspace(path: str, content: str, ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_write_workspace, path, content)

    @mcp.tool(
        description="Run a read-only SQL query against the agent database connection.",
    )
    def read_db(query: str, ctx: Context = ...) -> list[dict]:
        return run_tool(ctx, tool_read_db, query)

    @mcp.tool(
        description="Run a SQL statement that changes data or schema. Commits automatically.",
    )
    def write_db(query: str, ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_write_db, query)

    @mcp.tool(
        description="Send an email to the platform administrator.",
    )
    def send_email(subject: str, body: str, ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_send_email, subject, body)

    _mcp_instance = mcp
    _mcp_port = port
    return mcp


def start_mcp_server(app, port: int) -> None:
    global _mcp_thread, _mcp_started

    if _mcp_started and _mcp_thread and _mcp_thread.is_alive():
        return

    def _run() -> None:
        global _mcp_started
        mcp = _build_mcp_server(port)
        starlette_app = mcp.sse_app()
        config = uvicorn.Config(
            starlette_app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            access_log=False,
        )
        server = uvicorn.Server(config)
        try:
            logger.info("MCP server listening on 127.0.0.1:%s (SSE /sse)", port)
            _mcp_started = True
            asyncio.run(server.serve())
        except OSError as exc:
            if exc.errno == 98:
                logger.warning("MCP server port %s already in use; reusing existing listener", port)
                _mcp_started = True
                return
            raise

    _mcp_thread = threading.Thread(target=_run, daemon=True, name="mcp-server")
    _mcp_thread.start()
