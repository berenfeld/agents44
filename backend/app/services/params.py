import json
import logging
import os

from app.extensions import db
from app.models import SystemParam

logger = logging.getLogger(__name__)

# LLM provider secrets live in Settings (system_params), not .env.
LLM_API_KEY_PARAMS = (
    {
        "key": "ANTHROPIC_API_KEY",
        "value": "",
        "description": "Anthropic API key for Claude models (anthropic/...). Stored in Settings, not .env.",
        "env_aliases": ("ANTHROPIC_API_KEY",),
        "os_env": ("ANTHROPIC_API_KEY",),
    },
    {
        "key": "GEMINI_API_KEY",
        "value": "",
        "description": (
            "Google Gemini API key (gemini/...). Also accepts the common typo GEMIN_API_KEY as an alias. "
            "Stored in Settings, not .env."
        ),
        "env_aliases": ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMIN_API_KEY"),
        "os_env": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    },
    {
        "key": "OPENAI_API_KEY",
        "value": "",
        "description": "OpenAI API key for openai/... models. Stored in Settings, not .env.",
        "env_aliases": ("OPENAI_API_KEY",),
        "os_env": ("OPENAI_API_KEY",),
    },
    {
        "key": "DASHSCOPE_API_KEY",
        "value": "",
        "description": "Alibaba DashScope API key for Qwen (dashscope/...). Stored in Settings, not .env.",
        "env_aliases": ("DASHSCOPE_API_KEY",),
        "os_env": ("DASHSCOPE_API_KEY",),
    },
)

DEFAULT_MODEL_PRICING = {
    "anthropic/claude-fable-5": {
        "input_per_million": 10.0,
        "output_per_million": 50.0,
    },
    "anthropic/claude-opus-5": {
        "input_per_million": 5.0,
        "output_per_million": 25.0,
    },
    "anthropic/claude-opus-4-8": {
        "input_per_million": 5.0,
        "output_per_million": 25.0,
    },
    "anthropic/claude-opus-4-7": {
        "input_per_million": 5.0,
        "output_per_million": 25.0,
    },
    "anthropic/claude-opus-4-6": {
        "input_per_million": 5.0,
        "output_per_million": 25.0,
    },
    "anthropic/claude-opus-4-5-20251101": {
        "input_per_million": 5.0,
        "output_per_million": 25.0,
    },
    "anthropic/claude-sonnet-5": {
        "input_per_million": 2.0,
        "output_per_million": 10.0,
    },
    "anthropic/claude-sonnet-4-6": {
        "input_per_million": 3.0,
        "output_per_million": 15.0,
    },
    "anthropic/claude-sonnet-4-5-20250929": {
        "input_per_million": 3.0,
        "output_per_million": 15.0,
    },
    "anthropic/claude-haiku-4-5-20251001": {
        "input_per_million": 1.0,
        "output_per_million": 5.0,
    },
    "gemini/gemini-2.5-flash": {
        "input_per_million": 0.3,
        "output_per_million": 2.5,
    },
    "gemini/gemini-2.5-pro": {
        "input_per_million": 1.25,
        "output_per_million": 10.0,
    },
}

