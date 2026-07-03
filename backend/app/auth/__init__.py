import logging
from functools import wraps

from flask import jsonify, request, session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.config import Config
from app.errors import APIClientError
from app.services.params import get_param_json

logger = logging.getLogger(__name__)


def dev_login_allowed() -> bool:
    return bool(Config.DEV_LOGIN_EMAIL)


def dev_login_config():
    return jsonify({"enabled": dev_login_allowed(), "email": Config.DEV_LOGIN_EMAIL})


def dev_login():
    if not dev_login_allowed():
        raise APIClientError("Not available", 404)
    payload = request.get_json(force=True) or {}
    email = (payload.get("email") or "").strip()
    password = payload.get("password") or ""
    if email != Config.DEV_LOGIN_EMAIL or password != Config.DEV_LOGIN_PASSWORD:
        raise APIClientError("Invalid credentials", 401)
    session["user_email"] = email
    return jsonify({"authenticated": True, "email": email})


def google_login_config():
    return jsonify(
        {
            "enabled": bool(Config.GOOGLE_CLIENT_ID),
            "clientId": Config.GOOGLE_CLIENT_ID,
        }
    )


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_email"):
            raise APIClientError("Authentication required", 401)
        return f(*args, **kwargs)

    return wrapper


def auth_google():
    if not Config.GOOGLE_CLIENT_ID:
        raise APIClientError("Google login is not configured", 500)
    payload = request.get_json(force=True) or {}
    token = payload.get("credential") or payload.get("id_token")
    if not token:
        raise APIClientError("Missing Google credential", 400)
    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            Config.GOOGLE_CLIENT_ID,
        )
    except ValueError as exc:
        logger.warning("Google token verification failed: %s", exc)
        raise APIClientError("Invalid Google credential", 401) from exc
    email = idinfo.get("email")
    if not email:
        raise APIClientError("Google account has no email", 400)
    allowed = get_param_json("ALLOWED_EMAILS", []) or []
    if allowed and email not in allowed:
        raise APIClientError("Email is not allowed", 403)
    session["user_email"] = email
    return jsonify({"authenticated": True, "email": email})


def auth_me():
    if not session.get("user_email"):
        raise APIClientError("Authentication required", 401)
    return jsonify({"authenticated": True, "email": session["user_email"]})


def auth_logout():
    session.clear()
    return jsonify({"ok": True})
