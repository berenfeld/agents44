from flask import Blueprint, jsonify, request
from marshmallow import Schema, fields, validate

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgent, SystemDepartment
from app.services.workspace import ensure_department_folder, validate_department_name

departments_bp = Blueprint("departments", __name__)


class DepartmentSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=128))


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

    row = SystemDepartment(name=name)
    db.session.add(row)
    db.session.commit()
    ensure_department_folder(name)
    return jsonify(row.to_dict()), 201


@departments_bp.delete("/<int:department_id>")
@api_endpoint
@login_required
def delete_department(department_id: int):
    row = db.session.get(SystemDepartment, department_id)
    if not row:
        raise APIClientError("Not found", 404)
    if SystemAgent.query.filter_by(department=row.name).first():
        raise APIClientError("Department is in use by one or more agents", 400)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"deleted": department_id})
