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
    return f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{db}"


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret")
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    WORKSPACE_PATH = _resolve_project_path(os.getenv("WORKSPACE_PATH"), PROJECT_ROOT / ".workspace")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
    OAUTH_REDIRECT_URI = os.getenv(
        "OAUTH_REDIRECT_URI", "http://localhost:5000/api/auth/callback"
    )
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_APP_PASSWORD = os.getenv("SMTP_APP_PASSWORD", "")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@catch44.co.il")
    DEV_LOGIN_EMAIL = os.getenv("DEV_LOGIN_EMAIL", "").strip()
    DEV_LOGIN_PASSWORD = os.getenv("DEV_LOGIN_PASSWORD", "")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "")
    FLASK_ENV = os.getenv("FLASK_ENV", "")
    DEBUG = os.getenv("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    SUPPORTED_MODELS: list[str] = []
    DEFAULT_MODEL_RESOLVED: str = ""
    RUNTIME_DIR = _resolve_project_path(os.getenv("RUNTIME_DIR"), PROJECT_ROOT / ".dev" / "runtime")
    LOG_DIR = _resolve_project_path(os.getenv("LOG_DIR"), PROJECT_ROOT / ".dev" / "logs")
    MCP_PORT = int(os.getenv("MCP_PORT", "5001"))
