import logging
import os
import re
import secrets
from datetime import datetime, timezone

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
PHONE_NUMBER_ID_RE = re.compile(r"^[0-9]{5,32}$")
GRAPH_API_VERSION = "v21.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
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


def validate_phone_number_id(raw: str) -> str:
    value = (raw or "").strip()
    if not PHONE_NUMBER_ID_RE.fullmatch(value):
        raise APIClientError("WhatsApp phone number ID must be the numeric ID from Meta", 400)
    return value


def validate_access_token(raw: str) -> str:
    value = (raw or "").strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    if not value:
        raise APIClientError("Meta Graph API access token is required", 400)
    if len(value) > 4096:
        raise APIClientError("Meta Graph API access token is too long", 400)
    return value


def department_whatsapp_provisioned(department: SystemDepartment) -> bool:
    return department.whatsapp_configured()


def webhook_public_url(secret: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
    return f"{base}/api/webhooks/whatsapp/{secret}"


def provision_department_whatsapp(
    department: SystemDepartment,
    *,
    from_number: str,
    phone_number_id: str,
    access_token: str,
) -> SystemDepartment:
    if department_whatsapp_provisioned(department):
        raise APIClientError("WhatsApp is already provisioned for this department", 400)

    stored_number = normalize_israeli_mobile(from_number)
    stored_phone_id = validate_phone_number_id(phone_number_id)
    token = validate_access_token(access_token)

    taken_number = SystemDepartment.query.filter(
        SystemDepartment.whatsapp_from_number == stored_number,
        SystemDepartment.id != department.id,
    ).first()
    if taken_number:
        raise APIClientError("This WhatsApp number is already used by another department", 400)

    taken_phone_id = SystemDepartment.query.filter(
        SystemDepartment.whatsapp_phone_number_id == stored_phone_id,
        SystemDepartment.id != department.id,
    ).first()
    if taken_phone_id:
        raise APIClientError("This WhatsApp phone number ID is already used by another department", 400)

    department.whatsapp_from_number = stored_number
    department.whatsapp_phone_number_id = stored_phone_id
    department.whatsapp_access_token = token
    department.whatsapp_webhook_secret = secrets.token_urlsafe(32)
    department.whatsapp_verify_token = secrets.token_urlsafe(32)
    return department


def unprovision_department_whatsapp(department: SystemDepartment) -> None:
    if not department_whatsapp_provisioned(department):
        raise APIClientError("WhatsApp is not provisioned for this department", 400)
    department.whatsapp_from_number = None
    department.whatsapp_phone_number_id = None
    department.whatsapp_access_token = None
    department.whatsapp_webhook_secret = None
    department.whatsapp_verify_token = None


def verify_whatsapp_webhook(secret: str, verify_token: str | None) -> bool:
    department = SystemDepartment.query.filter_by(whatsapp_webhook_secret=secret).first()
    if not department or not department_whatsapp_provisioned(department):
        return False
    expected = department.whatsapp_verify_token or ""
    provided = verify_token or ""
    if not expected or not provided or len(expected) != len(provided):
        return False
    return secrets.compare_digest(expected, provided)


def _department_for_agent(agent: SystemAgent) -> SystemDepartment:
    department = SystemDepartment.query.filter_by(name=agent.department).first()
    if not department:
        raise APIClientError("Department not found", 404)
    if not department_whatsapp_provisioned(department):
        raise APIClientError("Department is not provisioned for WhatsApp", 400)
    return department


def _graph_send(department: SystemDepartment, to_number: str, message_text: str) -> str | None:
    url = f"{GRAPH_API_BASE}/{department.whatsapp_phone_number_id}/messages"
    try:
        response = requests.post(
            url,
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to_number,
                "type": "text",
                "text": {"preview_url": True, "body": message_text},
            },
            headers={
                "Authorization": f"Bearer {department.whatsapp_access_token}",
                "Content-Type": "application/json",
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise APIClientError("Could not reach Meta Graph API", 400) from exc

    payload = _json_object(response)
    if response.status_code >= 400:
        raise APIClientError(_graph_error_detail(payload) or "WhatsApp send failed", 400)
    return _graph_outbound_message_id(payload)


def _json_object(response: requests.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _graph_error_detail(payload: dict) -> str | None:
    error = payload.get("error")
    if isinstance(error, dict):
        for key in ("error_user_msg", "error_user_title", "message"):
            value = error.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:300]
    if isinstance(error, str) and error.strip():
        return error.strip()[:300]
    return None


def _graph_outbound_message_id(payload: dict) -> str | None:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    first = messages[0]
    if not isinstance(first, dict):
        return None
    value = first.get("id")
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
        if conversation.agent_id is None:
            conversation.agent_id = agent.id
            conversation.agent_name = agent.name
            return conversation
        if conversation.agent_id != agent.id:
            raise APIClientError("This WhatsApp number already belongs to another agent", 400)
        return conversation
    conversation = SystemWhatsAppConversation(
        agent_id=agent.id,
        agent_name=agent.name,
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
    graph_message_id = _graph_send(department, destination, text)

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
        whatsapp_message_id=graph_message_id,
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


def _inbound_body(message: dict) -> str:
    msg_type = str(message.get("type") or "text").strip() or "text"
    if msg_type == "text":
        text = message.get("text")
        if isinstance(text, dict):
            body = text.get("body")
            if isinstance(body, str) and body.strip():
                return body.strip()
        return ""
    return f"[{msg_type}]"


def _iter_inbound_messages(payload: dict):
    if payload.get("object") not in {None, "whatsapp_business_account"}:
        return
    entries = payload.get("entry")
    if not isinstance(entries, list):
        return
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes")
        if not isinstance(changes, list):
            continue
        for change in changes:
            if not isinstance(change, dict):
                continue
            field = change.get("field")
            if field not in {None, "messages"}:
                continue
            value = change.get("value")
            if not isinstance(value, dict):
                continue
            if value.get("statuses"):
                continue
            messages = value.get("messages")
            if not isinstance(messages, list):
                continue
            metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
            for message in messages:
                if isinstance(message, dict):
                    yield metadata, message


def _store_inbound_message(department: SystemDepartment, metadata: dict, inbound: dict) -> dict | None:
    phone_number_id = str(metadata.get("phone_number_id") or "").strip()
    if phone_number_id and phone_number_id != department.whatsapp_phone_number_id:
        return None

    display = metadata.get("display_phone_number") or department.whatsapp_from_number or ""
    client = inbound.get("from") or ""
    try:
        from_number = normalize_destination_number(str(display))
        to_number = normalize_destination_number(str(client))
    except APIClientError:
        return None

    conversation = SystemWhatsAppConversation.query.filter_by(
        from_number=from_number,
        to_number=to_number,
    ).first()
    if not conversation:
        logger.info(
            "WhatsApp inbound ignored; no conversation for from=%s to=%s",
            from_number,
            to_number,
        )
        return None

    graph_message_id = inbound.get("id")
    if isinstance(graph_message_id, str) and graph_message_id.strip():
        graph_message_id = graph_message_id.strip()[:256]
        existing = SystemWhatsAppMessage.query.filter_by(whatsapp_message_id=graph_message_id).first()
        if existing:
            return None
    else:
        graph_message_id = None

    body = _inbound_body(inbound)
    conversation.updated_at = datetime.now(timezone.utc)
    message = SystemWhatsAppMessage(
        conversation_id=conversation.id,
        direction=WhatsAppMessageDirection.inbound,
        body=body,
        whatsapp_message_id=graph_message_id,
    )
    db.session.add(message)
    db.session.flush()

    agent = db.session.get(SystemAgent, conversation.agent_id) if conversation.agent_id else None
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
            "WhatsApp inbound stored; agent %s is missing or disabled",
            conversation.agent_id,
        )
        return {"ok": True, "triggered": False, "payload": trigger_payload}

    return {
        "ok": True,
        "triggered": True,
        "agent_id": agent.id,
        "payload": trigger_payload,
    }


def ingest_whatsapp_webhook(secret: str, payload: dict) -> dict:
    department = SystemDepartment.query.filter_by(whatsapp_webhook_secret=secret).first()
    if not department or not department_whatsapp_provisioned(department):
        raise APIClientError("Not found", 404)

    last: dict | None = None
    for metadata, inbound in _iter_inbound_messages(payload):
        result = _store_inbound_message(department, metadata, inbound)
        if result:
            last = result
    return last or {"ok": True, "ignored": True}


def build_whatsapp_instructions(department_name: str) -> str:
    department = SystemDepartment.query.filter_by(name=department_name).first()
    if not department or not department_whatsapp_provisioned(department):
        return ""
    from_number = department.whatsapp_from_number or ""
    return "\n".join(
        [
            "# WhatsApp",
            "",
            f"This department can send WhatsApp from `{from_number}` using the Meta Graph API.",
            "Use `send_whatsapp` to send a session message and `list_whatsapp_conversations` to load this agent's threads.",
            "Do not read or write WhatsApp tables with `read_db` / `write_db`.",
            "",
            "When the trigger payload contains `whatsapp`, call `list_whatsapp_conversations`, find the new inbound message, and reply with `send_whatsapp`.",
            "Only this agent's conversations are visible.",
            "Website links belong in `message_text` as full `https://` URLs on their own line (see the `send_whatsapp` tool description).",
        ]
    )
