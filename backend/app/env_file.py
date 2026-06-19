from pathlib import Path

from dotenv import load_dotenv

# Repository / app root (parent of backend/). Production: /opt/agents44
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"

_loaded = False


def load_env_file() -> Path:
    global _loaded
    if not _loaded:
        load_dotenv(ENV_FILE)
        _loaded = True
    return ENV_FILE
