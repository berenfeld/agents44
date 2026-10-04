"""Localhost LiteLLM OpenAI-compatible gateway (sidecar, same pattern as MCP).

Uses litellm.acompletion directly rather than the litellm CLI proxy, which currently
hard-imports an experimental MCP server incompatible with mcp 2.x.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, AsyncIterator

import litellm
import requests
import uvicorn
from flask import Flask
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

logger = logging.getLogger(__name__)

_proxy_thread: threading.Thread | None = None
_proxy_started = False
_proxy_lock = threading.Lock()
_master_key: str = ""
_allowed_models: set[str] = set()


def litellm_base_url(app: Flask | None = None) -> str:
    from flask import current_app

    cfg = app or current_app
    port = int(cfg.config["LITELLM_PROXY_PORT"])
    return f"http://127.0.0.1:{port}"


def _authorized(request: Request) -> bool:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        return token == _master_key
    api_key = request.headers.get("x-api-key") or ""
    return api_key == _master_key


def _chunk_to_dict(chunk: Any) -> dict[str, Any]:
    if hasattr(chunk, "model_dump"):
        return chunk.model_dump()
    if isinstance(chunk, dict):
        return chunk
    return dict(chunk)


async def _health(_request: Request) -> Response:
    return JSONResponse({"status": "alive"})


def _completion_kwargs(body: dict[str, Any], *, stream: bool) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": str(body.get("model") or "").strip(),
        "messages": body.get("messages"),
        "stream": stream,
        "drop_params": True,
    }
    for key in (
        "temperature",
        "top_p",
        "max_tokens",
        "max_completion_tokens",
        "tools",
        "tool_choice",
        "response_format",
        "stop",
        "user",
        "n",
        "presence_penalty",
        "frequency_penalty",
        "seed",
    ):
        if key in body and body[key] is not None:
            kwargs[key] = body[key]
    return kwargs


async def _stream_sse(body: dict[str, Any]) -> AsyncIterator[bytes]:
    kwargs = _completion_kwargs(body, stream=True)
    stream = await litellm.acompletion(**kwargs)
    try:
        async for chunk in stream:
            payload = _chunk_to_dict(chunk)
            yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"
    except Exception as exc:  # noqa: BLE001
        logger.exception("LiteLLM stream failed for model=%s", kwargs.get("model"))
        err = {"error": {"message": str(exc), "type": "upstream_error"}}
        yield f"data: {json.dumps(err)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"


async def _chat_completions(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"error": {"message": "Unauthorized", "type": "auth_error"}}, status_code=401)
    try:
        body: dict[str, Any] = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": {"message": "Invalid JSON body", "type": "invalid_request"}}, status_code=400)

    model = str(body.get("model") or "").strip()
    if not model:
        return JSONResponse({"error": {"message": "model is required", "type": "invalid_request"}}, status_code=400)
    if _allowed_models and model not in _allowed_models:
        return JSONResponse(
            {"error": {"message": f"Model not allowed: {model}", "type": "invalid_request"}},
            status_code=400,
        )

    messages = body.get("messages")
    if not isinstance(messages, list):
        return JSONResponse({"error": {"message": "messages must be a list", "type": "invalid_request"}}, status_code=400)

    stream = bool(body.get("stream") or False)
    if stream:
        return StreamingResponse(
            _stream_sse(body),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    kwargs = _completion_kwargs(body, stream=False)
    try:
        result = await litellm.acompletion(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.exception("LiteLLM completion failed for model=%s", model)
        return JSONResponse(
            {"error": {"message": str(exc), "type": "upstream_error"}},
            status_code=502,
        )
    return JSONResponse(_chunk_to_dict(result))


def _build_app() -> Starlette:
    return Starlette(
        routes=[
            Route("/health", _health, methods=["GET"]),
            Route("/health/liveliness", _health, methods=["GET"]),
            Route("/health/readiness", _health, methods=["GET"]),
            Route("/v1/chat/completions", _chat_completions, methods=["POST"]),
            Route("/chat/completions", _chat_completions, methods=["POST"]),
        ]
    )


def wait_for_litellm(app: Flask, *, timeout_seconds: float = 30.0) -> None:
    url = f"{litellm_base_url(app)}/health/liveliness"
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            response = requests.get(url, timeout=2)
            if response.ok:
                return
        except Exception as exc:  # noqa: BLE001 — probe until ready
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"LiteLLM gateway did not become ready: {last_error}")


def start_litellm_proxy(app: Flask) -> None:
    """Start the localhost LiteLLM gateway. Provider keys come from Settings."""
    global _proxy_thread, _proxy_started, _master_key, _allowed_models
    from app.services.params import apply_provider_keys_to_process_env

    with app.app_context():
        apply_provider_keys_to_process_env()

    with _proxy_lock:
        if _proxy_started and _proxy_thread is not None and _proxy_thread.is_alive():
            app.config["LITELLM_STARTED"] = True
            return

        _master_key = str(app.config["LITELLM_MASTER_KEY"])
        _allowed_models = set(app.config.get("SUPPORTED_MODELS_CONFIG") or [])
        port = int(app.config["LITELLM_PROXY_PORT"])
        starlette_app = _build_app()

        def _run() -> None:
            global _proxy_started
            config = uvicorn.Config(
                starlette_app,
                host="127.0.0.1",
                port=port,
                log_level="info",
                access_log=False,
            )
            server = uvicorn.Server(config)
            try:
                logger.info("LiteLLM gateway listening on 127.0.0.1:%s", port)
                _proxy_started = True
                asyncio.run(server.serve())
            except OSError as exc:
                if exc.errno == 98:
                    logger.warning("LiteLLM gateway port %s already in use; reusing existing listener", port)
                    _proxy_started = True
                    return
                raise

        _proxy_thread = threading.Thread(target=_run, daemon=True, name="litellm-gateway")
        _proxy_thread.start()
        app.config["LITELLM_STARTED"] = True

    wait_for_litellm(app)
    logger.info("LiteLLM gateway is ready on %s", litellm_base_url(app))


def refresh_provider_keys(app: Flask | None = None) -> None:
    """Reload Settings API keys into process env (call after Settings save)."""
    from app.services.params import apply_provider_keys_to_process_env

    if app is not None:
        with app.app_context():
            keys = apply_provider_keys_to_process_env()
    else:
        keys = apply_provider_keys_to_process_env()
    logger.info(
        "LiteLLM provider keys refreshed from Settings (%s configured)",
        ", ".join(sorted(k for k, v in keys.items() if v)) or "none",
    )


def any_provider_key_configured(app: Flask | None = None) -> bool:
    from app.services.params import any_provider_api_key_configured

    if app is not None:
        with app.app_context():
            return any_provider_api_key_configured()
    return any_provider_api_key_configured()
