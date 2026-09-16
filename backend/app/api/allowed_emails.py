from flask import Blueprint, jsonify, request
from marshmallow import EXCLUDE, Schema, fields, validate

from app.auth import login_required
from app.errors import api_endpoint
from app.services.allowed_emails import add_allowed_email, delete_allowed_email, list_allowed_emails

allowed_emails_bp = Blueprint("allowed_emails", __name__)


class AllowedEmailSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    email = fields.Str(required=True, validate=validate.Length(min=1, max=254))


@allowed_emails_bp.get("")
@api_endpoint
@login_required
def list_allowed_emails_route():
    return jsonify([row.to_dict() for row in list_allowed_emails()])


@allowed_emails_bp.post("")
@api_endpoint
@login_required
def add_allowed_email_route():
    data = AllowedEmailSchema().load(request.get_json(force=True) or {})
    row = add_allowed_email(data["email"])
    return jsonify(row.to_dict()), 201


@allowed_emails_bp.delete("/<int:row_id>")
@api_endpoint
@login_required
def delete_allowed_email_route(row_id: int):
    delete_allowed_email(row_id)
    return jsonify({"ok": True})
