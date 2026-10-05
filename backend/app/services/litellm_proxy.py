"""Localhost LiteLLM OpenAI-compatible gateway (sidecar, same pattern as MCP).

Uses litellm.acompletion directly rather than the litellm CLI proxy, which currently
hard-imports an experimental MCP server incompatible with mcp 2.x.

Provider API keys and the model allowlist are read from Settings (`system_params`)
on every request — not copied into process env.
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
_flask_app: Flask | None = None


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


def _with_app_context(fn):
    if _flask_app is None:
        raise RuntimeError("LiteLLM gateway has no Flask app")
    with _flask_app.app_context():
        return fn()


def _allowed_model_ids() -> set[str]:
    from app.services.model_registry import normalize_model_id
    from app.services.params import get_supported_models_param

    def _load() -> set[str]:
        return {normalize_model_id(m) for m in get_supported_models_param() if m}

    return _with_app_context(_load)


def _api_key_for_model(model: str) -> tuple[str, str]:
    """Return (settings_key_name, api_key_value) from system_params for this model."""
    from app.services.params import provider_api_key_for_model, provider_key_name_for_model

    def _load() -> tuple[str, str]:
        return provider_key_name_for_model(model), provider_api_key_for_model(model)

    return _with_app_context(_load)


async def _health(_request: Request) -> Response:
    return JSONResponse({"status": "alive"})


def _completion_kwargs(body: dict[str, Any], *, stream: bool, api_key: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": str(body.get("model") or "").strip(),
        "messages": body.get("messages"),
        "stream": stream,
        "drop_params": True,
        "api_key": api_key,
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
        # Gemini / reasoning models: pydantic-ai sends these so thoughts are returned.
        "reasoning_effort",
        "thinking",
        "extra_body",
    ):
        if key in body and body[key] is not None:
            kwargs[key] = body[key]
    # Pydantic AI streams with stream_options.include_usage=True. LiteLLM only emits
    # token usage on the final SSE chunk when that flag is set — without it Gemini
    # (and other providers) complete successfully with empty tokens/cost.
    if stream:
        stream_options = body.get("stream_options")
        if isinstance(stream_options, dict):
            merged = dict(stream_options)
            merged.setdefault("include_usage", True)
            kwargs["stream_options"] = merged
        else:
            kwargs["stream_options"] = {"include_usage": True}
    return kwargs


def _upstream_error_message(exc: BaseException) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    # Keep docker/run logs readable; full traceback is still logged via logger.exception.
    if len(message) > 800:
        return f"{message[:800]}...[truncated]"
    return message


async def _stream_sse(stream: Any, *, model: str) -> AsyncIterator[bytes]:
    try:
        async for chunk in stream:
            payload = _chunk_to_dict(chunk)
            yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"
    except Exception as exc:  # noqa: BLE001
        logger.exception("LiteLLM stream failed mid-flight for model=%s", model)
        err = {"error": {"message": _upstream_error_message(exc), "type": "upstream_error"}}
        yield f"data: {json.dumps(err)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"


async def _chat_completions(request: Request) -> Response:
    if not _authorized(request):
        logger.warning("LiteLLM unauthorized request path=%s", request.url.path)
        return JSONResponse({"error": {"message": "Unauthorized", "type": "auth_error"}}, status_code=401)
    try:
        body: dict[str, Any] = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": {"message": "Invalid JSON body", "type": "invalid_request"}}, status_code=400)

    model = str(body.get("model") or "").strip()
    if not model:
        return JSONResponse({"error": {"message": "model is required", "type": "invalid_request"}}, status_code=400)

    allowed = _allowed_model_ids()
    if allowed and model not in allowed:
        logger.warning("LiteLLM rejected model not allowlisted: %s", model)
        return JSONResponse(
            {"error": {"message": f"Model not allowed: {model}", "type": "invalid_request"}},
            status_code=400,
        )

    key_name, api_key = _api_key_for_model(model)
    if not api_key:
        label = key_name or "provider API key"
        logger.error("LiteLLM missing Settings key %s for model=%s", label, model)
        return JSONResponse(
            {
                "error": {
                    "message": f"{label} is missing in Settings for model {model}",
                    "type": "auth_error",
                }
            },
            status_code=400,
        )

    messages = body.get("messages")
    if not isinstance(messages, list):
        return JSONResponse({"error": {"message": "messages must be a list", "type": "invalid_request"}}, status_code=400)

    stream = bool(body.get("stream") or False)
    tool_count = len(body["tools"]) if isinstance(body.get("tools"), list) else 0
    logger.info(
        "LiteLLM %s model=%s messages=%s tools=%s key=%s",
        "stream" if stream else "completion",
        model,
        len(messages),
        tool_count,
        key_name or "?",
    )

    if stream:
        # Open the upstream stream before returning StreamingResponse so auth/param
        # failures become HTTP 502 JSON (not a dropped socket → opaque "Connection error.").
        kwargs = _completion_kwargs(body, stream=True, api_key=api_key)
        try:
            upstream = await litellm.acompletion(**kwargs)
        except Exception as exc:  # noqa: BLE001
            logger.exception("LiteLLM stream open failed for model=%s", model)
            return JSONResponse(
                {"error": {"message": _upstream_error_message(exc), "type": "upstream_error"}},
                status_code=502,
            )
        return StreamingResponse(
            _stream_sse(upstream, model=model),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    kwargs = _completion_kwargs(body, stream=False, api_key=api_key)
    try:
        result = await litellm.acompletion(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.exception("LiteLLM completion failed for model=%s", model)
        return JSONResponse(
            {"error": {"message": _upstream_error_message(exc), "type": "upstream_error"}},
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
    """Start the localhost LiteLLM gateway. Provider keys are read from Settings (DB)."""
    global _proxy_thread, _proxy_started, _master_key, _flask_app

    _flask_app = app

    with _proxy_lock:
        if _proxy_started and _proxy_thread is not None and _proxy_thread.is_alive():
            app.config["LITELLM_STARTED"] = True
            return

        _master_key = str(app.config["LITELLM_MASTER_KEY"])
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


def any_provider_key_configured(app: Flask | None = None) -> bool:
    from app.services.params import any_provider_api_key_configured

    if app is not None:
        with app.app_context():
            return any_provider_api_key_configured()
    return any_provider_api_key_configured()
