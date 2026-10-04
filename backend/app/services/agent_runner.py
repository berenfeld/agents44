import json
import logging
import os
import queue
import sys
import threading
import time
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path

from flask import current_app

from app.errors import APIClientError
from app.extensions import db
from app.models import RunStatus, SystemAgent, SystemAgentRun, TriggerSource
from app.services.agent_runtime import AgentRuntime
from app.services.agent_runtime.runtime import cancel_active_handle, get_active_handle
from app.services.db_provisioning import build_agent_db_instructions
from app.services.email import maybe_notify_run
from app.services.outbound_email import build_email_instructions
from app.services.params import (
    get_timeout_sigkill_grace_seconds,
    get_timeout_sigterm_grace_seconds,
)
from app.services.timeout import format_remaining_duration, format_timeout_seconds
from app.services.whatsapp import build_whatsapp_instructions
from app.services.workspace import (
    build_memory_instructions,
    ensure_agent_folder,
    ensure_run_folder,
    read_prompt_inputs,
    safe_path,
    workspace_root,
)

logger = logging.getLogger(__name__)

_run_lock = threading.Lock()
_run_queue: queue.Queue = queue.Queue()
_worker_started = False
_active_run_timeouts: dict[int, int] = {}
_active_run_timeouts_lock = threading.Lock()
_manual_stop_requested: set[int] = set()
_manual_stop_lock = threading.Lock()

RUN_FAILED_MESSAGE = "Agent run failed"
LOG_STDERR_MAX = 4000


def _run_handle_key(run_id: int) -> str:
    return f"run:{run_id}"


def _enforcement_note(
    timeout_seconds: int,
    *,
    sigterm_grace_seconds: int,
    sigkill_grace_seconds: int,
    soft_cancelled: bool,
    hard_stopped: bool,
) -> str:
    parts = [f"Agent run exceeded configured timeout ({timeout_seconds}s)"]
    if soft_cancelled:
        parts.append(f"soft cancel at {timeout_seconds + sigterm_grace_seconds}s")
    if hard_stopped:
        parts.append(f"hard stop at {timeout_seconds + sigkill_grace_seconds}s")
    return "; ".join(parts)


def _summary_written(summary_path: Path) -> bool:
    return summary_path.exists() and bool(summary_path.read_text(encoding="utf-8").strip())


def _run_timeout_path(run_id: int) -> Path:
    runtime_dir = Path(current_app.config["RUNTIME_DIR"])
    runtime_dir.mkdir(parents=True, exist_ok=True)
    return runtime_dir / f"timeout-run-{run_id}.txt"


def _write_run_timeout(run_id: int, timeout_seconds: int) -> None:
    _run_timeout_path(run_id).write_text(str(timeout_seconds), encoding="utf-8")
    with _active_run_timeouts_lock:
        _active_run_timeouts[run_id] = timeout_seconds


def _read_run_timeout(run_id: int) -> int | None:
    path = _run_timeout_path(run_id)
    if path.exists():
        raw = path.read_text(encoding="utf-8").strip()
        try:
            value = int(raw)
        except ValueError:
            value = None
        if value is not None and value >= 1:
            with _active_run_timeouts_lock:
                _active_run_timeouts[run_id] = value
            return value
    with _active_run_timeouts_lock:
        return _active_run_timeouts.get(run_id)


def _register_run_timeout(run_id: int, timeout_seconds: int) -> None:
    path = _run_timeout_path(run_id)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(str(timeout_seconds))
    with _active_run_timeouts_lock:
        _active_run_timeouts[run_id] = timeout_seconds


def _unregister_run_timeout(run_id: int) -> None:
    _run_timeout_path(run_id).unlink(missing_ok=True)
    with _active_run_timeouts_lock:
        _active_run_timeouts.pop(run_id, None)


def get_active_run_timeout(run_id: int) -> int | None:
    return _read_run_timeout(run_id)


