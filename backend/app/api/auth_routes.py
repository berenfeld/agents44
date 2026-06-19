from flask import Blueprint, jsonify, request

from app.auth import auth_callback, auth_google, auth_logout, auth_me, login_required
from app.errors import api_endpoint
from app.extensions import db
from app.models import SystemParam

auth_bp = Blueprint("auth", __name__)
params_bp = Blueprint("system_params", __name__)


@api_endpoint
def _google():
    return auth_google()


@api_endpoint
def _callback():
    return auth_callback()


auth_bp.add_url_rule("/google", view_func=_google, methods=["GET"])
auth_bp.add_url_rule("/callback", view_func=_callback, methods=["GET"])


@auth_bp.get("/me")
@api_endpoint
def me():
    return auth_me()


@auth_bp.post("/logout")
@api_endpoint
def logout():
    return auth_logout()


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
