"""AgentRuntime — Pydantic AI loop over LiteLLM + MCP + shell."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from flask import current_app
from pydantic_ai import Agent, CancellationToken, RunContext
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.usage import RunUsage, UsageLimits

from app.services.agent_runtime.deps import RuntimeDeps
from app.services.agent_runtime.gateway import LlmGateway
from app.services.agent_runtime.shell_tool import build_shell_tool
from app.services.model_registry import estimate_cost, normalize_model_id
from app.services.timeout import format_remaining_duration

logger = logging.getLogger(__name__)

_TOOL_RESULT_MAX_CHARS = 4000
_WRAP_UP_SECONDS = 60


def _time_remaining_instruction(ctx: RunContext[RuntimeDeps]) -> str:
    """Recomputed before every model request with wall-clock time left until soft cancel."""
    deadline = ctx.deps.soft_cancel_deadline_monotonic
    if deadline <= 0:
        return ""
    remaining = int(deadline - time.monotonic())
    label = format_remaining_duration(remaining)
    lines = [f"Time remaining until soft cancel: {label}."]
    if remaining < _WRAP_UP_SECONDS:
        if ctx.deps.require_run_summary:
            lines.append(
                "Less than one minute remains — write summary.md now and finish. "
                "Do not start new work; soft cancel will end this run with no further turn."
            )
        else:
            lines.append(
                "Less than one minute remains — finish your reply now. "
                "Soft cancel will end this run with no further turn."
            )
    return "\n".join(lines)


def _coerce_tool_args(args: Any) -> Any:
    if args is None:
        return None
    if isinstance(args, str):
        try:
            return json.loads(args)
        except json.JSONDecodeError:
            return args
    return args


def _format_tool_args(tool_name: str, args: Any) -> str:
    parsed = _coerce_tool_args(args)
    if parsed is None:
        return "(no args)"
    if isinstance(parsed, dict):
        if tool_name == "run_shell" and isinstance(parsed.get("command"), str):
            return f"$ {parsed['command']}"
        return json.dumps(parsed, ensure_ascii=False, indent=2)
    if isinstance(parsed, str):
        return parsed
    return json.dumps(parsed, ensure_ascii=False, indent=2, default=str)


def _format_tool_result_content(content: Any) -> str:
    if content is None:
        return "(empty)"
    if isinstance(content, str):
        text = content
    elif isinstance(content, (dict, list)):
        text = json.dumps(content, ensure_ascii=False, indent=2, default=str)
    else:
        text = str(content)
    if len(text) > _TOOL_RESULT_MAX_CHARS:
        return text[:_TOOL_RESULT_MAX_CHARS] + f"\n...[truncated {len(text) - _TOOL_RESULT_MAX_CHARS} chars]"
    return text


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
        tool_name = getattr(part, "tool_name", None) or getattr(event, "tool_name", None) or "?"
        args = None
        if part is not None and hasattr(part, "args_as_dict"):
            try:
                args = part.args_as_dict()
            except Exception:  # noqa: BLE001 — fall back to raw args
                args = getattr(part, "args", None)
        else:
            args = getattr(part, "args", None) if part is not None else None
        body = _format_tool_args(str(tool_name), args)
        return f"--- Tool call: {tool_name} ---\n{body}"
    if name == "FunctionToolResultEvent":
        part = getattr(event, "part", None)
        tool_name = (
            getattr(part, "tool_name", None)
            or getattr(event, "tool_name", None)
            or "?"
        )
        content = getattr(event, "content", None)
        if content is None and part is not None:
            content = getattr(part, "content", None)
        body = _format_tool_result_content(content)
        return f"--- Tool result: {tool_name} ---\n{body}"
    if name == "FinalResultEvent":
        return "--- Final result ---"
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

        @agent.instructions
        def _inject_time_remaining(ctx: RunContext[RuntimeDeps]) -> str:
            return _time_remaining_instruction(ctx)

        soft_at = max(1, int(timeout_seconds)) + max(0, int(soft_cancel_grace_seconds))
        hard_at = max(soft_at, int(timeout_seconds) + max(0, int(hard_timeout_grace_seconds)))
        started = time.monotonic()

        deps = RuntimeDeps(
            agent_name=agent_name,
            department=department,
            run_id=run_id,
            conversation_id=conversation_id,
            cwd=cwd,
            shell_env=os.environ.copy(),
            on_event=on_event,
            started_monotonic=started,
            soft_cancel_deadline_monotonic=started + soft_at,
            # Scheduled/manual agent runs require summary.md; operator chat does not.
            require_run_summary=conversation_id is None,
        )

        transcript_parts: list[str] = []

        async def event_handler(_ctx, event_stream):
            async for event in event_stream:
                line = _format_event(event)
                if line:
                    transcript_parts.append(line)
                    on_event(line)

        cancelled = False
        timed_out = False
        soft_cancelled = False
        error: str | None = None
        output = ""
        tokens_in: int | None = None
        tokens_out: int | None = None
        cost: float | None = None

        async def _soft_cancel_watch() -> None:
            nonlocal soft_cancelled
            await asyncio.sleep(soft_at)
            soft_cancelled = True
            on_event(
                "--- Timeout ---\n"
                f"soft cancel at {soft_at}s "
                f"(configured timeout {timeout_seconds}s + {soft_cancel_grace_seconds}s)"
            )
            handle.cancel()

        watch_task = asyncio.create_task(_soft_cancel_watch())
        # Shared usage accumulator — populated even when the run fails (e.g. request_limit).
        run_usage = RunUsage()
        # Timeout/cancel already bound agent runs; do not hard-cap model requests at 50.
        usage_limits = UsageLimits(request_limit=None)
        try:
            async with agent:
                result = await asyncio.wait_for(
                    agent.run(
                        prompt,
                        deps=deps,
                        cancellation_token=handle.cancellation_token,
                        event_stream_handler=event_handler,
                        usage=run_usage,
                        usage_limits=usage_limits,
                    ),
                    timeout=hard_at,
                )
            output = str(result.output or "").strip()
            if output:
                transcript_parts.append(f"--- Assistant ---\n{output}")
                on_event(f"--- Assistant ---\n{output}")
        except asyncio.TimeoutError:
            timed_out = True
            handle.cancel()
            error = f"Exceeded timeout ({timeout_seconds}s); hard stop at {hard_at}s"
            transcript_parts.append(f"--- Error ---\n{error}")
            on_event(f"--- Error ---\n{error}")
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
            transcript_parts.append(f"--- Error ---\n{error}")
            on_event(f"--- Error ---\n{error}")
        finally:
            watch_task.cancel()
            try:
                await watch_task
            except asyncio.CancelledError:
                pass

        # Read from the shared accumulator (not only result.usage) so failed/cancelled
        # runs still report tokens after e.g. a former request_limit stop.
        tokens_in = int(run_usage.input_tokens or 0) or None
        tokens_out = int(run_usage.output_tokens or 0) or None
        try:
            cost = estimate_cost(normalize_model_id(model_id), tokens_in, tokens_out)
        except Exception:  # noqa: BLE001 — pricing is best-effort
            logger.warning("Cost estimate failed for model %s", model_id, exc_info=True)
            cost = None

        if run_usage.requests or tokens_in is not None or tokens_out is not None or cost is not None:
            usage_line = (
                "--- Usage ---\n"
                f"requests: {run_usage.requests}\n"
                f"tokens_in: {tokens_in}\n"
                f"tokens_out: {tokens_out}\n"
                f"estimated_cost_usd: {cost}"
            )
            transcript_parts.append(usage_line)
            on_event(usage_line)

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
