import json
import logging
import os
from typing import Any

import requests
from flask import current_app

from app.errors import ModelDiscoveryError
from app.extensions import db
from app.models import SystemAgent
from app.services.params import get_param_json

logger = logging.getLogger(__name__)

ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
ANTHROPIC_VERSION = "2023-06-01"


def discover_models() -> list[str]:
    api_key = current_app.config.get("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ModelDiscoveryError("ANTHROPIC_API_KEY is not set")

    response = requests.get(
        ANTHROPIC_MODELS_URL,
        headers={
            "anthropic-version": ANTHROPIC_VERSION,
            "x-api-key": api_key,
        },
        timeout=30,
    )
    if not response.ok:
        raise ModelDiscoveryError(f"Anthropic models API failed with status {response.status_code}")

    models = []
    for item in response.json().get("data", []):
        model_id = item.get("id", "")
        if isinstance(model_id, str) and model_id.startswith("claude"):
            models.append(model_id)
    if not models:
        raise ModelDiscoveryError("Anthropic models API returned no supported models")
    return models


def resolve_default_model(models: list[str]) -> str:
    configured = current_app.config.get("DEFAULT_MODEL") or os.getenv("DEFAULT_MODEL", "")
    if configured and configured in models:
        return configured
    return models[0]


def init_model_registry(app) -> None:
    with app.app_context():
        models = discover_models()
        default_model = resolve_default_model(models)
        app.config["SUPPORTED_MODELS"] = models
        app.config["DEFAULT_MODEL_RESOLVED"] = default_model

        agents = SystemAgent.query.all()
        for agent in agents:
            if agent.model not in models:
                old = agent.model
                agent.model = default_model
                logger.warning(
                    "Agent %s model %s unsupported; changed to %s", agent.name, old, default_model
                )
        db.session.commit()
        logger.info("Supported models: %s (default=%s)", models, default_model)


def get_supported_models() -> list[str]:
    models = current_app.config.get("SUPPORTED_MODELS")
    if not models:
        raise RuntimeError("Supported models are not initialized")
    return models


def get_default_model() -> str:
    default_model = current_app.config.get("DEFAULT_MODEL_RESOLVED")
    if not default_model:
        raise RuntimeError("Default model is not initialized")
    return default_model


def validate_model(model: str) -> bool:
    return model in get_supported_models()


def _input_tokens_from_usage(usage: dict[str, Any]) -> int:
    return int(usage.get("input_tokens") or 0) + int(
        usage.get("cache_creation_input_tokens") or 0
    ) + int(usage.get("cache_read_input_tokens") or 0)


CACHE_WRITE_INPUT_MULTIPLIER = 1.25
CACHE_READ_INPUT_MULTIPLIER = 0.1


def estimate_cost_from_usage(model: str, usage: dict[str, Any]) -> float | None:
    pricing_map: dict[str, Any] = get_param_json("MODEL_PRICING", {}) or {}
    pricing = pricing_map.get(model)
    if not pricing:
        logger.warning("No MODEL_PRICING entry for model %s", model)
        return None
    input_per_m = float(pricing["input_per_million"])
    output_per_m = float(pricing["output_per_million"])
    tin = int(usage.get("input_tokens") or 0)
    cc = int(usage.get("cache_creation_input_tokens") or 0)
    cr = int(usage.get("cache_read_input_tokens") or 0)
    tout = int(usage.get("output_tokens") or 0)
    cost = (
        tin * input_per_m / 1_000_000
        + cc * input_per_m * CACHE_WRITE_INPUT_MULTIPLIER / 1_000_000
        + cr * input_per_m * CACHE_READ_INPUT_MULTIPLIER / 1_000_000
        + tout * output_per_m / 1_000_000
    )
    return round(cost, 6)


def _sum_assistant_usages(stdout: str, model: str) -> tuple[int | None, int | None, float | None]:
    tokens_in = 0
    tokens_out = 0
    cost_usd = 0.0
    found = False
    has_cost = False
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if data.get("type") != "assistant":
            continue
        usage = (data.get("message") or {}).get("usage")
        if not isinstance(usage, dict):
            continue
        found = True
        tokens_in += _input_tokens_from_usage(usage)
        tokens_out += int(usage.get("output_tokens") or 0)
        turn_cost = estimate_cost_from_usage(model, usage)
        if turn_cost is not None:
            cost_usd += turn_cost
            has_cost = True

    if not found:
        return None, None, None
    return tokens_in, tokens_out, round(cost_usd, 6) if has_cost else None


def _find_claude_result(stdout: str) -> dict[str, Any] | None:
    result: dict[str, Any] | None = None
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if data.get("type") == "result":
            result = data

    if result is not None:
        return result

    stripped_stdout = stdout.strip()
    if not stripped_stdout.startswith("{"):
        return None
    try:
        data = json.loads(stripped_stdout)
    except json.JSONDecodeError:
        return None
    if data.get("type") == "result":
        return data
    return None


def parse_claude_result(stdout: str, model: str | None = None) -> tuple[int | None, int | None, float | None]:
    """Return (tokens_in, tokens_out, total_cost_usd) from CLI stdout.

    Prefer the final ``type=result`` envelope (authoritative ``total_cost_usd``).
    For interrupted runs with no result line, sum per-turn assistant ``usage``.
    """
    result = _find_claude_result(stdout)
    if result is not None:
        usage = result.get("usage")
        tokens_in: int | None = None
        tokens_out: int | None = None
        if isinstance(usage, dict):
            tokens_in = _input_tokens_from_usage(usage)
            output_tokens = usage.get("output_tokens")
            tokens_out = int(output_tokens) if output_tokens is not None else None

        total_cost = result.get("total_cost_usd")
        cost_usd = round(float(total_cost), 6) if total_cost is not None else None
        return tokens_in, tokens_out, cost_usd

    if model:
        return _sum_assistant_usages(stdout, model)
    return None, None, None