def sync_agent_run_timeout(agent_id: int, timeout_seconds: int) -> None:
    run = SystemAgentRun.query.filter_by(agent_id=agent_id, status=RunStatus.running).first()
    if not run:
        return

    previous = get_active_run_timeout(run.id)
    _write_run_timeout(run.id, timeout_seconds)

    if run.log_path:
        log_path = safe_path(run.log_path)
        if log_path.exists():
            sigterm_grace_seconds = get_timeout_sigterm_grace_seconds()
            sigkill_grace_seconds = get_timeout_sigkill_grace_seconds()
            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write(
                    "\n=== TIMEOUT UPDATED ===\n"
                    f"previous_timeout_seconds: {previous if previous is not None else '(unknown)'}\n"
                    f"timeout_seconds: {timeout_seconds}\n"
                    f"timeout_soft_cancel_at_seconds: {timeout_seconds + sigterm_grace_seconds}\n"
                    f"timeout_hard_stop_at_seconds: {timeout_seconds + sigkill_grace_seconds}\n"
                )
                log_file.flush()

    logger.info(
        "AGENT_RUN_TIMEOUT_UPDATED %s",
        json.dumps(
            {
                "run_id": run.id,
                "agent_id": agent_id,
                "previous_timeout_seconds": previous,
                "timeout_seconds": timeout_seconds,
            },
            default=str,
        ),
    )


def _consume_manual_stop_request(run_id: int) -> bool:
    with _manual_stop_lock:
        if run_id in _manual_stop_requested:
            _manual_stop_requested.discard(run_id)
            return True
        return False


def _truncate_text(text: str, max_chars: int = LOG_STDERR_MAX) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}...[truncated {len(text) - max_chars} chars]"


