import json
import logging
import os
import queue
import shlex
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

from app.errors import APIClientError
from app.extensions import db
from app.models import RunStatus, SystemAgent, SystemAgentRun, TriggerSource
from app.services.email import maybe_notify_run
from app.services.model_registry import compute_estimated_cost, parse_usage_from_claude_output
from app.services.params import get_claude_cli_extra_args
from app.services.db_provisioning import build_agent_db_instructions
from app.services.workspace import ensure_agent_folder, ensure_run_folder, read_prompt_inputs, safe_path, workspace_root

logger = logging.getLogger(__name__)

_run_lock = threading.Lock()
_run_queue: queue.Queue = queue.Queue()
_worker_started = False

RUN_FAILED_MESSAGE = "Agent run failed"
LOG_STDERR_MAX = 4000


def _truncate_text(text: str, max_chars: int = LOG_STDERR_MAX) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}...[truncated {len(text) - max_chars} chars]"


def _format_command_line(cmd: list[str], *, prompt_path: str | None = None) -> str:
    display_cmd = list(cmd)
    if prompt_path and len(display_cmd) >= 3 and display_cmd[0] == "claude" and display_cmd[1] == "-p":
        prompt_len = len(display_cmd[2])
        display_cmd[2] = f"@{prompt_path} ({prompt_len} chars)"
    return " ".join(shlex.quote(arg) for arg in display_cmd)


def _run_start_context(
    run: SystemAgentRun,
    agent: SystemAgent,
    *,
    cmd: list[str],
    timeout_seconds: int,
    mcp_config_path: Path,
    cwd: str,
    payload: dict | None,
) -> dict:
    return {
        "run_id": run.id,
        "agent_id": agent.id,
        "agent_name": agent.name,
        "department": agent.department,
        "model": agent.model,
        "trigger_source": run.trigger_source.value,
        "timeout_seconds": timeout_seconds,
        "cwd": cwd,
        "run_dir": run.run_dir,
        "prompt_path": run.prompt_path,
        "log_path": run.log_path,
        "mcp_config_path": str(mcp_config_path),
        "has_payload": payload is not None,
        "command": _format_command_line(cmd, prompt_path=run.prompt_path),
    }


def _log_run_start(context: dict) -> None:
    logger.info("AGENT_RUN_START %s", json.dumps(context, default=str))


def _log_run_finish(context: dict) -> None:
    serialized = json.dumps(context, default=str)
    status = context.get("status")
    if status in {RunStatus.failed.value, "failed"} or context.get("exit_code") not in (0, None):
        logger.error("AGENT_RUN_END %s", serialized)
    else:
        logger.info("AGENT_RUN_END %s", serialized)


def _write_run_log_start(log_path: Path, context: dict) -> None:
    with open(log_path, "w", encoding="utf-8") as log_file:
        log_file.write("=== RUN START ===\n")
        for key, value in context.items():
            if key == "command":
                continue
            log_file.write(f"{key}: {value}\n")
        log_file.write(f"\n$ {context['command']}\n\n")


def _append_message_blocks(parts: list[str], message: dict) -> None:
    for block in message.get("content", []) or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "thinking":
            thinking = block.get("thinking") or block.get("text") or ""
            if thinking:
                parts.append(f"[thinking]\n{thinking}\n")
        elif block_type == "text":
            text = block.get("text") or ""
            if text:
                parts.append(f"[text]\n{text}\n")


def format_claude_stream_transcript(stdout: str) -> str:
    import json

    parts: list[str] = []
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            continue

        event_type = data.get("type")
        if event_type == "assistant":
            _append_message_blocks(parts, data.get("message", {}))
        elif event_type == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "thinking_delta":
                parts.append(delta.get("thinking", ""))
            elif delta.get("type") == "text_delta":
                parts.append(delta.get("text", ""))
        elif event_type == "result":
            result = data.get("result")
            if isinstance(result, str) and result.strip():
                parts.append(f"\n[result]\n{result.strip()}\n")

    return "".join(parts).strip()


