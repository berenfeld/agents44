from flask import Blueprint, jsonify, request
from marshmallow import EXCLUDE, Schema, fields, validate
from sqlalchemy import func

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgent, SystemDepartment
from app.services.db_provisioning import (
    create_department_schema,
    drop_department_schema,
    refresh_all_cross_grants,
)
from app.services.whatsapp import (
    provision_department_whatsapp,
    unprovision_department_whatsapp,
    webhook_public_url,
)
from app.services.workspace import ensure_department_folder, validate_department_name

departments_bp = Blueprint("departments", __name__)


class DepartmentSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    name = fields.Str(required=True, validate=validate.Length(min=1, max=128))


class WhatsAppProvisionSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    from_number = fields.Str(required=True, validate=validate.Length(min=1, max=32))
    wati_api_endpoint = fields.Str(required=True, validate=validate.Length(min=1, max=256))
    wati_api_token = fields.Str(required=True, validate=validate.Length(min=1, max=2048))


def _department_or_404(department_id: int) -> SystemDepartment:
    row = db.session.get(SystemDepartment, department_id)
    if not row:
        raise APIClientError("Not found", 404)
    return row


@departments_bp.get("")
@api_endpoint
@login_required
def list_departments():
    rows = SystemDepartment.query.order_by(SystemDepartment.name).all()
    return jsonify([row.to_dict() for row in rows])


@departments_bp.post("")
@api_endpoint
@login_required
def create_department():
    data = DepartmentSchema().load(request.get_json(force=True) or {})
    name = validate_department_name(data["name"])
    if SystemDepartment.query.filter_by(name=name).first():
        raise APIClientError("Department already exists", 400)
    if SystemAgent.query.filter(func.lower(SystemAgent.name) == name.lower()).first():
        raise APIClientError("Department name cannot match an agent name", 400)

    row = SystemDepartment(name=name)
    db.session.add(row)
    db.session.flush()
    conn = db.session.connection()
    create_department_schema(conn, name)
    ensure_department_folder(name)
    refresh_all_cross_grants(conn)
    return jsonify(row.to_dict()), 201


@departments_bp.post("/<int:department_id>/whatsapp")
@api_endpoint
@login_required
def provision_department_whatsapp_route(department_id: int):
    row = _department_or_404(department_id)
    data = WhatsAppProvisionSchema().load(request.get_json(force=True) or {})
    provision_department_whatsapp(
        row,
        from_number=data["from_number"],
        wati_api_endpoint=data["wati_api_endpoint"],
        wati_api_token=data["wati_api_token"],
    )
    webhook_url = webhook_public_url(row.wati_webhook_secret or "")
    return jsonify(row.to_dict(webhook_url=webhook_url)), 201


@departments_bp.delete("/<int:department_id>/whatsapp")
@api_endpoint
@login_required
def unprovision_department_whatsapp_route(department_id: int):
    row = _department_or_404(department_id)
    unprovision_department_whatsapp(row)
    return jsonify(row.to_dict())


@departments_bp.delete("/<int:department_id>")
@api_endpoint
@login_required
def delete_department(department_id: int):
    row = _department_or_404(department_id)
    if SystemAgent.query.filter_by(department=row.name).first():
        raise APIClientError("Department is in use by one or more agents", 400)

    conn = db.session.connection()
    drop_department_schema(conn, row.name)
    db.session.delete(row)
    db.session.flush()
    refresh_all_cross_grants(conn)
    return jsonify({"deleted": department_id})
