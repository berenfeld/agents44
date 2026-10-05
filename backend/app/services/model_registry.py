import logging
import os
from typing import Any

from flask import current_app

from app.errors import ModelDiscoveryError
from app.extensions import db
from app.models import SystemAgent
from app.services.params import get_param_json, get_supported_models_param

logger = logging.getLogger(__name__)


def normalize_model_id(model: str) -> str:
    """Map legacy bare model ids to LiteLLM provider-prefixed ids."""
    value = (model or "").strip()
    if not value:
        return value
    if "/" in value:
        return value
    if value.startswith("claude"):
        return f"anthropic/{value}"
    if value.startswith("gemini"):
        return f"gemini/{value}"
    if value.startswith("gpt"):
        return f"openai/{value}"
    return value


def configured_models(app=None) -> list[str]:
    """Read SUPPORTED_MODELS from Settings (system_params)."""
    _ = app  # app context required by get_param; kept for call-site compatibility
    models = [normalize_model_id(m) for m in get_supported_models_param()]
    if not models:
        raise ModelDiscoveryError("SUPPORTED_MODELS is empty")
    # Preserve order, drop duplicates after normalize.
    unique: list[str] = []
    for model in models:
        if model and model not in unique:
            unique.append(model)
    return unique


def resolve_default_model(models: list[str], app=None) -> str:
    cfg = app.config if app is not None else current_app.config
    configured = normalize_model_id(cfg.get("DEFAULT_MODEL") or os.getenv("DEFAULT_MODEL", ""))
    if configured and configured in models:
        return configured
    return models[0]


def init_model_registry(app) -> None:
    with app.app_context():
        try:
            models = configured_models(app)
        except ModelDiscoveryError as exc:
            logger.warning("%s — agent runs will fail until models are configured", exc)
            app.config["SUPPORTED_MODELS"] = []
            app.config["DEFAULT_MODEL_RESOLVED"] = ""
            return

        default_model = resolve_default_model(models, app)
        app.config["SUPPORTED_MODELS"] = models
        app.config["DEFAULT_MODEL_RESOLVED"] = default_model

        agents = SystemAgent.query.all()
        for agent in agents:
            remapped = normalize_model_id(agent.model)
            if remapped != agent.model:
                logger.warning(
                    "Agent %s model %s remapped to %s", agent.name, agent.model, remapped
                )
                agent.model = remapped
            if agent.model not in models:
                old = agent.model
                agent.model = default_model
                logger.warning(
                    "Agent %s model %s unsupported; changed to %s", agent.name, old, default_model
                )
        db.session.flush()
        logger.info("Supported models: %s (default=%s)", models, default_model)


def get_supported_models() -> list[str]:
    """Always read the allowlist from Settings (DB), not a process cache."""
    return configured_models()


def get_default_model() -> str:
    return current_app.config.get("DEFAULT_MODEL_RESOLVED") or ""


def validate_model(model: str) -> bool:
    return normalize_model_id(model) in get_supported_models()


CACHE_WRITE_INPUT_MULTIPLIER = 1.25
CACHE_READ_INPUT_MULTIPLIER = 0.1


def estimate_cost_from_usage(model: str, usage: dict[str, Any]) -> float | None:
    pricing_map: dict[str, Any] = get_param_json("MODEL_PRICING", {}) or {}
    pricing = pricing_map.get(model) or pricing_map.get(normalize_model_id(model))
    if not pricing and "/" in model:
        pricing = pricing_map.get(model.split("/", 1)[1])
    if not pricing:
        logger.warning("No MODEL_PRICING entry for model %s", model)
        return None
    input_per_m = float(pricing["input_per_million"])
    output_per_m = float(pricing["output_per_million"])
    cache_read_raw = pricing.get("cache_read_per_million")
    cache_read_per_m = float(cache_read_raw) if cache_read_raw is not None else input_per_m * CACHE_READ_INPUT_MULTIPLIER
    tin = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    cc = int(usage.get("cache_creation_input_tokens") or 0)
    cr = int(usage.get("cache_read_input_tokens") or usage.get("cache_read_tokens") or 0)
    tout = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    cost = (
        tin * input_per_m / 1_000_000
        + cc * input_per_m * CACHE_WRITE_INPUT_MULTIPLIER / 1_000_000
        + cr * cache_read_per_m / 1_000_000
        + tout * output_per_m / 1_000_000
    )
    return round(cost, 6)


def estimate_cost(model: str, tokens_in: int | None, tokens_out: int | None) -> float | None:
    if tokens_in is None and tokens_out is None:
        return None
    return estimate_cost_from_usage(
        model,
        {
            "input_tokens": tokens_in or 0,
            "output_tokens": tokens_out or 0,
        },
    )
