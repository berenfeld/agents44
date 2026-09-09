import logging
import os
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from sqlalchemy import func
from sqlalchemy.orm import joinedload, selectinload

from app.errors import APIClientError
from app.extensions import db
from app.models import (
    SystemAgent,
    SystemDepartment,
    SystemWhatsAppConversation,
    SystemWhatsAppMessage,
    WhatsAppMessageDirection,
)

logger = logging.getLogger(__name__)

ISRAELI_LOCAL_RE = re.compile(r"^05[0-9]{8}$")
ISRAELI_E164_RE = re.compile(r"^9725[0-9]{8}$")
WEBHOOK_EVENT_TYPES = {"message", "messagereceived"}
MAX_MESSAGE_TEXT_LEN = 4096
LAST_MESSAGE_PREVIEW_CHARS = 120


def digits_only(raw: str) -> str:
    return re.sub(r"\D", "", raw or "")


def normalize_israeli_mobile(raw: str) -> str:
    digits = digits_only(raw)
    if ISRAELI_LOCAL_RE.fullmatch(digits):
        return "972" + digits[1:]
    if ISRAELI_E164_RE.fullmatch(digits):
        return digits
    raise APIClientError("WhatsApp from number must be an Israeli mobile (05X... or +9725...)", 400)


def normalize_destination_number(raw: str) -> str:
    digits = digits_only(raw)
    if ISRAELI_LOCAL_RE.fullmatch(digits):
        return "972" + digits[1:]
    if not digits or len(digits) < 8 or len(digits) > 15:
        raise APIClientError("WhatsApp number is invalid", 400)
    return digits


def phone_filter_clause(column, raw: str):
    digits = digits_only((raw or "").strip())
    if not digits:
        return None
    if ISRAELI_LOCAL_RE.fullmatch(digits):
        return column == ("972" + digits[1:])
    if ISRAELI_E164_RE.fullmatch(digits):
        return column == digits
    return column.contains(digits)


