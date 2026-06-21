import json
import logging

from app.extensions import db
from app.models import SystemParam

logger = logging.getLogger(__name__)

SEED_PARAMS = [
    {
        "key": "ALLOWED_EMAILS",
        "value": json.dumps([]),
        "description": "JSON array of Google emails permitted to log in",
    },
    {
        "key": "NOTIFY_ON",
        "value": "failures",
        "description": "Auto-email admin on run events: all | failures | none",
    },
    {
        "key": "MODEL_PRICING",
        "value": json.dumps(
            {
                "claude-fable-5": {
                    "input_per_million": 10.0,
                    "output_per_million": 50.0,
                },
                "claude-opus-4-8": {
                    "input_per_million": 5.0,
                    "output_per_million": 25.0,
                },
                "claude-opus-4-7": {
                    "input_per_million": 5.0,
                    "output_per_million": 25.0,
                },
                "claude-opus-4-6": {
                    "input_per_million": 5.0,
                    "output_per_million": 25.0,
                },
                "claude-opus-4-5-20251101": {
                    "input_per_million": 5.0,
                    "output_per_million": 25.0,
                },
                "claude-opus-4-1-20250805": {
                    "input_per_million": 15.0,
                    "output_per_million": 75.0,
                },
                "claude-sonnet-4-6": {
                    "input_per_million": 3.0,
                    "output_per_million": 15.0,
                },
                "claude-sonnet-4-5-20250929": {
                    "input_per_million": 3.0,
                    "output_per_million": 15.0,
                },
                "claude-haiku-4-5-20251001": {
                    "input_per_million": 1.0,
                    "output_per_million": 5.0,
                },
            }
        ),
        "description": "USD per 1M tokens by model id",
    },
    {
        "key": "CLAUDE_CLI_ARGS",
        "value": json.dumps(
            [
                "--permission-mode",
                "bypassPermissions",
                "--settings",
                json.dumps({"permissions": {"allow": ["WebSearch", "WebFetch"]}}),
            ]
        ),
        "description": (
            "Extra Claude CLI flags as a JSON array of strings, appended to every agent run "
            '(e.g. ["--permission-mode", "bypassPermissions"]). Default allows web search and fetch.'
        ),
    },
    {
        "key": "TIMEOUT_SIGTERM_GRACE_SECONDS",
        "value": "300",
        "description": (
            "Seconds after an agent's configured timeout before SIGTERM is sent "
            "(default 300 = 5 minutes)."
        ),
    },
    {
        "key": "TIMEOUT_SIGKILL_GRACE_SECONDS",
        "value": "600",
        "description": (
            "Seconds after an agent's configured timeout before SIGKILL is sent "
            "(default 600 = 10 minutes). Must be >= TIMEOUT_SIGTERM_GRACE_SECONDS."
        ),
    },
]

DEFAULT_TIMEOUT_SIGTERM_GRACE_SECONDS = 300
DEFAULT_TIMEOUT_SIGKILL_GRACE_SECONDS = 600


def get_param(key: str, default=None):
    row = SystemParam.query.filter_by(key=key).first()
    if not row:
        return default
    return row.value


def get_param_int(key: str, default: int) -> int:
    raw = get_param(key)
    if raw is None:
        return default
    try:
        value = int(str(raw).strip())
        if value < 0:
            raise ValueError("negative")
        return value
    except ValueError:
        logger.warning("Invalid integer for system param %s: %r", key, raw)
        return default


def get_timeout_sigterm_grace_seconds() -> int:
    return get_param_int("TIMEOUT_SIGTERM_GRACE_SECONDS", DEFAULT_TIMEOUT_SIGTERM_GRACE_SECONDS)


def get_timeout_sigkill_grace_seconds() -> int:
    sigterm_grace = get_timeout_sigterm_grace_seconds()
    sigkill_grace = get_param_int("TIMEOUT_SIGKILL_GRACE_SECONDS", DEFAULT_TIMEOUT_SIGKILL_GRACE_SECONDS)
    if sigkill_grace < sigterm_grace:
        logger.warning(
            "TIMEOUT_SIGKILL_GRACE_SECONDS (%s) < TIMEOUT_SIGTERM_GRACE_SECONDS (%s); using SIGTERM value",
            sigkill_grace,
            sigterm_grace,
        )
        return sigterm_grace
    return sigkill_grace


def get_param_json(key: str, default=None):
    raw = get_param(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON for system param %s", key)
        return default


def get_claude_cli_extra_args() -> list[str]:
    parsed = get_param_json("CLAUDE_CLI_ARGS", [])
    if not isinstance(parsed, list):
        logger.warning("CLAUDE_CLI_ARGS must be a JSON array")
        return []
    return [str(item) for item in parsed if item]


def seed_system_params() -> None:
    for item in SEED_PARAMS:
        existing = SystemParam.query.filter_by(key=item["key"]).first()
        if not existing:
            db.session.add(SystemParam(**item))
    db.session.commit()
