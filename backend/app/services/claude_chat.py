import json
import logging
import os
import queue
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app

from app.errors import APIClientError
from app.extensions import db
from app.models import (
    ClaudeMessageRole,
    ClaudeMessageStatus,
    SystemAgent,
    SystemClaudeConversation,
    SystemClaudeMessage,
)
from app.models.claude_conversation import DEFAULT_CONVERSATION_TITLE, MAX_CONVERSATION_TITLE_LEN
from app.services.agent_runner import build_system_tools_instructions
from app.services.db_provisioning import build_agent_db_instructions
from app.services.model_registry import claude_result_is_error, extract_claude_text, parse_claude_result
from app.services.params import (
    get_claude_cli_extra_args,
    get_timeout_sigkill_grace_seconds,
    get_timeout_sigterm_grace_seconds,
)
from app.services.workspace import build_memory_instructions, read_prompt_inputs, workspace_root

logger = logging.getLogger(__name__)

_chat_queue: queue.Queue = queue.Queue()
_worker_started = False
_active_procs: dict[int, subprocess.Popen] = {}
_active_procs_lock = threading.Lock()
_manual_stop_requested: set[int] = set()
_manual_stop_lock = threading.Lock()

CHAT_FAILED_MESSAGE = "Claude failed to reply"
TITLE_PREVIEW_CHARS = 48


@dataclass(frozen=True)
class ClaudeChatSubprocessResult:
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float
    sigterm_sent: bool
    sigkill_sent: bool


def _title_from_prompt(content: str) -> str:
    one_line = " ".join(content.split())
    if len(one_line) <= TITLE_PREVIEW_CHARS:
        return one_line[:MAX_CONVERSATION_TITLE_LEN] or DEFAULT_CONVERSATION_TITLE
    return f"{one_line[:TITLE_PREVIEW_CHARS]}..."


def _signal_process_group(proc: subprocess.Popen, sig: signal.Signals) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, sig)
    except ProcessLookupError:
        pass


def _register_active_proc(message_id: int, proc: subprocess.Popen) -> None:
    with _active_procs_lock:
        _active_procs[message_id] = proc


def _unregister_active_proc(message_id: int) -> None:
    with _active_procs_lock:
        _active_procs.pop(message_id, None)


def _get_active_proc(message_id: int) -> subprocess.Popen | None:
    with _active_procs_lock:
        return _active_procs.get(message_id)


def _consume_manual_stop_request(message_id: int) -> bool:
    with _manual_stop_lock:
        if message_id in _manual_stop_requested:
            _manual_stop_requested.discard(message_id)
            return True
        return False


def conversation_is_busy(conversation_id: int) -> bool:
    pending = SystemClaudeMessage.query.filter_by(
        conversation_id=conversation_id,
        status=ClaudeMessageStatus.pending,
    ).first()
    return pending is not None


def pending_ids_by_conversation(conversation_ids: list[int]) -> set[int]:
    if not conversation_ids:
        return set()
    rows = (
        db.session.query(SystemClaudeMessage.conversation_id)
        .filter(
            SystemClaudeMessage.conversation_id.in_(conversation_ids),
            SystemClaudeMessage.status == ClaudeMessageStatus.pending,
        )
        .all()
    )
    return {row[0] for row in rows}


def build_chat_prompt(agent: SystemAgent, messages: list[SystemClaudeMessage]) -> str:
    lines = [
        "# Agent configuration",
        f"Name: {agent.name}",
        f"Department: {agent.department}",
        f"Model: {agent.model}",
        "",
        build_system_tools_instructions(agent.name),
        "",
        build_agent_db_instructions(
            agent_name=agent.name,
            department=agent.department,
            db_user=agent.db_user,
        ),
        "",
        build_memory_instructions(agent.name),
        "",
        "# Input files",
        read_prompt_inputs(agent.department, agent.name),
        "",
        "# Conversation",
        "You are chatting with the platform operator. Reply to the latest user message.",
        "Previous turns are included for context. Do not write a run summary file.",
        "Use tools when they help answer the operator.",
        "",
    ]
    for message in messages:
        if message.status != ClaudeMessageStatus.complete:
            continue
        if message.role == ClaudeMessageRole.user:
            lines.extend(["## User", message.content, ""])
        elif message.role == ClaudeMessageRole.assistant and message.content.strip():
            lines.extend(["## Assistant", message.content, ""])
    return "\n".join(lines).strip() + "\n"