def validate_wati_api_endpoint(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        raise APIClientError("WATI API endpoint is required", 400)
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise APIClientError("WATI API endpoint must be an http(s) URL", 400)
    return f"{parsed.scheme}://{parsed.netloc}"


def validate_wati_api_token(raw: str) -> str:
    value = (raw or "").strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    if not value:
        raise APIClientError("WATI API token is required", 400)
    if len(value) > 2048:
        raise APIClientError("WATI API token is too long", 400)
    return value


def department_whatsapp_provisioned(department: SystemDepartment) -> bool:
    return department.wati_configured()


def webhook_public_url(secret: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
    return f"{base}/api/webhooks/wati/{secret}"


def provision_department_whatsapp(
    department: SystemDepartment,
    *,
    from_number: str,
    wati_api_endpoint: str,
    wati_api_token: str,
) -> SystemDepartment:
    if department_whatsapp_provisioned(department):
        raise APIClientError("WhatsApp is already provisioned for this department", 400)

    stored_number = normalize_israeli_mobile(from_number)
    endpoint = validate_wati_api_endpoint(wati_api_endpoint)
    token = validate_wati_api_token(wati_api_token)

    taken = (
        SystemDepartment.query.filter(
            SystemDepartment.whatsapp_from_number == stored_number,
            SystemDepartment.id != department.id,
        ).first()
    )
    if taken:
        raise APIClientError("This WhatsApp number is already used by another department", 400)

    department.whatsapp_from_number = stored_number
    department.wati_api_endpoint = endpoint
    department.wati_api_token = token
    department.wati_webhook_secret = secrets.token_urlsafe(32)
    return department


def unprovision_department_whatsapp(department: SystemDepartment) -> None:
    if not department_whatsapp_provisioned(department):
        raise APIClientError("WhatsApp is not provisioned for this department", 400)
    department.whatsapp_from_number = None
    department.wati_api_endpoint = None
    department.wati_api_token = None
    department.wati_webhook_secret = None


def _department_for_agent(agent: SystemAgent) -> SystemDepartment:
    department = SystemDepartment.query.filter_by(name=agent.department).first()
    if not department:
        raise APIClientError("Department not found", 404)
    if not department_whatsapp_provisioned(department):
        raise APIClientError("Department is not provisioned for WhatsApp", 400)
    return department


def _wati_send(department: SystemDepartment, to_number: str, message_text: str) -> str | None:
    url = f"{department.wati_api_endpoint}/api/v1/sendSessionMessage/{to_number}"
    try:
        response = requests.post(
            url,
            params={
                "messageText": message_text,
                "channelPhoneNumber": department.whatsapp_from_number,
            },
            headers={"Authorization": f"Bearer {department.wati_api_token}"},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise APIClientError("Could not reach WATI", 400) from exc

    if response.status_code >= 400:
        detail = _wati_error_detail(response)
        raise APIClientError(detail or "WhatsApp send failed", 400)

    payload = _json_object(response)
    if payload.get("result") in {"error", False} or payload.get("ok") is False:
        detail = _wati_payload_error(payload)
        raise APIClientError(detail or "WhatsApp send failed", 400)
    return _wati_outbound_message_id(payload)


def _json_object(response: requests.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _wati_error_detail(response: requests.Response) -> str | None:
    payload = _json_object(response)
    return _wati_payload_error(payload)


def _wati_payload_error(payload: dict) -> str | None:
    for key in ("info", "message", "error", "errorMessage"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:300]
    return None


def _wati_outbound_message_id(payload: dict) -> str | None:
    for key in ("whatsappMessageId", "id", "localMessageId"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:256]
    message = payload.get("message")
    if isinstance(message, dict):
        for key in ("whatsappMessageId", "id"):
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:256]
    return None


def _get_or_create_conversation(
    *,
    agent: SystemAgent,
    from_number: str,
    to_number: str,
) -> SystemWhatsAppConversation:
    conversation = SystemWhatsAppConversation.query.filter_by(
        from_number=from_number,
        to_number=to_number,
    ).first()
    if conversation:
        if conversation.agent_id != agent.id:
            raise APIClientError("This WhatsApp number already belongs to another agent", 400)
        return conversation
    conversation = SystemWhatsAppConversation(
        agent_id=agent.id,
        from_number=from_number,
        to_number=to_number,
    )
    db.session.add(conversation)
    db.session.flush()
    return conversation


def send_whatsapp(agent: SystemAgent, to_number: str, message_text: str) -> dict:
    text = (message_text or "").strip()
    if not text:
        raise APIClientError("Message text is required", 400)
    if len(text) > MAX_MESSAGE_TEXT_LEN:
        raise APIClientError("Message text is too long", 400)

    department = _department_for_agent(agent)
    destination = normalize_destination_number(to_number)
    wati_message_id = _wati_send(department, destination, text)

    conversation = _get_or_create_conversation(
        agent=agent,
        from_number=department.whatsapp_from_number or "",
        to_number=destination,
    )
    now = datetime.now(timezone.utc)
    conversation.updated_at = now
    message = SystemWhatsAppMessage(
        conversation_id=conversation.id,
        direction=WhatsAppMessageDirection.outbound,
        body=text,
        wati_message_id=wati_message_id,
    )
    db.session.add(message)
    db.session.flush()
    return {"conversation_id": conversation.id, "message_id": message.id}


def list_agent_whatsapp_conversations(agent_id: int) -> list[dict]:
    rows = (
        SystemWhatsAppConversation.query.options(selectinload(SystemWhatsAppConversation.messages))
        .filter_by(agent_id=agent_id)
        .order_by(SystemWhatsAppConversation.updated_at.desc())
        .all()
    )
    return [row.to_agent_dict() for row in rows]


def _preview_text(body: str) -> str:
    one_line = " ".join((body or "").split())
    if len(one_line) <= LAST_MESSAGE_PREVIEW_CHARS:
        return one_line
    return f"{one_line[:LAST_MESSAGE_PREVIEW_CHARS]}..."


def list_operator_whatsapp_conversations(
    *,
    department: str | None = None,
    agent_id: int | None = None,
    from_number: str | None = None,
    to_number: str | None = None,
) -> list[dict]:
    query = SystemWhatsAppConversation.query.options(joinedload(SystemWhatsAppConversation.agent))
    if department:
        query = query.filter(SystemWhatsAppConversation.agent.has(department=department))
    if agent_id is not None:
        query = query.filter(SystemWhatsAppConversation.agent_id == agent_id)
    from_clause = phone_filter_clause(SystemWhatsAppConversation.from_number, from_number or "")
    if from_clause is not None:
        query = query.filter(from_clause)
    to_clause = phone_filter_clause(SystemWhatsAppConversation.to_number, to_number or "")
    if to_clause is not None:
        query = query.filter(to_clause)

    rows = query.order_by(SystemWhatsAppConversation.updated_at.desc()).all()
    previews = _last_message_previews([row.id for row in rows])
    return [row.to_list_dict(last_message_preview=previews.get(row.id)) for row in rows]


def _last_message_previews(conversation_ids: list[int]) -> dict[int, str]:
    if not conversation_ids:
        return {}
    last_ids = dict(
        db.session.query(
            SystemWhatsAppMessage.conversation_id,
            func.max(SystemWhatsAppMessage.id),
        )
        .filter(SystemWhatsAppMessage.conversation_id.in_(conversation_ids))
        .group_by(SystemWhatsAppMessage.conversation_id)
        .all()
    )
    if not last_ids:
        return {}
    messages = SystemWhatsAppMessage.query.filter(SystemWhatsAppMessage.id.in_(last_ids.values())).all()
    return {message.conversation_id: _preview_text(message.body) for message in messages}


def get_operator_whatsapp_conversation(conversation_id: int) -> SystemWhatsAppConversation:
    conversation = (
        SystemWhatsAppConversation.query.options(
            joinedload(SystemWhatsAppConversation.agent),
            selectinload(SystemWhatsAppConversation.messages),
        )
        .filter_by(id=conversation_id)
        .first()
    )
    if not conversation:
        raise APIClientError("Conversation not found", 404)
    return conversation


def _inbound_body(payload: dict) -> str:
    text = payload.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    msg_type = payload.get("type")
    if isinstance(msg_type, str) and msg_type.strip() and msg_type.strip().lower() != "text":
        return f"[{msg_type.strip()}]"
    return ""


def _webhook_event_type(payload: dict) -> str:
    raw = payload.get("eventType") or payload.get("event") or ""
    return str(raw).strip().lower()


def ingest_wati_webhook(secret: str, payload: dict) -> dict:
    department = SystemDepartment.query.filter_by(wati_webhook_secret=secret).first()
    if not department or not department_whatsapp_provisioned(department):
        raise APIClientError("Not found", 404)

    event_type = _webhook_event_type(payload)
    if event_type not in WEBHOOK_EVENT_TYPES:
        return {"ok": True, "ignored": True}

    if payload.get("owner") is True:
        return {"ok": True, "ignored": True}

    try:
        from_number = normalize_destination_number(str(payload.get("channelPhoneNumber") or ""))
        to_number = normalize_destination_number(str(payload.get("waId") or ""))
    except APIClientError:
        return {"ok": True, "ignored": True}

    conversation = SystemWhatsAppConversation.query.filter_by(
        from_number=from_number,
        to_number=to_number,
    ).first()
    if not conversation:
        logger.info(
            "WATI inbound ignored; no conversation for from=%s to=%s",
            from_number,
            to_number,
        )
        return {"ok": True, "ignored": True}

    wati_message_id = None
    for key in ("whatsappMessageId", "id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            wati_message_id = value.strip()[:256]
            break

    if wati_message_id:
        existing = SystemWhatsAppMessage.query.filter_by(wati_message_id=wati_message_id).first()
        if existing:
            return {"ok": True, "ignored": True}

    body = _inbound_body(payload)
    now = datetime.now(timezone.utc)
    conversation.updated_at = now
    message = SystemWhatsAppMessage(
        conversation_id=conversation.id,
        direction=WhatsAppMessageDirection.inbound,
        body=body,
        wati_message_id=wati_message_id,
    )
    db.session.add(message)
    db.session.flush()

    agent = db.session.get(SystemAgent, conversation.agent_id)
    trigger_payload = {
        "whatsapp": {
            "conversation_id": conversation.id,
            "from_number": conversation.from_number,
            "to_number": conversation.to_number,
            "message_id": message.id,
            "text": body,
        }
    }
    if not agent or not agent.enabled:
        logger.info(
            "WATI inbound stored; agent %s is missing or disabled",
            conversation.agent_id,
        )
        return {"ok": True, "triggered": False, "payload": trigger_payload}

    return {
        "ok": True,
        "triggered": True,
        "agent_id": agent.id,
        "payload": trigger_payload,
    }


def build_whatsapp_instructions(department_name: str) -> str:
    department = SystemDepartment.query.filter_by(name=department_name).first()
    if not department or not department_whatsapp_provisioned(department):
        return ""
    from_number = department.whatsapp_from_number or ""
    return "\n".join(
        [
            "# WhatsApp",
            "",
            f"This department can send WhatsApp from `{from_number}`.",
            "Use `send_whatsapp` to send a session message and `list_whatsapp_conversations` to load this agent's threads.",
            "Do not read or write WhatsApp tables with `read_db` / `write_db`.",
            "",
            "When the trigger payload contains `whatsapp`, call `list_whatsapp_conversations`, find the new inbound message, and reply with `send_whatsapp`.",
            "Only this agent's conversations are visible.",
            "Website links belong in `message_text` as full `https://` URLs on their own line (see the `send_whatsapp` tool description).",
        ]
    )
