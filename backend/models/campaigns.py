from __future__ import annotations

import re
from typing import Literal
from typing import Any

from pydantic import BaseModel, Field
from pydantic import field_validator
from pydantic import model_validator


CollectFieldType = Literal["text", "phone", "email", "integer", "datetime"]
KnowledgeSource = Literal["text", "pdf_embedding"]


def _normalize_collect_field_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    if not text:
        return ""
    if text[0].isdigit():
        text = f"field_{text}"
    return text[:64]


class CampaignCollectField(BaseModel):
    key: str = Field(default="", min_length=1, max_length=64, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    label: str = Field(min_length=1, max_length=200)
    type: CollectFieldType
    required: bool = True

    @model_validator(mode="before")
    @classmethod
    def _populate_key_from_label(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw
        data = dict(raw)
        data["key"] = _normalize_collect_field_key(data.get("key") or data.get("label"))
        return data

    @field_validator("key")
    @classmethod
    def _validate_key(cls, value: str) -> str:
        normalized = _normalize_collect_field_key(value)
        if not normalized:
            raise ValueError("key or label is required")
        return normalized


class CampaignBotConfigPatch(BaseModel):
    """PATCH body for campaign voice / collection configuration."""
    collect_fields: list[CampaignCollectField] | None = None
    bot_system_prompt: str | None = None
    bot_knowledge: str | None = None
    knowledge_source: KnowledgeSource | None = None
    initial_greeting: str | None = None
    voice_agent: str | None = None
    tts_language: str | None = None
    tts_prompt_template: str | None = None
    tts_speed: str | None = None
    tts_tone: str | None = None
    barge_in: bool | None = None
