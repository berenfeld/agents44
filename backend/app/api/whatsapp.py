from flask import Blueprint, jsonify, request

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.services.whatsapp import get_operator_whatsapp_conversation, list_operator_whatsapp_conversations

whatsapp_bp = Blueprint("whatsapp", __name__)


def _optional_int(raw: str | None) -> int | None:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError:
        raise APIClientError("agent_id must be an integer", 400) from None
    if parsed < 1:
        raise APIClientError("agent_id must be an integer", 400)
    return parsed


@whatsapp_bp.get("/conversations")
@api_endpoint
@login_required
def list_whatsapp_conversations():
    agent_id = _optional_int(request.args.get("agent_id"))
    department = (request.args.get("department") or "").strip() or None
    from_number = (request.args.get("from_number") or "").strip() or None
    to_number = (request.args.get("to_number") or "").strip() or None
    rows = list_operator_whatsapp_conversations(
        department=department,
        agent_id=agent_id,
        from_number=from_number,
        to_number=to_number,
    )
    return jsonify(rows)


@whatsapp_bp.get("/conversations/<int:conversation_id>")
@api_endpoint
@login_required
def get_whatsapp_conversation(conversation_id: int):
    conversation = get_operator_whatsapp_conversation(conversation_id)
    return jsonify(conversation.to_detail_dict())
