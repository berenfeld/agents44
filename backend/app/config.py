import os
from pathlib import Path
from urllib.parse import quote_plus

from app.env_file import PROJECT_ROOT, load_env_file

load_env_file()


def _resolve_project_path(value: str | None, default: Path) -> str:
    if value:
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
    else:
        path = default
    return str(path.resolve())


def _database_url() -> str:
    user = os.getenv("PSQL_USER", "agents44")
    password = os.getenv("PSQL_PASSWORD", "agents44")
    host = os.getenv("PSQL_HOST", "localhost")
    port = os.getenv("PSQL_PORT", "5432")
    db = os.getenv("PSQL_DB", "agents44")
    # SQLAlchemy 2.1 made postgresql:// use psycopg v3; we ship psycopg2-binary.
    return f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{db}"


def _parse_supported_models(raw: str) -> list[str]:
    models: list[str] = []
    for part in raw.replace("\n", ",").split(","):
        model = part.strip()
        if model and model not in models:
            models.append(model)
    return models


_DEFAULT_SUPPORTED_MODELS = [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-haiku-4-5-20251001",
    "gemini/gemini-2.5-flash",
    "gemini/gemini-2.5-pro",
]


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret")
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Recycle pooled connections; pre-ping avoids 500s after PostgreSQL restarts.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }
    WORKSPACE_PATH = _resolve_project_path(os.getenv("WORKSPACE_PATH"), PROJECT_ROOT / ".workspace")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_APP_PASSWORD = os.getenv("SMTP_APP_PASSWORD", "")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@catch44.co.il")
    DEV_LOGIN_EMAIL = os.getenv("DEV_LOGIN_EMAIL", "").strip()
    DEV_LOGIN_PASSWORD = os.getenv("DEV_LOGIN_PASSWORD", "")
    # LLM provider API keys live in Settings (system_params), not Config/.env.
    DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "anthropic/claude-sonnet-4-6")
    SUPPORTED_MODELS_CONFIG = _parse_supported_models(
        os.getenv("SUPPORTED_MODELS", ",".join(_DEFAULT_SUPPORTED_MODELS))
    )
    LITELLM_PROXY_PORT = int(os.getenv("LITELLM_PROXY_PORT", "4000"))
    LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "agents44-litellm-local")
    FLASK_ENV = os.getenv("FLASK_ENV", "")
    DEBUG = os.getenv("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("FRONTEND_URL", "").strip().lower().startswith("https://")
    SUPPORTED_MODELS: list[str] = []
    DEFAULT_MODEL_RESOLVED: str = ""
    RUNTIME_DIR = _resolve_project_path(os.getenv("RUNTIME_DIR"), PROJECT_ROOT / ".dev" / "runtime")
    LOG_DIR = _resolve_project_path(os.getenv("LOG_DIR"), PROJECT_ROOT / ".dev" / "logs")
    MCP_PORT = int(os.getenv("MCP_PORT", "5001"))
