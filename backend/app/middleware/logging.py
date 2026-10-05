import json
import logging
import time
from functools import wraps

from flask import g, request, session

logger = logging.getLogger("api")

FIELD_MAX = 200
BODY_LOG_MAX = 256
SENSITIVE_KEY_MARKERS = (
    "password",
    "passwd",
    "secret",
    "token",
    "credential",
    "authorization",
    "api_key",
    "apikey",
)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in SENSITIVE_KEY_MARKERS)


def truncate_json(obj, field_max: int = FIELD_MAX):
    def _truncate_value(value, key: str | None = None):
        if key and _is_sensitive_key(key):
            return "[redacted]"
        if isinstance(value, dict):
            return {k: _truncate_value(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [_truncate_value(v) for v in value]
        if isinstance(value, str) and len(value) > field_max:
            return f"{value[:field_max]}...[truncated {len(value) - field_max} chars]"
        return value

    return _truncate_value(obj)


def _body_for_log(body) -> str | None:
    """Serialize request/response body for logs, capped at BODY_LOG_MAX chars."""
    if body is None:
        return None
    serialized = json.dumps(truncate_json(body), default=str)
    if len(serialized) <= BODY_LOG_MAX:
        return serialized
    return f"{serialized[:BODY_LOG_MAX]}...[truncated {len(serialized) - BODY_LOG_MAX} chars]"


def _current_user() -> str:
    return session.get("user_email", "anonymous")


def log_api_request():
    body = None
    if request.is_json:
        body = request.get_json(silent=True)
    elif request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        body = {}
    payload = {
        "method": request.method,
        "path": request.path,
        "user": _current_user(),
        "body": _body_for_log(body),
    }
    logger.info("REQ %s", json.dumps(payload, default=str))
    g._req_start = time.time()


def log_api_response(response):
    duration_ms = int((time.time() - g.get("_req_start", time.time())) * 1000)
    resp_body = None
    if response.is_json:
        resp_body = response.get_json(silent=True)
    payload = {
        "method": request.method,
        "path": request.path,
        "user": _current_user(),
        "status": response.status_code,
        "duration_ms": duration_ms,
        "body": _body_for_log(resp_body),
    }
    serialized = json.dumps(payload, default=str)
    if response.status_code >= 400:
        logger.error("RES %s", serialized)
    else:
        logger.info("RES %s", serialized)
    return response


def api_logged(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        log_api_request()
        response = f(*args, **kwargs)
        return log_api_response(response)

    return wrapper
