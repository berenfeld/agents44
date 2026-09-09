import asyncio
import logging
import threading

import uvicorn
from mcp.server.fastmcp import Context, FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.mcp_server.context import run_tool
from app.mcp_server.tools import (
    tool_list_whatsapp_conversations,
    tool_read_db,
    tool_read_workspace,
    tool_send_email,
    tool_send_whatsapp,
    tool_write_db,
    tool_write_memory,
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
        instructions="Agents44 platform tools for workspace files, agent memory, PostgreSQL, email, and WhatsApp.",
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
        description=(
            "Replace this agent's persistent memory file at input/MEMORY.md. "
            "That file is automatically added to every prompt. "
            "Write only very important facts you learn and will need on every later run "
            "(identities, conventions, stable IDs, learned pitfalls, durable decisions). "
            "Pass the full file contents; this overwrites previous memory. "
            "Do not store secrets, one-off notes, or large dumps. Keep it short. "
            "MEMORY.md and the input folder cannot be deleted."
        ),
    )
    def write_memory(content: str, ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_write_memory, content)

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

    @mcp.tool(
        description=(
            "Send a WhatsApp session message from this department's provisioned number. "
            "Fails if the department is not provisioned for WhatsApp. "
            "Pass the client number in to_number (Israeli 05X... or international digits with country code) "
            "and the full message in message_text. "
            "To include a website link, put the full URL in message_text with the scheme, "
            "for example https://example.com/path. Put each URL on its own line after a short sentence. "
            "Do not use Markdown ([label](url)), HTML <a> tags, or a bare domain without https:// — "
            "WhatsApp will not turn those into tappable links. "
            "Website http/https links only; this tool does not send media or WhatsApp deep links."
        ),
    )
    def send_whatsapp(to_number: str, message_text: str, ctx: Context = ...) -> dict:
        return run_tool(ctx, tool_send_whatsapp, to_number, message_text)

    @mcp.tool(
        description=(
            "List this agent's WhatsApp conversations and their messages, oldest message first. "
            "Only conversations owned by this agent are returned. "
            "Use this to catch up after a WhatsApp trigger and before sending a reply."
        ),
    )
    def list_whatsapp_conversations(ctx: Context = ...) -> list[dict]:
        return run_tool(ctx, tool_list_whatsapp_conversations)

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
