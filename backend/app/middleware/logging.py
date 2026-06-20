import json
import logging
import time
from functools import wraps

from flask import g, request, session

logger = logging.getLogger("api")

FIELD_MAX = 200
MAX_LOG_BYTES = 8192


def truncate_json(obj, field_max: int = FIELD_MAX, max_bytes: int = MAX_LOG_BYTES):
    def _truncate_value(value):
        if isinstance(value, dict):
            return {k: _truncate_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_truncate_value(v) for v in value]
        if isinstance(value, str) and len(value) > field_max:
            return f"{value[:field_max]}...[truncated {len(value) - field_max} chars]"
        return value

    truncated = _truncate_value(obj)
    serialized = json.dumps(truncated, default=str)
    if len(serialized) <= max_bytes:
        return truncated
    return truncated


def _current_user() -> str:
    return session.get("user_email", "anonymous")


def log_api_request():
    body = None
    if request.is_json:
        body = request.get_json(silent=True)
    elif request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        body = {}
    payload = truncate_json(
        {"method": request.method, "path": request.path, "user": _current_user(), "body": body}
    )
    logger.info("REQ %s", json.dumps(payload, default=str))
    g._req_start = time.time()


def log_api_response(response):
    duration_ms = int((time.time() - g.get("_req_start", time.time())) * 1000)
    resp_body = None
    if response.is_json:
        resp_body = response.get_json(silent=True)
    payload = truncate_json(
        {
            "method": request.method,
            "path": request.path,
            "user": _current_user(),
            "status": response.status_code,
            "duration_ms": duration_ms,
            "body": resp_body,
        }
    )
    serialized = json.dumps(payload, default=str)
    if response.status_code >= 500:
        logger.error("RES %s", serialized)
    elif response.status_code >= 400:
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