def _run_claude_chat_subprocess(
    message_id: int,
    cmd: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout_seconds: int,
    sigterm_grace_seconds: int,
    sigkill_grace_seconds: int,
) -> ClaudeChatSubprocessResult:
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        start_new_session=True,
    )
    _register_active_proc(message_id, proc)

    try:
        def read_stdout() -> None:
            if not proc.stdout:
                return
            for line in proc.stdout:
                stdout_parts.append(line)

        def read_stderr() -> None:
            if not proc.stderr:
                return
            for line in proc.stderr:
                stderr_parts.append(line)

        stdout_thread = threading.Thread(target=read_stdout, daemon=True, name="claude-chat-stdout")
        stderr_thread = threading.Thread(target=read_stderr, daemon=True, name="claude-chat-stderr")
        stdout_thread.start()
        stderr_thread.start()

        started = time.monotonic()
        sigterm_sent = False
        sigkill_sent = False
        sigterm_at = timeout_seconds + sigterm_grace_seconds
        sigkill_at = timeout_seconds + sigkill_grace_seconds

        while proc.poll() is None:
            elapsed = time.monotonic() - started
            if elapsed >= sigkill_at:
                _signal_process_group(proc, signal.SIGKILL)
                sigkill_sent = True
                break
            if elapsed >= sigterm_at and not sigterm_sent:
                _signal_process_group(proc, signal.SIGTERM)
                sigterm_sent = True
            time.sleep(0.5)

        returncode = proc.wait()
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        duration_seconds = time.monotonic() - started
    finally:
        _unregister_active_proc(message_id)

    return ClaudeChatSubprocessResult(
        returncode=returncode,
        stdout="".join(stdout_parts),
        stderr="".join(stderr_parts),
        duration_seconds=duration_seconds,
        sigterm_sent=sigterm_sent,
        sigkill_sent=sigkill_sent,
    )


def _mark_message_failed(message: SystemClaudeMessage, detail: str) -> None:
    message.status = ClaudeMessageStatus.failed
    message.error_message = CHAT_FAILED_MESSAGE
    message.finished_at = datetime.now(timezone.utc)
    if not message.content:
        message.content = ""
    db.session.commit()
    logger.error(
        "CLAUDE_CHAT_END %s",
        json.dumps(
            {
                "message_id": message.id,
                "conversation_id": message.conversation_id,
                "status": message.status.value,
                "detail": detail,
            },
            default=str,
        ),
    )


def _execute_chat(assistant_message_id: int) -> None:
    from app import get_app

    app = get_app()
    with app.app_context():
        message = db.session.get(SystemClaudeMessage, assistant_message_id)
        if not message or message.status != ClaudeMessageStatus.pending:
            return
        conversation = db.session.get(SystemClaudeConversation, message.conversation_id)
        if not conversation:
            _mark_message_failed(message, "Conversation not found")
            return
        agent = db.session.get(SystemAgent, conversation.agent_id)
        if not agent:
            _mark_message_failed(message, "Agent not found")
            return

        history = (
            SystemClaudeMessage.query.filter_by(conversation_id=conversation.id)
            .order_by(SystemClaudeMessage.id.asc())
            .all()
        )
        prompt = build_chat_prompt(agent, history)

        if not shutil.which("claude"):
            _mark_message_failed(message, "Claude CLI is not installed")
            return

        runtime_dir = Path(current_app.config["RUNTIME_DIR"])
        runtime_dir.mkdir(parents=True, exist_ok=True)
        mcp_config_path = runtime_dir / f"mcp-chat-{message.id}.json"
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
                                "X-Run-Id": "0",
                                "X-Conversation-Id": str(conversation.id),
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
        env["IS_SANDBOX"] = "1"

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
        sigterm_grace_seconds = get_timeout_sigterm_grace_seconds()
        sigkill_grace_seconds = get_timeout_sigkill_grace_seconds()
        cwd = str(workspace_root())

        logger.info(
            "CLAUDE_CHAT_START %s",
            json.dumps(
                {
                    "message_id": message.id,
                    "conversation_id": conversation.id,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "model": agent.model,
                    "timeout_seconds": timeout_seconds,
                },
                default=str,
            ),
        )

        result = _run_claude_chat_subprocess(
            message.id,
            cmd,
            cwd=cwd,
            env=env,
            timeout_seconds=timeout_seconds,
            sigterm_grace_seconds=sigterm_grace_seconds,
            sigkill_grace_seconds=sigkill_grace_seconds,
        )
        manual_stop = _consume_manual_stop_request(message.id)
        reply = extract_claude_text(result.stdout)
        tokens_in, tokens_out, estimated_cost = parse_claude_result(result.stdout, agent.model)

        status = ClaudeMessageStatus.complete
        error_message = None
        detail = None

        if result.sigkill_sent:
            status = ClaudeMessageStatus.failed
            error_message = CHAT_FAILED_MESSAGE
            detail = f"Exceeded timeout ({timeout_seconds}s); SIGKILL sent"
        elif result.sigterm_sent or manual_stop:
            if reply:
                detail = "Stopped after partial reply" if manual_stop else "Timed out after partial reply"
            else:
                status = ClaudeMessageStatus.failed
                error_message = CHAT_FAILED_MESSAGE
                detail = "Stopped by user" if manual_stop else f"Exceeded timeout ({timeout_seconds}s); SIGTERM sent"
        elif claude_result_is_error(result.stdout):
            status = ClaudeMessageStatus.failed
            error_message = CHAT_FAILED_MESSAGE
            detail = reply or "Claude returned an error"
        elif result.returncode != 0:
            if reply:
                detail = f"Claude CLI exited with code {result.returncode}"
            else:
                status = ClaudeMessageStatus.failed
                error_message = CHAT_FAILED_MESSAGE
                detail = f"Claude CLI exited with code {result.returncode}"

        message.content = reply
        message.status = status
        message.error_message = error_message
        message.tokens_in = tokens_in
        message.tokens_out = tokens_out
        message.estimated_cost_usd = estimated_cost
        message.finished_at = datetime.now(timezone.utc)
        conversation.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        logger.info(
            "CLAUDE_CHAT_END %s",
            json.dumps(
                {
                    "message_id": message.id,
                    "conversation_id": conversation.id,
                    "agent_id": agent.id,
                    "status": status.value,
                    "exit_code": result.returncode,
                    "duration_seconds": round(result.duration_seconds, 3),
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "estimated_cost_usd": estimated_cost,
                    "error_message": error_message,
                    "detail": detail,
                },
                default=str,
            ),
        )


