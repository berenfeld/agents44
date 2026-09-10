from flask import Blueprint, after_this_request, jsonify, request
from marshmallow import EXCLUDE, Schema, fields

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.models import EmailSendingStatus
from app.services.outbound_email import (
    get_operator_email,
    list_operator_emails,
    update_operator_email,
    wake_email_sender,
)

emails_bp = Blueprint("emails", __name__)


class EmailUpdateSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    from_email = fields.Str()
    subject = fields.Str()
    recipients = fields.Raw()
    cc = fields.Raw()
    bcc = fields.Raw()
    message = fields.Str()
    content_type = fields.Str()
    sending_status = fields.Str()


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


@emails_bp.get("")
@api_endpoint
@login_required
def list_emails():
    agent_id = _optional_int(request.args.get("agent_id"))
    address = (request.args.get("address") or "").strip() or None
    subject = (request.args.get("subject") or "").strip() or None
    content = (request.args.get("content") or "").strip() or None
    rows = list_operator_emails(
        agent_id=agent_id,
        address=address,
        subject=subject,
        content=content,
    )
    return jsonify(rows)


@emails_bp.get("/<int:message_id>")
@api_endpoint
@login_required
def get_email(message_id: int):
    row = get_operator_email(message_id)
    return jsonify(row.to_dict())


@emails_bp.patch("/<int:message_id>")
@api_endpoint
@login_required
def patch_email(message_id: int):
    row = get_operator_email(message_id)
    data = EmailUpdateSchema().load(request.get_json(force=True) or {})
    if not data:
        raise APIClientError("No fields to update", 400)
    updated = update_operator_email(row, data)
    if updated.sending_status == EmailSendingStatus.pending:

        @after_this_request
        def _wake(response):
            wake_email_sender()
            return response

    return jsonify(updated.to_dict())
