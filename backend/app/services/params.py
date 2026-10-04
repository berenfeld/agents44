import json
import logging

from app.extensions import db
from app.models import SystemParam

logger = logging.getLogger(__name__)

# LLM provider secrets live only in Settings (system_params). Never .env / process env.
LLM_API_KEY_PARAMS = (
    {
        "key": "ANTHROPIC_API_KEY",
        "value": "",
        "description": "Anthropic API key for Claude models (anthropic/...). Settings only — not .env.",
    },
    {
        "key": "GEMINI_API_KEY",
        "value": "",
        "description": (
            "Google Gemini API key (gemini/...). Settings only — not .env. "
            "Also accepts the legacy typo key GEMIN_API_KEY if present in Settings."
        ),
    },
    {
        "key": "OPENAI_API_KEY",
        "value": "",
        "description": "OpenAI API key for openai/... models. Settings only — not .env.",
    },
    {
        "key": "DASHSCOPE_API_KEY",
        "value": "",
        "description": "Alibaba DashScope API key for Qwen (dashscope/...). Settings only — not .env.",
    },
)

# Default allowlist shown in Settings / agent model selects (provider-prefixed LiteLLM ids).
DEFAULT_SUPPORTED_MODELS = [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-haiku-4-5-20251001",
    "gemini/gemini-2.5-flash",
    "gemini/gemini-2.5-pro",
]

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
        "value": json.dumps(DEFAULT_MODEL_PRICING, indent=2, sort_keys=True),
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


def pretty_json_value(raw: str, *, sort_keys: bool = False) -> str | None:
    """Return indented JSON if `raw` is a JSON object/array; otherwise None."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, (dict, list)):
        return None
    return json.dumps(parsed, indent=2, sort_keys=sort_keys and isinstance(parsed, dict))


def parse_supported_models(raw: str | None) -> list[str]:
    """Parse SUPPORTED_MODELS from JSON array or comma/newline-separated text."""
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []
    models: list[str] = []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        candidates = parsed
    elif isinstance(parsed, str):
        candidates = [parsed]
    else:
        candidates = text.replace("\n", ",").split(",")
    for part in candidates:
        model = str(part).strip()
        if model and model not in models:
            models.append(model)
    return models


def format_supported_models(models: list[str]) -> str:
    return json.dumps(models, indent=2)


def get_supported_models_param() -> list[str]:
    """SUPPORTED_MODELS from Settings (system_params), not .env."""
    return parse_supported_models(get_param("SUPPORTED_MODELS", ""))


def normalize_secret_value(raw: str | None) -> str:
    """Strip whitespace and a single layer of matching quotes from a secret."""
    value = (raw or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
    return value


def get_llm_api_key(key: str) -> str:
    """Return a provider API key from Settings (DB). Accepts GEMIN_API_KEY as Gemini alias."""
    value = normalize_secret_value(get_param(key))
    if value:
        return value
    if key == "GEMINI_API_KEY":
        return normalize_secret_value(get_param("GEMIN_API_KEY"))
    return ""


_PROVIDER_KEY_BY_PREFIX = {
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "google": "GEMINI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "dashscope": "DASHSCOPE_API_KEY",
}


def provider_api_key_for_model(model: str) -> str:
    """Resolve the Settings API key for a provider-prefixed model id (reads DB)."""
    value = (model or "").strip()
    if "/" not in value:
        return ""
    prefix = value.split("/", 1)[0].strip().lower()
    key_name = _PROVIDER_KEY_BY_PREFIX.get(prefix) or f"{prefix.upper()}_API_KEY"
    return get_llm_api_key(key_name)


def provider_key_name_for_model(model: str) -> str:
    """Settings key name expected for a provider-prefixed model id."""
    value = (model or "").strip()
    if "/" not in value:
        return ""
    prefix = value.split("/", 1)[0].strip().lower()
    return _PROVIDER_KEY_BY_PREFIX.get(prefix) or f"{prefix.upper()}_API_KEY"


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
        value = normalize_secret_value(row.value)
        if value:
            keys[name] = value
    gemini = get_llm_api_key("GEMINI_API_KEY")
    if gemini:
        keys["GEMINI_API_KEY"] = gemini
    return keys


def any_provider_api_key_configured() -> bool:
    return bool(get_provider_api_keys())


def _ensure_supported_models_param() -> None:
    """Ensure SUPPORTED_MODELS exists in Settings (defaults only — not from .env)."""
    description = (
        "JSON array of provider-prefixed LiteLLM model ids shown in agent/chat selects "
        "(e.g. anthropic/..., gemini/...). Edit here — not in .env."
    )
    row = SystemParam.query.filter_by(key="SUPPORTED_MODELS").first()
    if row and parse_supported_models(row.value):
        row.description = description
        return
    imported = list(DEFAULT_SUPPORTED_MODELS)
    value = format_supported_models(imported)
    if row:
        row.value = value
        row.description = description
    else:
        db.session.add(SystemParam(key="SUPPORTED_MODELS", value=value, description=description))
    logger.info("Seeded SUPPORTED_MODELS into Settings (%s models)", len(imported))


def _pretty_print_json_params() -> None:
    """Keep JSON system params indented so Settings is readable."""
    for key, sort_keys in (("MODEL_PRICING", True), ("SUPPORTED_MODELS", False)):
        row = SystemParam.query.filter_by(key=key).first()
        if not row or not (row.value or "").strip():
            continue
        pretty = pretty_json_value(row.value, sort_keys=sort_keys)
        if pretty is not None and pretty != row.value:
            row.value = pretty


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
        row.value = json.dumps(pricing, indent=2, sort_keys=True)
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
    _ensure_supported_models_param()
    _merge_model_pricing_prefixes()
    _pretty_print_json_params()
    db.session.commit()