def _fail_chat_from_worker(message_id: int, detail: str | None = None) -> None:
    from app import get_app

    app = get_app()
    with app.app_context():
        message = db.session.get(SystemClaudeMessage, message_id)
        if not message or message.status != ClaudeMessageStatus.pending:
            return
        _mark_message_failed(message, detail or "Chat worker failed unexpectedly")


def _worker_loop() -> None:
    while True:
        message_id = _chat_queue.get()
        try:
            _execute_chat(message_id)
        except Exception as exc:
            logger.exception("Claude chat worker failed for message %s", message_id)
            _fail_chat_from_worker(message_id, detail=str(exc))
        finally:
            _chat_queue.task_done()


def _ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    thread = threading.Thread(target=_worker_loop, daemon=True, name="claude-chat-worker")
    thread.start()
    _worker_started = True


def create_conversation(agent_id: int, created_by: str | None, title: str | None = None) -> SystemClaudeConversation:
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Agent not found", 404)
    if not agent.enabled:
        raise APIClientError("Agent is disabled", 400)
    conversation = SystemClaudeConversation(
        title=(title or DEFAULT_CONVERSATION_TITLE).strip() or DEFAULT_CONVERSATION_TITLE,
        agent_id=agent.id,
        created_by=created_by,
    )
    db.session.add(conversation)
    db.session.flush()
    return conversation


def archive_conversation(conversation: SystemClaudeConversation) -> SystemClaudeConversation:
    if conversation.archived_at is not None:
        raise APIClientError("Conversation is already archived", 400)
    conversation.archived_at = datetime.now(timezone.utc)
    conversation.updated_at = datetime.now(timezone.utc)
    return conversation


def unarchive_conversation(conversation: SystemClaudeConversation) -> SystemClaudeConversation:
    if conversation.archived_at is None:
        raise APIClientError("Conversation is not archived", 400)
    conversation.archived_at = None
    conversation.updated_at = datetime.now(timezone.utc)
    return conversation


def send_message(conversation: SystemClaudeConversation, content: str) -> SystemClaudeConversation:
    _ensure_worker()
    if conversation.archived_at is not None:
        raise APIClientError("Conversation is archived", 400)
    agent = db.session.get(SystemAgent, conversation.agent_id)
    if not agent:
        raise APIClientError("Agent not found", 404)
    if not agent.enabled:
        raise APIClientError("Agent is disabled", 400)
    if conversation_is_busy(conversation.id):
        raise APIClientError("Claude is still responding", 409)

    if conversation.title == DEFAULT_CONVERSATION_TITLE:
        conversation.title = _title_from_prompt(content)
    conversation.updated_at = datetime.now(timezone.utc)

    user_message = SystemClaudeMessage(
        conversation_id=conversation.id,
        role=ClaudeMessageRole.user,
        status=ClaudeMessageStatus.complete,
        content=content,
        finished_at=datetime.now(timezone.utc),
    )
    assistant_message = SystemClaudeMessage(
        conversation_id=conversation.id,
        role=ClaudeMessageRole.assistant,
        status=ClaudeMessageStatus.pending,
        content="",
    )
    db.session.add(user_message)
    db.session.add(assistant_message)
    db.session.commit()
    _chat_queue.put(assistant_message.id)
    db.session.refresh(conversation)
    return conversation


def stop_chat(conversation: SystemClaudeConversation) -> SystemClaudeConversation:
    pending = (
        SystemClaudeMessage.query.filter_by(
            conversation_id=conversation.id,
            status=ClaudeMessageStatus.pending,
        )
        .order_by(SystemClaudeMessage.id.desc())
        .first()
    )
    if not pending:
        raise APIClientError("Claude is not responding", 400)

    proc = _get_active_proc(pending.id)
    if proc is None:
        raise APIClientError("Claude process is not active", 409)

    with _manual_stop_lock:
        _manual_stop_requested.add(pending.id)
    _signal_process_group(proc, signal.SIGTERM)
    logger.info(
        "CLAUDE_CHAT_STOP %s",
        json.dumps(
            {
                "message_id": pending.id,
                "conversation_id": conversation.id,
                "pid": proc.pid,
            },
            default=str,
        ),
    )
    return conversation
