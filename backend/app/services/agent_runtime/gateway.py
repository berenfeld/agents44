"""LLM gateway — sole place that builds provider models via LiteLLM."""

from __future__ import annotations

from flask import current_app
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.profiles import ModelProfile, merge_profile
from pydantic_ai.profiles.google import google_model_profile
from pydantic_ai.profiles.openai import OpenAIJsonSchemaTransformer, OpenAIModelProfile
from pydantic_ai.providers.litellm import LiteLLMProvider

from app.services.litellm_proxy import litellm_base_url
from app.services.model_registry import normalize_model_id


def _profile_for_model(model_id: str) -> ModelProfile | None:
    """LiteLLMProvider maps `google/` but our Settings ids use `gemini/` — attach Google thinking profile."""
    if not model_id.startswith("gemini/"):
        return None
    suffix = model_id.split("/", 1)[1]
    return merge_profile(
        OpenAIModelProfile(json_schema_transformer=OpenAIJsonSchemaTransformer),
        google_model_profile(suffix),
    )


class LlmGateway:
    """Resolve a selected model id to a Pydantic AI model through LiteLLM."""

    def resolve_model(self, model_id: str) -> OpenAIChatModel:
        normalized = normalize_model_id(model_id)
        api_base = f"{litellm_base_url()}/v1"
        api_key = current_app.config["LITELLM_MASTER_KEY"]
        provider = LiteLLMProvider(api_base=api_base, api_key=api_key)
        return OpenAIChatModel(
            normalized,
            provider=provider,
            profile=_profile_for_model(normalized),
        )
