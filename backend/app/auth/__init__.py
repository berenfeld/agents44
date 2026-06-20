import logging
import os
from functools import wraps

from flask import jsonify, redirect, request, session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow

from app.config import Config
from app.errors import APIClientError
from app.services.params import get_param_json

logger = logging.getLogger(__name__)

OAUTH_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]

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


def _oauth_flow() -> Flow:
    client_config = {
        "web": {
            "client_id": Config.GOOGLE_CLIENT_ID,
            "client_secret": Config.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=OAUTH_SCOPES,
        redirect_uri=Config.OAUTH_REDIRECT_URI,
    )


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_email"):
            raise APIClientError("Authentication required", 401)
        return f(*args, **kwargs)

    return wrapper


def auth_google():
    if not Config.GOOGLE_CLIENT_ID or not Config.GOOGLE_CLIENT_SECRET:
        raise APIClientError("Google OAuth is not configured", 500)
    flow = _oauth_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )
    session["oauth_state"] = state
    return redirect(authorization_url)


def auth_callback():
    flow = _oauth_flow()
    flow.fetch_token(authorization_response=request.url)
    credentials = flow.credentials
    idinfo = id_token.verify_oauth2_token(
        credentials.id_token,
        google_requests.Request(),
        Config.GOOGLE_CLIENT_ID,
    )
    email = idinfo.get("email")
    allowed = get_param_json("ALLOWED_EMAILS", []) or []
    if allowed and email not in allowed:
        raise APIClientError("Email is not allowed", 403)
    session["user_email"] = email
    return redirect(os.getenv("FRONTEND_URL", "http://localhost:3000/"))


def auth_me():
    if not session.get("user_email"):
        raise APIClientError("Authentication required", 401)
    return jsonify({"authenticated": True, "email": session["user_email"]})


def auth_logout():
    session.clear()
    return jsonify({"ok": True})