def _run_start_context(
    run: SystemAgentRun,
    agent: SystemAgent,
    *,
    timeout_seconds: int,
    sigterm_grace_seconds: int,
    sigkill_grace_seconds: int,
    cwd: str,
    payload: dict | None,
) -> dict:
    return {
        "run_id": run.id,
        "agent_id": agent.id,
        "agent_name": agent.name,
        "department": agent.department,
        "model": agent.model,
        "runtime": "pydantic-ai+litellm",
        "trigger_source": run.trigger_source.value,
        "timeout_seconds": timeout_seconds,
        "timeout_soft_cancel_grace_seconds": sigterm_grace_seconds,
        "timeout_hard_stop_grace_seconds": sigkill_grace_seconds,
        "timeout_soft_cancel_at_seconds": timeout_seconds + sigterm_grace_seconds,
        "timeout_hard_stop_at_seconds": timeout_seconds + sigkill_grace_seconds,
        "cwd": cwd,
        "run_dir": run.run_dir,
        "prompt_path": run.prompt_path,
        "log_path": run.log_path,
        "has_payload": payload is not None,
        "command": f"AgentRuntime model={agent.model}",
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
        log_file.write("=== STDOUT ===\n")


def _write_run_log_finish(
    log_path: Path,
    *,
    returncode: int,
    duration_seconds: float,
    status: RunStatus,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    estimated_cost_usd: float | None = None,
    error_message: str | None = None,
    extra_notes: str | None = None,
) -> None:
    with open(log_path, "a", encoding="utf-8") as log_file:
        log_file.write("\n=== STDERR ===\n(empty)\n")
        # Events are already streamed into === STDOUT === via on_event — no transcript replay.
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


def _installed_package_version(name: str) -> str:
    try:
        return package_version(name)
    except PackageNotFoundError:
        return "not installed"


def build_system_tools_instructions(agent_name: str, department: str) -> str:
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    playwright_version = _installed_package_version("playwright")
    browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")
    venv_dir = f"{department}/{agent_name}/.venv"
    if playwright_version == "not installed":
        private_playwright = (
            f"`{venv_dir}/bin/pip install playwright` then `{venv_dir}/bin/playwright install chromium`"
        )
    else:
        private_playwright = f"`{venv_dir}/bin/pip install playwright=={playwright_version}`"
    return "\n".join(
        [
            "# System",
            "",
            "Ubuntu 24.04. OS libraries are already in the image — do not apt-get or run `playwright install-deps`.",
            "",
            "Use the `run_shell` tool for shell commands (python, venv, playwright scripts).",
            "Use MCP tools for workspace files, memory, database, email, and WhatsApp.",
            "",
            f"## python3 ({python_version})",
            "- `python3` and `python` are on PATH. Use them to run scripts.",
            "- Do not `pip install` into this interpreter (it is the platform venv).",
            "",
            "## venv",
            f"- Create an isolated env in your workspace: `python3 -m venv {venv_dir}`",
            f"- Install packages there: `{venv_dir}/bin/pip install <package>`",
            f"- Run with `{venv_dir}/bin/python script.py`",
            "",
            f"## playwright ({playwright_version})",
            "- Python package is installed. Chromium (with JavaScript) is pre-downloaded.",
            f"- Browser binaries live at `{browsers_path}` (`PLAYWRIGHT_BROWSERS_PATH`).",
            "- Launch headless Chromium; page JS runs in the browser:",
            "",
            "```python",
            "from playwright.sync_api import sync_playwright",
            "",
            "with sync_playwright() as p:",
            "    browser = p.chromium.launch(headless=True)",
            "    page = browser.new_page()",
            "    page.goto('https://example.com')",
            "    page.wait_for_load_state('networkidle')",
            "    html = page.content()",
            "    browser.close()",
            "```",
            "",
            f"- In a private venv, install the same Playwright version so Chromium is reused: {private_playwright}",
            "- Do not run `playwright install-deps`. Run `playwright install chromium` only if the package version differs.",
        ]
    )


def build_timeout_instructions(
    timeout_seconds: int,
    soft_cancel_grace_seconds: int,
    *,
    require_run_summary: bool,
) -> str:
    soft_cancel_at = max(1, int(timeout_seconds)) + max(0, int(soft_cancel_grace_seconds))
    lines = [
        "# Time limit",
        "",
        f"Configured timeout: {format_timeout_seconds(timeout_seconds)} ({timeout_seconds}s).",
        f"Soft cancel ends this run after {format_remaining_duration(soft_cancel_at)} "
        f"from start ({timeout_seconds}s + {soft_cancel_grace_seconds}s grace).",
        "After soft cancel you will not get another model turn.",
        "Each model request includes the time remaining until soft cancel.",
    ]
    if require_run_summary:
        lines.append(
            "If less than one minute remains, write summary.md immediately and finish — "
            "do not start new work."
        )
    else:
        lines.append("If less than one minute remains, finish your reply promptly.")
    return "\n".join(lines)


def build_run_summary_instructions(summary_path: str) -> str:
    return "\n".join(
        [
            "# Run output (required)",
            "",
            "Before you finish this run, you MUST write a markdown summary to this exact path:",
            f"`{summary_path}`",
            "",
            "If soft cancel is near (less than one minute remaining), write the summary immediately and stop other work.",
            "After soft cancel you will not get another turn to write it.",
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


def build_prompt(
    agent: SystemAgent,
    payload: dict | None = None,
    *,
    summary_path: str | None = None,
    timeout_seconds: int,
    soft_cancel_grace_seconds: int,
) -> str:
    lines = [
        "# Agent configuration",
        f"Name: {agent.name}",
        f"Department: {agent.department}",
        f"Model: {agent.model}",
        f"Cron: {agent.crond or '(none)'}",
        f"Timeout: {format_timeout_seconds(timeout_seconds)} ({timeout_seconds}s)",
        "",
        build_timeout_instructions(
            timeout_seconds,
            soft_cancel_grace_seconds,
            require_run_summary=summary_path is not None,
        ),
        "",
        build_system_tools_instructions(agent.name, agent.department),
        "",
        build_agent_db_instructions(
            agent_name=agent.name,
            department=agent.department,
            db_user=agent.db_user,
        ),
        "",
        build_memory_instructions(agent.department, agent.name),
        "",
        "# Input files",
        read_prompt_inputs(agent.department, agent.name),
    ]
    whatsapp = build_whatsapp_instructions(agent.department)
    if whatsapp:
        lines.extend(["", whatsapp])
    email = build_email_instructions(agent.department)
    if email:
        lines.extend(["", email])
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
        agent = db.session.get(SystemAgent, run.agent_id) if run.agent_id is not None else None
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

        ensure_agent_folder(agent.department, agent.name)
        paths = ensure_run_folder(agent.department, agent.name, started_at, run.id)
        run.run_dir = paths["run_dir"]
        run.prompt_path = paths["prompt_path"]
        run.log_path = paths["log_path"]
        db.session.commit()

        log_path = safe_path(paths["log_path"])
        timeout_seconds = agent.timeout_seconds or 300
        sigterm_grace_seconds = get_timeout_sigterm_grace_seconds()
        sigkill_grace_seconds = get_timeout_sigkill_grace_seconds()
        prompt = build_prompt(
            agent,
            payload,
            summary_path=paths["summary_path"],
            timeout_seconds=timeout_seconds,
            soft_cancel_grace_seconds=sigterm_grace_seconds,
        )
        safe_path(paths["prompt_path"]).write_text(prompt, encoding="utf-8")
        cwd = str(workspace_root())
        start_context = _run_start_context(
            run,
            agent,
            timeout_seconds=timeout_seconds,
            sigterm_grace_seconds=sigterm_grace_seconds,
            sigkill_grace_seconds=sigkill_grace_seconds,
            cwd=cwd,
            payload=payload,
        )
        _write_run_log_start(log_path, start_context)
        _log_run_start(start_context)
        _register_run_timeout(run.id, timeout_seconds)

        def on_event(line: str) -> None:
            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write(line)
                log_file.write("\n")
                log_file.flush()

        runtime = AgentRuntime()
        try:
            result = runtime.run_sync(
                model_id=agent.model,
                prompt=prompt,
                agent_name=agent.name,
                department=agent.department,
                run_id=run.id,
                cwd=cwd,
                timeout_seconds=timeout_seconds,
                soft_cancel_grace_seconds=sigterm_grace_seconds,
                hard_timeout_grace_seconds=sigkill_grace_seconds,
                handle_key=_run_handle_key(run.id),
                on_event=on_event,
            )
        finally:
            _unregister_run_timeout(run.id)

        manual_stop = _consume_manual_stop_request(run.id)
        summary_path = safe_path(paths["summary_path"])
        tokens_in = result.tokens_in
        tokens_out = result.tokens_out
        estimated_cost = result.estimated_cost_usd
        duration_seconds = result.duration_seconds

        status = RunStatus.success
        error_message = None
        exit_note = None
        returncode = 0

        if result.timed_out and result.error and "hard stop" in (result.error or ""):
            status = RunStatus.failed
            error_message = RUN_FAILED_MESSAGE
            returncode = 137
            exit_note = _enforcement_note(
                timeout_seconds,
                sigterm_grace_seconds=sigterm_grace_seconds,
                sigkill_grace_seconds=sigkill_grace_seconds,
                soft_cancelled=True,
                hard_stopped=True,
            )
        elif result.timed_out or (result.cancelled and not manual_stop and result.error and "timeout" in (result.error or "").lower()):
            if _summary_written(summary_path):
                exit_note = (
                    f"{_enforcement_note(timeout_seconds, sigterm_grace_seconds=sigterm_grace_seconds, sigkill_grace_seconds=sigkill_grace_seconds, soft_cancelled=True, hard_stopped=False)}; "
                    "summary.md written after cancel"
                )
            else:
                status = RunStatus.failed
                error_message = RUN_FAILED_MESSAGE
                returncode = 143
                exit_note = (
                    f"{_enforcement_note(timeout_seconds, sigterm_grace_seconds=sigterm_grace_seconds, sigkill_grace_seconds=sigkill_grace_seconds, soft_cancelled=True, hard_stopped=False)}; "
                    "summary.md missing"
                )
        elif result.cancelled or manual_stop:
            if _summary_written(summary_path):
                exit_note = "Cancelled by user; summary.md written"
            else:
                status = RunStatus.failed
                error_message = RUN_FAILED_MESSAGE
                returncode = 143
                exit_note = "Cancelled by user; summary.md missing"
        elif result.error:
            status = RunStatus.failed
            error_message = RUN_FAILED_MESSAGE
            returncode = 1
            exit_note = result.error
        elif not _summary_written(summary_path):
            status = RunStatus.failed
            error_message = RUN_FAILED_MESSAGE
            returncode = 1
            exit_note = "summary.md missing"

        _write_run_log_finish(
            log_path,
            returncode=returncode,
            duration_seconds=duration_seconds,
            status=status,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            estimated_cost_usd=estimated_cost,
            error_message=error_message,
            extra_notes=exit_note,
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
                "detail": exit_note,
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
        agent = db.session.get(SystemAgent, run.agent_id) if run.agent_id is not None else None
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
        agent_name=agent.name,
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


def stop_run(run_id: int) -> SystemAgentRun:
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Run not found", 404)
    if run.status != RunStatus.running:
        raise APIClientError("Run is not running", 400)

    handle = get_active_handle(_run_handle_key(run_id))
    if handle is None:
        raise APIClientError("Run process is not active", 409)

    with _manual_stop_lock:
        _manual_stop_requested.add(run_id)

    if run.log_path:
        log_path = safe_path(run.log_path)
        if log_path.exists():
            with open(log_path, "a", encoding="utf-8") as log_file:
                log_file.write("\n=== MANUAL STOP ===\nCancel requested by user\n")
                log_file.flush()

    cancel_active_handle(_run_handle_key(run_id))
    logger.info(
        "AGENT_RUN_STOP %s",
        json.dumps(
            {
                "run_id": run.id,
                "agent_id": run.agent_id,
            },
            default=str,
        ),
    )
    return run
