import json

from flask import Blueprint, current_app, jsonify, request

from app.auth import (
    auth_google,
    auth_logout,
    auth_me,
    dev_login,
    dev_login_config,
    google_login_config,
    login_required,
)
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemParam
from app.services.litellm_proxy import start_litellm_proxy
from app.services.model_registry import init_model_registry, normalize_model_id
from app.services.params import (
    format_supported_models,
    normalize_secret_value,
    parse_supported_models,
    pretty_json_value,
)

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


HIDDEN_PARAM_KEYS = frozenset({"ALLOWED_EMAILS"})
JSON_PARAM_KEYS = frozenset({"MODEL_PRICING", "SUPPORTED_MODELS"})


def _param_to_dict(row: SystemParam) -> dict:
    data = row.to_dict()
    if row.key in JSON_PARAM_KEYS:
        pretty = pretty_json_value(row.value or "", sort_keys=(row.key == "MODEL_PRICING"))
        if pretty is not None:
            data["value"] = pretty
    return data


@params_bp.get("")
@api_endpoint
@login_required
def list_params():
    rows = (
        SystemParam.query.filter(SystemParam.key.notin_(HIDDEN_PARAM_KEYS))
        .order_by(SystemParam.key)
        .all()
    )
    return jsonify([_param_to_dict(row) for row in rows])


@params_bp.put("")
@api_endpoint
@login_required
def update_params():
    payload = request.get_json(force=True) or {}
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise APIClientError("items must be a list", 400)

    # Validate all inputs before mutating.
    normalized: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            raise APIClientError("Each settings item must be an object", 400)
        key = item.get("key")
        if not key or key in HIDDEN_PARAM_KEYS:
            continue
        value = item.get("value", "")
        if value is None:
            value = ""
        value = str(value)
        if key == "SUPPORTED_MODELS":
            models = [normalize_model_id(m) for m in parse_supported_models(value)]
            models = [m for m in models if m]
            if not models:
                raise APIClientError("SUPPORTED_MODELS must list at least one model", 400)
            # Dedupe preserving order.
            unique: list[str] = []
            for model in models:
                if model not in unique:
                    unique.append(model)
            value = format_supported_models(unique)
        elif key == "MODEL_PRICING":
            try:
                parsed = json.loads(value) if value.strip() else {}
            except json.JSONDecodeError as exc:
                raise APIClientError(f"MODEL_PRICING must be valid JSON: {exc.msg}", 400) from exc
            if not isinstance(parsed, dict):
                raise APIClientError("MODEL_PRICING must be a JSON object", 400)
            value = json.dumps(parsed, indent=2, sort_keys=True)
        elif key.endswith("_API_KEY"):
            value = normalize_secret_value(value)
        normalized.append(
            {
                "key": key,
                "value": value,
                "description": item.get("description"),
            }
        )

    for item in normalized:
        key = item["key"]
        row = SystemParam.query.filter_by(key=key).first()
        if row:
            row.value = item["value"]
            if item["description"] is not None:
                row.description = item["description"]
        else:
            db.session.add(
                SystemParam(key=key, value=item["value"], description=item.get("description"))
            )

    db.session.flush()
    app = current_app._get_current_object()
    # Remap agents if allowlist changed. Keys/allowlist for LiteLLM are read from DB per request.
    init_model_registry(app)
    if not current_app.config.get("LITELLM_STARTED"):
        start_litellm_proxy(app)

    rows = (
        SystemParam.query.filter(SystemParam.key.notin_(HIDDEN_PARAM_KEYS))
        .order_by(SystemParam.key)
        .all()
    )
    return jsonify([_param_to_dict(row) for row in rows])