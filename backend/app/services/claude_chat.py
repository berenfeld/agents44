import json
import logging
import queue
import threading
from datetime import datetime, timezone

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
from app.services.agent_runtime import AgentRuntime
from app.services.agent_runtime.runtime import cancel_active_handle, get_active_handle
from app.services.db_provisioning import build_agent_db_instructions
from app.services.outbound_email import build_email_instructions
from app.services.params import (
    get_timeout_sigkill_grace_seconds,
    get_timeout_sigterm_grace_seconds,
)
from app.services.whatsapp import build_whatsapp_instructions
from app.services.workspace import build_memory_instructions, read_prompt_inputs, workspace_root

logger = logging.getLogger(__name__)

_chat_queue: queue.Queue = queue.Queue()
_worker_started = False
_manual_stop_requested: set[int] = set()
_manual_stop_lock = threading.Lock()

CHAT_FAILED_MESSAGE = "Claude failed to reply"
TITLE_PREVIEW_CHARS = 48


def _chat_handle_key(message_id: int) -> str:
    return f"chat:{message_id}"


def _title_from_prompt(content: str) -> str:
    one_line = " ".join(content.split())
    if len(one_line) <= TITLE_PREVIEW_CHARS:
        return one_line[:MAX_CONVERSATION_TITLE_LEN] or DEFAULT_CONVERSATION_TITLE
    return f"{one_line[:TITLE_PREVIEW_CHARS]}..."


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
    lines.extend(
        [
            "",
            "# Conversation",
            "You are chatting with the platform operator. Reply to the latest user message.",
            "Previous turns are included for context. Do not write a run summary file.",
            "Use tools when they help answer the operator.",
            "",
        ]
    )
    for message in messages:
        if message.status != ClaudeMessageStatus.complete:
            continue
        if message.role == ClaudeMessageRole.user:
            lines.extend(["## User", message.content, ""])
        elif message.role == ClaudeMessageRole.assistant and message.content.strip():
            lines.extend(["## Assistant", message.content, ""])
    return "\n".join(lines).strip() + "\n"


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
        if conversation.agent_id is None:
            _mark_message_failed(message, "Agent not found")
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
                    "runtime": "pydantic-ai+litellm",
                    "timeout_seconds": timeout_seconds,
                },
                default=str,
            ),
        )

        runtime = AgentRuntime()
        result = runtime.run_sync(
            model_id=agent.model,
            prompt=prompt,
            agent_name=agent.name,
            department=agent.department,
            run_id=0,
            conversation_id=conversation.id,
            cwd=cwd,
            timeout_seconds=timeout_seconds,
            soft_cancel_grace_seconds=sigterm_grace_seconds,
            hard_timeout_grace_seconds=sigkill_grace_seconds,
            handle_key=_chat_handle_key(message.id),
        )
        manual_stop = _consume_manual_stop_request(message.id)
        reply = result.output

        status = ClaudeMessageStatus.complete
        error_message = None
        detail = None

        if result.timed_out and result.error and "hard stop" in (result.error or ""):
            status = ClaudeMessageStatus.failed
            error_message = CHAT_FAILED_MESSAGE
            detail = f"Exceeded timeout ({timeout_seconds}s); hard stop"
        elif result.timed_out or (result.cancelled and not manual_stop):
            if reply:
                detail = "Timed out after partial reply"
            else:
                status = ClaudeMessageStatus.failed
                error_message = CHAT_FAILED_MESSAGE
                detail = f"Exceeded timeout ({timeout_seconds}s)"
        elif result.cancelled or manual_stop:
            if reply:
                detail = "Stopped after partial reply"
            else:
                status = ClaudeMessageStatus.failed
                error_message = CHAT_FAILED_MESSAGE
                detail = "Stopped by user"
        elif result.error:
            status = ClaudeMessageStatus.failed
            error_message = CHAT_FAILED_MESSAGE
            detail = result.error

        message.content = reply
        message.status = status
        message.error_message = error_message
        message.tokens_in = result.tokens_in
        message.tokens_out = result.tokens_out
        message.estimated_cost_usd = result.estimated_cost_usd
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
                    "duration_seconds": round(result.duration_seconds, 3),
                    "tokens_in": result.tokens_in,
                    "tokens_out": result.tokens_out,
                    "estimated_cost_usd": result.estimated_cost_usd,
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
        agent_name=agent.name,
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
    if conversation.agent_id is None:
        raise APIClientError("This conversation's agent was deleted", 400)
    conversation.archived_at = None
    conversation.updated_at = datetime.now(timezone.utc)
    return conversation


def send_message(conversation: SystemClaudeConversation, content: str) -> SystemClaudeConversation:
    _ensure_worker()
    if conversation.archived_at is not None:
        raise APIClientError("Conversation is archived", 400)
    if conversation.agent_id is None:
        raise APIClientError("This conversation's agent was deleted", 400)
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

    handle = get_active_handle(_chat_handle_key(pending.id))
    if handle is None:
        raise APIClientError("Claude process is not active", 409)

    with _manual_stop_lock:
        _manual_stop_requested.add(pending.id)
    cancel_active_handle(_chat_handle_key(pending.id))
    logger.info(
        "CLAUDE_CHAT_STOP %s",
        json.dumps(
            {
                "message_id": pending.id,
                "conversation_id": conversation.id,
            },
            default=str,
        ),
    )
    return conversation
