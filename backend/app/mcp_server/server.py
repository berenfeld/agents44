import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.mcp_server.tools import TOOLS, set_run_context

logger = logging.getLogger(__name__)

MCP_TOOL_ERROR = "Tool execution failed"


class ReuseAddrHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class MCPHandler(BaseHTTPRequestHandler):
    server_version = "Agents44MCP/1.0"

    def log_message(self, format, *args):
        logger.debug("MCP %s - %s", self.address_string(), format % args)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def _set_context_from_headers(self):
        set_run_context(
            self.headers.get("X-Agent-Name", ""),
            self.headers.get("X-Agent-Department", ""),
            int(self.headers.get("X-Run-Id", "0") or 0),
        )

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/sse"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"data: {\"status\":\"ready\"}\n\n")
            return
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        self._set_context_from_headers()
        if self.path == "/tools/call":
            payload = self._read_json()
            tool_name = payload.get("name")
            arguments = payload.get("arguments", {})
            tool = TOOLS.get(tool_name)
            if not tool:
                self._send_json(404, {"error": "Unknown tool"})
                return
            from app import get_app
            from app.errors import APIClientError

            app = get_app()
            with app.app_context():
                try:
                    result = tool(**arguments)
                except APIClientError as exc:
                    self._send_json(exc.status_code, {"error": exc.message})
                    return
                except Exception:
                    logger.exception("MCP tool %s failed", tool_name)
                    self._send_json(500, {"error": MCP_TOOL_ERROR})
                    return
            self._send_json(200, {"result": result})
            return
        if self.path == "/tools/list":
            self._send_json(
                200,
                {
                    "tools": [
                        {"name": "read_workspace", "arguments": ["path"]},
                        {"name": "write_workspace", "arguments": ["path", "content"]},
                        {"name": "read_db", "arguments": ["query"]},
                        {"name": "write_db", "arguments": ["query"]},
                        {"name": "send_email", "arguments": ["subject", "body"]},
                    ]
                },
            )
            return
        self._send_json(404, {"error": "Not found"})


_mcp_thread = None
_mcp_started = False


def start_mcp_server(app, port: int) -> None:
    global _mcp_thread, _mcp_started

    if _mcp_started and _mcp_thread and _mcp_thread.is_alive():
        return

    def _run():
        global _mcp_started
        try:
            server = ReuseAddrHTTPServer(("127.0.0.1", port), MCPHandler)
        except OSError as exc:
            if exc.errno == 98:
                logger.warning("MCP server port %s already in use; reusing existing listener", port)
                _mcp_started = True
                return
            raise
        logger.info("MCP server listening on 127.0.0.1:%s", port)
        _mcp_started = True
        server.serve_forever()

    _mcp_thread = threading.Thread(target=_run, daemon=True, name="mcp-server")
    _mcp_thread.start()
