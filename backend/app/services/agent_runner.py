import json
import logging
import os
import queue
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

from app.errors import APIClientError
from app.extensions import db
from app.models import RunStatus, SystemAgent, SystemAgentRun, TriggerSource
from app.services.email import maybe_notify_run
from app.services.model_registry import compute_estimated_cost, parse_usage_from_claude_output
from app.services.params import get_claude_cli_extra_args
from app.services.workspace import ensure_agent_folder, ensure_run_folder, read_prompt_inputs, safe_path, workspace_root

logger = logging.getLogger(__name__)

_run_lock = threading.Lock()
_run_queue: queue.Queue = queue.Queue()
_worker_started = False

RUN_FAILED_MESSAGE = "Agent run failed"


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


def _write_run_log(
    log_path: Path,
    cmd: list[str],
    stdout: str,
    stderr: str,
    returncode: int,
) -> None:
    with open(log_path, "w", encoding="utf-8") as log_file:
        log_file.write(f"$ {' '.join(cmd[:4])} ...\n\n")
        log_file.write(f"=== EXIT CODE ===\n{returncode}\n\n")
        log_file.write("=== STDOUT ===\n")
        log_file.write(stdout if stdout else "(empty)\n")
        log_file.write("\n=== STDERR ===\n")
        log_file.write(stderr if stderr else "(empty)\n")
        transcript = format_claude_stream_transcript(stdout)
        if transcript:
            log_file.write("\n=== TRANSCRIPT (thinking + text) ===\n")
            log_file.write(transcript)
            log_file.write("\n")


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
        "# Input files",
        read_prompt_inputs(agent.department, agent.name),
    ]
    if payload:
        lines.extend(["", "# Trigger payload", json.dumps(payload, indent=2)])
    if summary_path:
        lines.extend(["", build_run_summary_instructions(summary_path)])
    return "\n".join(lines)


def _mark_run_failed(run: SystemAgentRun, log_path: Path | None, detail: str | None = None) -> None:
    run.status = RunStatus.failed
    run.error_message = RUN_FAILED_MESSAGE
    run.finished_at = datetime.now(timezone.utc)
    db.session.commit()
    if log_path and detail:
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(f"\n{detail}\n")


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
            _mark_run_failed(run, log_path, "Claude CLI is not installed")
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
        try:
            result = subprocess.run(
                cmd,
                cwd=str(workspace_root()),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            _write_run_log(log_path, cmd, exc.stdout or "", exc.stderr or "", -1)
            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write(f"\nAgent run timed out after {timeout_seconds} seconds\n")
            _finalize_run(run, agent, RunStatus.failed, RUN_FAILED_MESSAGE, None, None, None)
            return

        _write_run_log(log_path, cmd, result.stdout or "", result.stderr or "", result.returncode)

        status = RunStatus.success
        error_message = None
        if result.returncode != 0:
            status = RunStatus.failed
            error_message = RUN_FAILED_MESSAGE
            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write(f"\nClaude CLI exited with code {result.returncode}\n")

        tokens_in, tokens_out = parse_usage_from_claude_output(result.stdout or "")
        estimated_cost = compute_estimated_cost(agent.model, tokens_in, tokens_out)
        _finalize_run(run, agent, status, error_message, tokens_in, tokens_out, estimated_cost)


def _fail_run_from_worker(run_id: int) -> None:
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
        except Exception:
            logger.exception("Run worker failed for run %s", item)
            run_id = item["run_id"] if isinstance(item, dict) else item
            _fail_run_from_worker(run_id)
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
    _run_queue.put({"run_id": run.id, "payload": payload})
    return run
