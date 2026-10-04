"""AgentRuntime — Pydantic AI loop over LiteLLM + MCP + shell."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable

from flask import current_app
from pydantic_ai import Agent, CancellationToken
from pydantic_ai.mcp import MCPToolset

from app.services.agent_runtime.deps import RuntimeDeps
from app.services.agent_runtime.gateway import LlmGateway
from app.services.agent_runtime.shell_tool import build_shell_tool
from app.services.model_registry import estimate_cost, normalize_model_id

logger = logging.getLogger(__name__)


def _mcp_sse_url() -> str:
    port = int(current_app.config["MCP_PORT"])
    return f"http://127.0.0.1:{port}/sse"


@dataclass(frozen=True)
class AgentRuntimeResult:
    output: str
    tokens_in: int | None
    tokens_out: int | None
    estimated_cost_usd: float | None
    duration_seconds: float
    cancelled: bool
    timed_out: bool
    error: str | None
    transcript: str


class ActiveRunHandle:
    """Cancelable handle registered while a runtime call is in progress."""

    def __init__(self) -> None:
        self._token = CancellationToken()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._loop = loop

    @property
    def cancellation_token(self) -> CancellationToken:
        return self._token

    def cancel(self) -> None:
        with self._lock:
            loop = self._loop
            token = self._token
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(token.cancel)
        else:
            token.cancel()


_active_handles: dict[str, ActiveRunHandle] = {}
_active_handles_lock = threading.Lock()


def register_active_handle(key: str, handle: ActiveRunHandle) -> None:
    with _active_handles_lock:
        _active_handles[key] = handle


def unregister_active_handle(key: str) -> None:
    with _active_handles_lock:
        _active_handles.pop(key, None)


def get_active_handle(key: str) -> ActiveRunHandle | None:
    with _active_handles_lock:
        return _active_handles.get(key)


def cancel_active_handle(key: str) -> bool:
    handle = get_active_handle(key)
    if handle is None:
        return False
    handle.cancel()
    return True


def _format_event(event: object) -> str | None:
    name = type(event).__name__
    if name == "FunctionToolCallEvent":
        part = getattr(event, "part", None)
        tool_name = getattr(part, "tool_name", None) or getattr(event, "tool_name", "?")
        args = getattr(part, "args", None)
        return f"[tool_call] {tool_name} args={args!r}"
    if name == "FunctionToolResultEvent":
        tool_name = getattr(event, "tool_name", None) or "?"
        result = getattr(event, "result", None)
        text = repr(result)
        if len(text) > 2000:
            text = text[:2000] + "...[truncated]"
        return f"[tool_result] {tool_name} -> {text}"
    if name == "FinalResultEvent":
        return "[final_result]"
    return None


class AgentRuntime:
    def __init__(self, gateway: LlmGateway | None = None) -> None:
        self._gateway = gateway or LlmGateway()

    def run_sync(
        self,
        *,
        model_id: str,
        prompt: str,
        agent_name: str,
        department: str,
        run_id: int,
        conversation_id: int | None = None,
        cwd: str,
        timeout_seconds: int,
        soft_cancel_grace_seconds: int = 0,
        hard_timeout_grace_seconds: int = 0,
        handle_key: str,
        handle: ActiveRunHandle | None = None,
        on_event: Callable[[str], None] | None = None,
    ) -> AgentRuntimeResult:
        """Run the agent loop from a worker thread (bridges asyncio)."""
        active = handle or ActiveRunHandle()
        register_active_handle(handle_key, active)
        try:
            return asyncio.run(
                self._run_async(
                    model_id=model_id,
                    prompt=prompt,
                    agent_name=agent_name,
                    department=department,
                    run_id=run_id,
                    conversation_id=conversation_id,
                    cwd=cwd,
                    timeout_seconds=timeout_seconds,
                    soft_cancel_grace_seconds=soft_cancel_grace_seconds,
                    hard_timeout_grace_seconds=hard_timeout_grace_seconds,
                    handle=active,
                    on_event=on_event or (lambda _line: None),
                )
            )
        finally:
            unregister_active_handle(handle_key)

    async def _run_async(
        self,
        *,
        model_id: str,
        prompt: str,
        agent_name: str,
        department: str,
        run_id: int,
        conversation_id: int | None,
        cwd: str,
        timeout_seconds: int,
        soft_cancel_grace_seconds: int,
        hard_timeout_grace_seconds: int,
        handle: ActiveRunHandle,
        on_event: Callable[[str], None],
    ) -> AgentRuntimeResult:
        loop = asyncio.get_running_loop()
        handle.bind_loop(loop)

        model = self._gateway.resolve_model(model_id)
        headers = {
            "X-Agent-Name": agent_name,
            "X-Agent-Department": department,
            "X-Run-Id": str(run_id),
        }
        if conversation_id is not None:
            headers["X-Conversation-Id"] = str(conversation_id)

        mcp_toolset = MCPToolset(_mcp_sse_url(), headers=headers)
        agent = Agent(
            model,
            deps_type=RuntimeDeps,
            tools=[build_shell_tool()],
            toolsets=[mcp_toolset],
            retries=2,
        )

        deps = RuntimeDeps(
            agent_name=agent_name,
            department=department,
            run_id=run_id,
            conversation_id=conversation_id,
            cwd=cwd,
            shell_env=os.environ.copy(),
            on_event=on_event,
        )

        transcript_parts: list[str] = []

        async def event_handler(_ctx, event_stream):
            async for event in event_stream:
                line = _format_event(event)
                if line:
                    transcript_parts.append(line)
                    on_event(line)

        started = time.monotonic()
        cancelled = False
        timed_out = False
        soft_cancelled = False
        error: str | None = None
        output = ""
        tokens_in: int | None = None
        tokens_out: int | None = None
        cost: float | None = None

        soft_at = max(1, int(timeout_seconds)) + max(0, int(soft_cancel_grace_seconds))
        hard_at = max(soft_at, int(timeout_seconds) + max(0, int(hard_timeout_grace_seconds)))

        async def _soft_cancel_watch() -> None:
            nonlocal soft_cancelled
            await asyncio.sleep(soft_at)
            soft_cancelled = True
            on_event(
                f"[timeout] soft cancel at {soft_at}s "
                f"(configured timeout {timeout_seconds}s + {soft_cancel_grace_seconds}s)"
            )
            handle.cancel()

        watch_task = asyncio.create_task(_soft_cancel_watch())
        try:
            async with agent:
                result = await asyncio.wait_for(
                    agent.run(
                        prompt,
                        deps=deps,
                        cancellation_token=handle.cancellation_token,
                        event_stream_handler=event_handler,
                    ),
                    timeout=hard_at,
                )
            output = str(result.output or "").strip()
            if output:
                transcript_parts.append(f"[text]\n{output}")
                on_event(f"[text]\n{output}")
            usage = result.usage() if callable(result.usage) else result.usage
            tokens_in = int(getattr(usage, "input_tokens", 0) or 0) or None
            tokens_out = int(getattr(usage, "output_tokens", 0) or 0) or None
            try:
                cost = estimate_cost(normalize_model_id(model_id), tokens_in, tokens_out)
            except Exception:  # noqa: BLE001 — pricing is best-effort
                logger.warning("Cost estimate failed for model %s", model_id, exc_info=True)
                cost = None
        except asyncio.TimeoutError:
            timed_out = True
            handle.cancel()
            error = f"Exceeded timeout ({timeout_seconds}s); hard stop at {hard_at}s"
            transcript_parts.append(f"[error] {error}")
            on_event(f"[error] {error}")
        except Exception as exc:  # noqa: BLE001
            if handle.cancellation_token.cancelled:
                cancelled = True
                if soft_cancelled:
                    timed_out = True
                    error = f"Exceeded timeout ({timeout_seconds}s); cancelled at {soft_at}s"
                else:
                    error = "Cancelled"
            else:
                error = str(exc) or type(exc).__name__
                logger.exception("AgentRuntime failed for %s/%s", department, agent_name)
            transcript_parts.append(f"[error] {error}")
            on_event(f"[error] {error}")
        finally:
            watch_task.cancel()
            try:
                await watch_task
            except asyncio.CancelledError:
                pass

        duration = time.monotonic() - started
        return AgentRuntimeResult(
            output=output,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            estimated_cost_usd=cost,
            duration_seconds=duration,
            cancelled=cancelled or handle.cancellation_token.cancelled,
            timed_out=timed_out,
            error=error,
            transcript="\n".join(transcript_parts).strip(),
        )