SEED_PARAMS = [
    {
        "key": "NOTIFY_ON",
        "value": "failures",
        "description": "Auto-email admin on run events: all | failures | none",
    },
    {
        "key": "MODEL_PRICING",
        "value": json.dumps(DEFAULT_MODEL_PRICING),
        "description": "USD per 1M tokens by provider-prefixed model id (e.g. anthropic/..., gemini/...)",
    },
    *[
        {"key": item["key"], "value": item["value"], "description": item["description"]}
        for item in LLM_API_KEY_PARAMS
    ],
    {
        "key": "TIMEOUT_SIGTERM_GRACE_SECONDS",
        "value": "300",
        "description": (
            "Seconds after an agent's configured timeout before soft cancel is sent "
            "(default 300 = 5 minutes)."
        ),
    },
    {
        "key": "TIMEOUT_SIGKILL_GRACE_SECONDS",
        "value": "600",
        "description": (
            "Seconds after an agent's configured timeout before hard stop "
            "(default 600 = 10 minutes). Must be >= TIMEOUT_SIGTERM_GRACE_SECONDS."
        ),
    },
    {
        "key": "EMAIL_SEND_INTERVAL_SECONDS",
        "value": "300",
        "description": (
            "How often the backend retries pending agent emails (default 300 = 5 minutes). "
            "A new queued email also wakes the sender immediately."
        ),
    },
    {
        "key": "EMAIL_SEND_GIVE_UP_SECONDS",
        "value": "86400",
        "description": (
            "Seconds after an email is created before a still-pending send is marked fail "
            "(default 86400 = 24 hours). Emails are never deleted."
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


def get_llm_api_key(key: str) -> str:
    """Return a provider API key from Settings. Accepts GEMIN_API_KEY as Gemini alias."""
    value = (get_param(key) or "").strip()
    if value:
        return value
    if key == "GEMINI_API_KEY":
        return (get_param("GEMIN_API_KEY") or "").strip()
    return ""


def _api_key_param_rows() -> list[SystemParam]:
    return [
        row
        for row in SystemParam.query.order_by(SystemParam.key).all()
        if (row.key or "").endswith("_API_KEY")
    ]


def get_provider_api_keys() -> dict[str, str]:
    """All provider API keys from Settings (`*_API_KEY` rows in system_params)."""
    keys: dict[str, str] = {}
    for row in _api_key_param_rows():
        name = (row.key or "").strip()
        if not name or name == "GEMIN_API_KEY":
            continue
        value = (row.value or "").strip()
        if value:
            keys[name] = value
    gemini = get_llm_api_key("GEMINI_API_KEY")
    if gemini:
        keys["GEMINI_API_KEY"] = gemini
    return keys


def any_provider_api_key_configured() -> bool:
    return bool(get_provider_api_keys())


def apply_provider_keys_to_process_env() -> dict[str, str]:
    """Push every Settings `*_API_KEY` into process env for LiteLLM."""
    known = {item["key"] for item in LLM_API_KEY_PARAMS}
    for row in _api_key_param_rows():
        known.add(row.key)
    known.update({"GOOGLE_API_KEY", "GEMIN_API_KEY"})

    keys = get_provider_api_keys()
    for name in known:
        if name == "GEMIN_API_KEY":
            os.environ.pop(name, None)
            continue
        value = keys.get(name, "").strip()
        if value:
            os.environ[name] = value
        else:
            os.environ.pop(name, None)

    gemini = keys.get("GEMINI_API_KEY", "").strip()
    if gemini:
        os.environ["GEMINI_API_KEY"] = gemini
        os.environ["GOOGLE_API_KEY"] = gemini
    else:
        os.environ.pop("GEMINI_API_KEY", None)
        os.environ.pop("GOOGLE_API_KEY", None)
    return keys


def _import_llm_keys_from_env_once() -> None:
    """One-time migrate provider keys from process/.env into Settings if Settings empty."""
    for item in LLM_API_KEY_PARAMS:
        row = SystemParam.query.filter_by(key=item["key"]).first()
        current = (row.value if row else "") or ""
        if current.strip():
            continue
        imported = ""
        for alias in item["env_aliases"]:
            imported = (os.getenv(alias) or "").strip()
            if imported:
                break
        if not imported:
            continue
        if row:
            row.value = imported
        else:
            db.session.add(
                SystemParam(key=item["key"], value=imported, description=item["description"])
            )
        logger.info("Imported %s from environment into Settings (one-time)", item["key"])


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


def _merge_model_pricing_prefixes() -> None:
    """Ensure MODEL_PRICING includes provider-prefixed keys used by LiteLLM."""
    row = SystemParam.query.filter_by(key="MODEL_PRICING").first()
    if not row:
        return
    try:
        pricing = json.loads(row.value) if row.value else {}
    except json.JSONDecodeError:
        return
    if not isinstance(pricing, dict):
        return
    changed = False
    for key, value in list(pricing.items()):
        if isinstance(key, str) and "/" not in key and key.startswith("claude"):
            prefixed = f"anthropic/{key}"
            if prefixed not in pricing:
                pricing[prefixed] = value
                changed = True
        if isinstance(key, str) and "/" not in key and key.startswith("gemini"):
            prefixed = f"gemini/{key}"
            if prefixed not in pricing:
                pricing[prefixed] = value
                changed = True
    for key, value in DEFAULT_MODEL_PRICING.items():
        if key not in pricing:
            pricing[key] = value
            changed = True
    if changed:
        row.value = json.dumps(pricing)
        row.description = (
            "USD per 1M tokens by provider-prefixed model id (e.g. anthropic/..., gemini/...)"
        )


def seed_system_params() -> None:
    for item in SEED_PARAMS:
        existing = SystemParam.query.filter_by(key=item["key"]).first()
        if not existing:
            db.session.add(SystemParam(**item))
    stale = SystemParam.query.filter_by(key="CLAUDE_CLI_ARGS").first()
    if stale:
        db.session.delete(stale)
    # Remove accidental typo key after migrating its value into GEMINI_API_KEY.
    typo = SystemParam.query.filter_by(key="GEMIN_API_KEY").first()
    if typo and (typo.value or "").strip():
        gemini = SystemParam.query.filter_by(key="GEMINI_API_KEY").first()
        if gemini and not (gemini.value or "").strip():
            gemini.value = typo.value.strip()
        db.session.delete(typo)
    elif typo:
        db.session.delete(typo)
    _import_llm_keys_from_env_once()
    _merge_model_pricing_prefixes()
    db.session.commit()
    apply_provider_keys_to_process_env()
