import os
from pathlib import Path

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


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "postgresql://agents44:agents44@localhost:5432/agents44"
    )
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
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "")
    FLASK_ENV = os.getenv("FLASK_ENV", "")
    DEBUG = os.getenv("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    SUPPORTED_MODELS: list[str] = []
    DEFAULT_MODEL_RESOLVED: str = ""
    RUNTIME_DIR = _resolve_project_path(os.getenv("RUNTIME_DIR"), PROJECT_ROOT / ".dev" / "runtime")
    MCP_PORT = int(os.getenv("MCP_PORT", "5001"))
