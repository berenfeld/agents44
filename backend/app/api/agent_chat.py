from flask import Blueprint, jsonify, request, session
from marshmallow import EXCLUDE, Schema, fields, pre_load, validate
from sqlalchemy.orm import joinedload, selectinload

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgent, SystemAgentChatConversation
from app.models.agent_chat_conversation import DEFAULT_CONVERSATION_TITLE, MAX_CONVERSATION_TITLE_LEN
from app.services.agent_chat import (
    archive_conversation,
    conversation_is_busy,
    create_conversation,
    pending_ids_by_conversation,
    send_message,
    stop_chat,
    unarchive_conversation,
)

agent_chat_bp = Blueprint("agent_chat", __name__)


class ConversationCreateSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    agent_id = fields.Int(required=True)
    title = fields.Str(load_default=None, allow_none=True, validate=validate.Length(min=1, max=MAX_CONVERSATION_TITLE_LEN))


class ConversationUpdateSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    agent_id = fields.Int()
    title = fields.Str(validate=validate.Length(min=1, max=MAX_CONVERSATION_TITLE_LEN))


class ChatMessageSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    content = fields.Str(required=True, validate=validate.Length(min=1, max=100000))

    @pre_load
    def strip_content(self, data, **kwargs):
        if not isinstance(data, dict):
            return data
        payload = dict(data)
        if isinstance(payload.get("content"), str):
            payload["content"] = payload["content"].strip()
        return payload


def _conversation_or_404(conversation_id: int) -> SystemAgentChatConversation:
    conversation = (
        SystemAgentChatConversation.query.options(
            joinedload(SystemAgentChatConversation.agent),
            selectinload(SystemAgentChatConversation.messages),
        )
        .filter_by(id=conversation_id)
        .first()
    )
    if not conversation:
        raise APIClientError("Conversation not found", 404)
    return conversation


def _parse_archived_flag() -> bool:
    raw = (request.args.get("archived") or "").strip().lower()
    return raw in {"1", "true", "yes"}


@agent_chat_bp.get("/conversations")
@api_endpoint
@login_required
def list_conversations():
    archived = _parse_archived_flag()
    query = SystemAgentChatConversation.query.options(joinedload(SystemAgentChatConversation.agent))
    if archived:
        query = query.filter(SystemAgentChatConversation.archived_at.isnot(None)).order_by(
            SystemAgentChatConversation.archived_at.desc()
        )
    else:
        query = query.filter(SystemAgentChatConversation.archived_at.is_(None)).order_by(
            SystemAgentChatConversation.id.asc()
        )
    conversations = query.all()
    busy_ids = pending_ids_by_conversation([row.id for row in conversations])
    return jsonify([row.to_dict(busy=row.id in busy_ids) for row in conversations])


@agent_chat_bp.post("/conversations")
@api_endpoint
@login_required
def create_conversation_route():
    data = ConversationCreateSchema().load(request.get_json(force=True) or {})
    title = data.get("title")
    if isinstance(title, str):
        title = title.strip() or None
    conversation = create_conversation(
        agent_id=data["agent_id"],
        created_by=session.get("user_email"),
        title=title,
    )
    conversation = _conversation_or_404(conversation.id)
    return jsonify(conversation.to_dict(include_messages=True, busy=False)), 201


@agent_chat_bp.get("/conversations/<int:conversation_id>")
@api_endpoint
@login_required
def get_conversation(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    return jsonify(conversation.to_dict(include_messages=True))


@agent_chat_bp.patch("/conversations/<int:conversation_id>")
@api_endpoint
@login_required
def update_conversation(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    data = ConversationUpdateSchema().load(request.get_json(force=True) or {})
    if "agent_id" in data:
        if conversation.archived_at is not None:
            raise APIClientError("Conversation is archived", 400)
        agent = db.session.get(SystemAgent, data["agent_id"])
        if not agent:
            raise APIClientError("Agent not found", 404)
        if conversation_is_busy(conversation.id):
            raise APIClientError("Agent is still responding", 409)
        conversation.agent_id = agent.id
        conversation.agent_name = agent.name
    if "title" in data:
        conversation.title = data["title"].strip() or DEFAULT_CONVERSATION_TITLE
    db.session.flush()
    conversation = _conversation_or_404(conversation.id)
    return jsonify(conversation.to_dict(include_messages=True))


@agent_chat_bp.post("/conversations/<int:conversation_id>/archive")
@api_endpoint
@login_required
def archive_conversation_route(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    archive_conversation(conversation)
    db.session.flush()
    conversation = _conversation_or_404(conversation.id)
    return jsonify(conversation.to_dict(include_messages=True))


@agent_chat_bp.post("/conversations/<int:conversation_id>/unarchive")
@api_endpoint
@login_required
def unarchive_conversation_route(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    unarchive_conversation(conversation)
    db.session.flush()
    conversation = _conversation_or_404(conversation.id)
    return jsonify(conversation.to_dict(include_messages=True))


@agent_chat_bp.post("/conversations/<int:conversation_id>/messages")
@api_endpoint
@login_required
def post_message(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    data = ChatMessageSchema().load(request.get_json(force=True) or {})
    send_message(conversation, data["content"])
    conversation = _conversation_or_404(conversation_id)
    return jsonify(conversation.to_dict(include_messages=True)), 202


@agent_chat_bp.post("/conversations/<int:conversation_id>/stop")
@api_endpoint
@login_required
def stop_conversation(conversation_id: int):
    conversation = _conversation_or_404(conversation_id)
    stop_chat(conversation)
    conversation = _conversation_or_404(conversation_id)
    return jsonify(conversation.to_dict(include_messages=True))
