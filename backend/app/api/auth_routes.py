from flask import Blueprint, jsonify, request

from app.auth import (
    auth_google,
    auth_logout,
    auth_me,
    dev_login,
    dev_login_config,
    google_login_config,
    login_required,
)
from app.errors import api_endpoint
from app.extensions import db
from app.models import SystemParam

auth_bp = Blueprint("auth", __name__)
params_bp = Blueprint("system_params", __name__)


@auth_bp.get("/google/config")
@api_endpoint
def google_config_route():
    return google_login_config()


@auth_bp.post("/google")
@api_endpoint
def google_route():
    return auth_google()


@auth_bp.get("/me")
@api_endpoint
def me():
    return auth_me()


@auth_bp.post("/logout")
@api_endpoint
def logout():
    return auth_logout()


@auth_bp.get("/dev-login/config")
@api_endpoint
def dev_login_config_route():
    return dev_login_config()


@auth_bp.post("/dev-login")
@api_endpoint
def dev_login_route():
    return dev_login()


@params_bp.get("")
@api_endpoint
@login_required
def list_params():
    rows = SystemParam.query.order_by(SystemParam.key).all()
    return jsonify([row.to_dict() for row in rows])


@params_bp.put("")
@api_endpoint
@login_required
def update_params():
    payload = request.get_json(force=True) or {}
    items = payload.get("items", [])
    for item in items:
        key = item.get("key")
        if not key:
            continue
        row = SystemParam.query.filter_by(key=key).first()
        if row:
            row.value = item.get("value", row.value)
            row.description = item.get("description", row.description)
        else:
            db.session.add(
                SystemParam(key=key, value=item.get("value", ""), description=item.get("description"))
            )
    db.session.commit()
    rows = SystemParam.query.order_by(SystemParam.key).all()
    return jsonify([row.to_dict() for row in rows])