def _write_run_log_finish(
    log_path: Path,
    *,
    returncode: int,
    stdout: str,
    stderr: str,
    duration_seconds: float,
    status: RunStatus,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    estimated_cost_usd: float | None = None,
    error_message: str | None = None,
    extra_notes: str | None = None,
    stdout_written: bool = False,
) -> None:
    with open(log_path, "a", encoding="utf-8") as log_file:
        if not stdout_written:
            log_file.write("\n=== STDOUT ===\n")
            log_file.write(stdout if stdout else "(empty)\n")
        log_file.write("\n=== STDERR ===\n")
        log_file.write(stderr if stderr else "(empty)\n")
        transcript = format_claude_stream_transcript(stdout)
        if transcript:
            log_file.write("\n=== TRANSCRIPT (thinking + text) ===\n")
            log_file.write(transcript)
            log_file.write("\n")
        log_file.write("=== RUN END ===\n")
        log_file.write(f"status: {status.value}\n")
        log_file.write(f"exit_code: {returncode}\n")
        log_file.write(f"duration_seconds: {duration_seconds:.3f}\n")
        if tokens_in is not None:
            log_file.write(f"tokens_in: {tokens_in}\n")
        if tokens_out is not None:
            log_file.write(f"tokens_out: {tokens_out}\n")
        if estimated_cost_usd is not None:
            log_file.write(f"estimated_cost_usd: {estimated_cost_usd}\n")
        if error_message:
            log_file.write(f"error_message: {error_message}\n")
        if extra_notes:
            log_file.write(f"notes: {extra_notes}\n")


def _run_claude_subprocess(
    log_path: Path,
    cmd: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout_seconds: int,
) -> tuple[int, str, str]:
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []

    with open(log_path, "a", encoding="utf-8") as log_file:
        log_file.write("\n=== STDOUT ===\n")
        log_file.flush()

        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )

        def read_stdout() -> None:
            if not proc.stdout:
                return
            for line in proc.stdout:
                stdout_parts.append(line)
                log_file.write(line)
                log_file.flush()

        def read_stderr() -> None:
            if not proc.stderr:
                return
            for line in proc.stderr:
                stderr_parts.append(line)

        stdout_thread = threading.Thread(target=read_stdout, daemon=True, name="agent-run-stdout")
        stderr_thread = threading.Thread(target=read_stderr, daemon=True, name="agent-run-stderr")
        stdout_thread.start()
        stderr_thread.start()

        try:
            returncode = proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            stdout_thread.join(timeout=2)
            stderr_thread.join(timeout=2)
            raise

        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

    return returncode, "".join(stdout_parts), "".join(stderr_parts)


def build_run_summary_instructions(summary_path: str) -> str:
    return "\n".join(
        [
            "# Run output (required)",
            "",
            "Before you finish this run, you MUST write a markdown summary to this exact path:",
            f"`{summary_path}`",
            "",
            "Use the `write_workspace` tool with that path and filename `summary.md`.",
            "The summary should be concise and include:",
            "- What you did and why",
            "- Key outcomes and decisions",
            "- Files created or changed (with paths)",
            "- Errors, blockers, or open questions",
            "- Recommended next steps (if any)",
            "",
            "Formatting (mandatory):",
            "- Plain markdown only (headings, lists, paragraphs, fenced code blocks).",
            "- Black text on white background — no colors.",
            "- Do not use HTML, inline styles, colored markdown, badges, or emoji status symbols.",
            "- Do not use colored tables or syntax that renders with background/text colors.",
        ]
    )


def build_prompt(agent: SystemAgent, payload: dict | None = None, *, summary_path: str | None = None) -> str:
    lines = [
        "# Agent configuration",
        f"Name: {agent.name}",
        f"Department: {agent.department}",
        f"Model: {agent.model}",
        f"Cron: {agent.crond or '(none)'}",
        "",
        build_agent_db_instructions(
            agent_name=agent.name,
            department=agent.department,
            db_user=agent.db_user,
        ),
        "",
        "# Input files",
        read_prompt_inputs(agent.department, agent.name),
    ]
    if payload:
        lines.extend(["", "# Trigger payload", json.dumps(payload, indent=2)])
    if summary_path:
        lines.extend(["", build_run_summary_instructions(summary_path)])
    return "\n".join(lines)


def _mark_run_failed(
    run: SystemAgentRun,
    log_path: Path | None,
    detail: str | None = None,
    *,
    agent: SystemAgent | None = None,
    duration_seconds: float | None = None,
) -> None:
    run.status = RunStatus.failed
    run.error_message = RUN_FAILED_MESSAGE
    run.finished_at = datetime.now(timezone.utc)
    db.session.commit()
    if log_path and detail:
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write("\n=== RUN END ===\n")
            log_file.write(f"status: {RunStatus.failed.value}\n")
            if duration_seconds is not None:
                log_file.write(f"duration_seconds: {duration_seconds:.3f}\n")
            log_file.write(f"notes: {detail}\n")
    finish_context = {
        "run_id": run.id,
        "agent_id": run.agent_id,
        "agent_name": agent.name if agent else None,
        "status": RunStatus.failed.value,
        "error_message": RUN_FAILED_MESSAGE,
        "detail": detail,
    }
    if duration_seconds is not None:
        finish_context["duration_seconds"] = round(duration_seconds, 3)
    _log_run_finish(finish_context)


