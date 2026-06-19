import logging
import os
import re
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


def compute_estimated_cost(model: str, tokens_in: int | None, tokens_out: int | None) -> float | None:
    if tokens_in is None and tokens_out is None:
        return None
    pricing_map: dict[str, Any] = get_param_json("MODEL_PRICING", {}) or {}
    pricing = pricing_map.get(model)
    if not pricing:
        logger.warning("No MODEL_PRICING entry for model %s", model)
        return None
    tin = tokens_in or 0
    tout = tokens_out or 0
    cost = (tin * float(pricing["input_per_million"]) / 1_000_000) + (
        tout * float(pricing["output_per_million"]) / 1_000_000
    )
    return round(cost, 6)


def parse_usage_from_claude_output(stdout: str) -> tuple[int | None, int | None]:
    import json

    tokens_in: int | None = None
    tokens_out: int | None = None

    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        usage = data.get("usage")
        if isinstance(usage, dict):
            tin = usage.get("input_tokens") or usage.get("prompt_tokens")
            tout = usage.get("output_tokens") or usage.get("completion_tokens")
            if tin is not None:
                tokens_in = int(tin)
            if tout is not None:
                tokens_out = int(tout)

    if tokens_in is not None or tokens_out is not None:
        return tokens_in, tokens_out

    if stdout.strip().startswith("{"):
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            data = None
        if data is not None:
            usage = data.get("usage") or data.get("result", {}).get("usage") or {}
            tokens_in = usage.get("input_tokens") or usage.get("prompt_tokens")
            tokens_out = usage.get("output_tokens") or usage.get("completion_tokens")
            return (
                int(tokens_in) if tokens_in is not None else None,
                int(tokens_out) if tokens_out is not None else None,
            )

    match = re.search(r'"input_tokens"\s*:\s*(\d+).*"output_tokens"\s*:\s*(\d+)', stdout)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None