def _finalize_run(
    run: SystemAgentRun,
    agent: SystemAgent,
    status: RunStatus,
    error_message: str | None,
    tokens_in: int | None,
    tokens_out: int | None,
    estimated_cost: float | None,
) -> None:
    run.status = status
    run.tokens_in = tokens_in
    run.tokens_out = tokens_out
    run.estimated_cost_usd = estimated_cost
    run.error_message = error_message
    run.finished_at = datetime.now(timezone.utc)
    db.session.commit()
    maybe_notify_run(agent.name, run.id, status.value, error_message)


def _execute_run(run_id: int, payload: dict | None = None) -> None:
    from app import get_app

    app = get_app()
    with app.app_context():
        run = db.session.get(SystemAgentRun, run_id)
        if not run:
            return
        agent = db.session.get(SystemAgent, run.agent_id)
        log_path: Path | None = None
        if not agent:
            run.status = RunStatus.failed
            run.error_message = RUN_FAILED_MESSAGE
            run.finished_at = datetime.now(timezone.utc)
            db.session.commit()
            return

        run.status = RunStatus.running
        run.model = agent.model
        started_at = datetime.now(timezone.utc)
        run.started_at = started_at
        db.session.commit()

        ensure_agent_folder(agent.name)
        paths = ensure_run_folder(agent.name, started_at, run.id)
        run.run_dir = paths["run_dir"]
        run.prompt_path = paths["prompt_path"]
        run.log_path = paths["log_path"]
        db.session.commit()

        log_path = safe_path(paths["log_path"])
        prompt = build_prompt(agent, payload, summary_path=paths["summary_path"])
        safe_path(paths["prompt_path"]).write_text(prompt, encoding="utf-8")

        if not shutil.which("claude"):
            _mark_run_failed(run, log_path, "Claude CLI is not installed", agent=agent)
            maybe_notify_run(agent.name, run.id, RunStatus.failed.value, RUN_FAILED_MESSAGE)
            return

        runtime_dir = Path(current_app.config["RUNTIME_DIR"])
        runtime_dir.mkdir(parents=True, exist_ok=True)
        mcp_config_path = runtime_dir / f"mcp-run-{run.id}.json"
        mcp_config_path.write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "agents44": {
                            "type": "sse",
                            "url": f"http://127.0.0.1:{current_app.config['MCP_PORT']}/sse",
                            "headers": {
                                "X-Agent-Name": agent.name,
                                "X-Agent-Department": agent.department,
                                "X-Run-Id": str(run.id),
                            },
                        }
                    }
                }
            ),
            encoding="utf-8",
        )

        env = os.environ.copy()
        if current_app.config.get("ANTHROPIC_API_KEY"):
            env["ANTHROPIC_API_KEY"] = current_app.config["ANTHROPIC_API_KEY"]

        extra_args = get_claude_cli_extra_args()
        cmd = [
            "claude",
            "-p",
            prompt,
            "--model",
            agent.model,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--mcp-config",
            str(mcp_config_path),
            *extra_args,
        ]

        timeout_seconds = agent.timeout_seconds or 300
        cwd = str(workspace_root())
        start_context = _run_start_context(
            run,
            agent,
            cmd=cmd,
            timeout_seconds=timeout_seconds,
            mcp_config_path=mcp_config_path,
            cwd=cwd,
            payload=payload,
        )
        _write_run_log_start(log_path, start_context)
        _log_run_start(start_context)
        started_monotonic = time.monotonic()

        try:
            returncode, stdout, stderr = _run_claude_subprocess(
                log_path,
                cmd,
                cwd=cwd,
                env=env,
                timeout_seconds=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            duration_seconds = time.monotonic() - started_monotonic
            timeout_note = f"Agent run timed out after {timeout_seconds} seconds"
            partial_stdout = ""
            partial_stderr = ""
            if log_path.exists():
                log_text = log_path.read_text(encoding="utf-8")
                if "\n=== STDOUT ===\n" in log_text:
                    partial_stdout = log_text.split("\n=== STDOUT ===\n", 1)[1]
                    for marker in ("\n=== STDERR ===\n", "\n=== RUN END ===\n"):
                        if marker in partial_stdout:
                            partial_stdout = partial_stdout.split(marker, 1)[0]
            _write_run_log_finish(
                log_path,
                returncode=-1,
                stdout=partial_stdout,
                stderr=partial_stderr,
                duration_seconds=duration_seconds,
                status=RunStatus.failed,
                error_message=RUN_FAILED_MESSAGE,
                extra_notes=timeout_note,
                stdout_written=True,
            )
            _log_run_finish(
                {
                    "run_id": run.id,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "status": RunStatus.failed.value,
                    "exit_code": -1,
                    "duration_seconds": round(duration_seconds, 3),
                    "timeout_seconds": timeout_seconds,
                    "error_message": RUN_FAILED_MESSAGE,
                    "detail": timeout_note,
                    "stderr": _truncate_text(partial_stderr) if partial_stderr else None,
                }
            )
            _finalize_run(run, agent, RunStatus.failed, RUN_FAILED_MESSAGE, None, None, None)
            return

        duration_seconds = time.monotonic() - started_monotonic

        status = RunStatus.success
        error_message = None
        if returncode != 0:
            status = RunStatus.failed
            error_message = RUN_FAILED_MESSAGE

        tokens_in, tokens_out = parse_usage_from_claude_output(stdout)
        estimated_cost = compute_estimated_cost(agent.model, tokens_in, tokens_out)
        exit_note = None
        if returncode != 0:
            exit_note = f"Claude CLI exited with code {returncode}"

        _write_run_log_finish(
            log_path,
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
            duration_seconds=duration_seconds,
            status=status,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            estimated_cost_usd=estimated_cost,
            error_message=error_message,
            extra_notes=exit_note,
            stdout_written=True,
        )
        _log_run_finish(
            {
                "run_id": run.id,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "status": status.value,
                "exit_code": returncode,
                "duration_seconds": round(duration_seconds, 3),
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "estimated_cost_usd": estimated_cost,
                "error_message": error_message,
                "stderr": _truncate_text(stderr) if stderr else None,
            }
        )
        _finalize_run(run, agent, status, error_message, tokens_in, tokens_out, estimated_cost)


def _fail_run_from_worker(run_id: int, detail: str | None = None) -> None:
    from app import get_app

    app = get_app()
    with app.app_context():
        run = db.session.get(SystemAgentRun, run_id)
        if not run or run.status != RunStatus.running:
            return
        agent = db.session.get(SystemAgent, run.agent_id)
        run.status = RunStatus.failed
        run.error_message = RUN_FAILED_MESSAGE
        run.finished_at = datetime.now(timezone.utc)
        db.session.commit()
        _log_run_finish(
            {
                "run_id": run.id,
                "agent_id": run.agent_id,
                "agent_name": agent.name if agent else None,
                "status": RunStatus.failed.value,
                "error_message": RUN_FAILED_MESSAGE,
                "detail": detail or "Run worker failed unexpectedly",
            }
        )
        if agent:
            maybe_notify_run(agent.name, run.id, RunStatus.failed.value, RUN_FAILED_MESSAGE)


def _worker_loop() -> None:
    while True:
        item = _run_queue.get()
        try:
            if isinstance(item, dict):
                run_id = item["run_id"]
                payload = item.get("payload")
            else:
                run_id = item
                payload = None
            with _run_lock:
                _execute_run(run_id, payload)
        except Exception as exc:
            logger.exception("Run worker failed for run %s", item)
            run_id = item["run_id"] if isinstance(item, dict) else item
            _fail_run_from_worker(run_id, detail=str(exc))
        finally:
            _run_queue.task_done()


def _ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    thread = threading.Thread(target=_worker_loop, daemon=True, name="agent-run-worker")
    thread.start()
    _worker_started = True


def _is_busy() -> bool:
    active = SystemAgentRun.query.filter_by(status=RunStatus.running).first()
    return active is not None or _run_lock.locked()


def start_agent(agent_id: int, trigger_source: str, payload: dict | None = None) -> SystemAgentRun:
    _ensure_worker()
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Agent not found", 404)
    if not agent.enabled:
        raise APIClientError("Agent is disabled", 400)

    source = TriggerSource(trigger_source)
    pending_exists = _is_busy()
    run = SystemAgentRun(
        agent_id=agent.id,
        status=RunStatus.pending if pending_exists else RunStatus.running,
        trigger_source=source,
        model=agent.model,
    )
    db.session.add(run)
    db.session.commit()
    logger.info(
        "AGENT_RUN_QUEUED %s",
        json.dumps(
            {
                "run_id": run.id,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "trigger_source": source.value,
                "initial_status": run.status.value,
                "queued_behind_active_run": pending_exists,
            },
            default=str,
        ),
    )
    _run_queue.put({"run_id": run.id, "payload": payload})
    return run
