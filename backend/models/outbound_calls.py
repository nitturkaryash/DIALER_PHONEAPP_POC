from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class OutboundCallRequest(BaseModel):
    """Request to initiate an outbound verification call."""

    model_config = ConfigDict(extra="allow")

    phone_number: str
    customer_name: str
    customer_id: Optional[str] = None
    verification_context: Optional[dict] = None
    callback_url: Optional[str] = None
    bot_config: Optional[dict[str, Any]] = None
    initial_greeting: Optional[str] = None
    opening_greeting: Optional[str] = None
    bot_system_prompt: Optional[str] = None
    system_prompt: Optional[str] = None
    tts_prompt_template: Optional[str] = None
    tts_speed: Optional[str] = None
    tts_tone: Optional[str] = None
    barge_in: Optional[bool] = None
    style_instructions: Optional[str] = None
    voice_agent: Optional[str] = None
    voice: Optional[str] = None
    tts_language: Optional[str] = None
    language: Optional[str] = None
    outbound_knowledge_token: Optional[str] = None
    knowledge_token: Optional[str] = None
    collect_fields: Optional[list[dict[str, Any]]] = None
    bot_knowledge: Optional[str] = None


class CallStatus(BaseModel):
    """Call status response."""

    call_id: str
    status: str
    phone_number: str
    call_requested_at: Optional[datetime] = None
    warm_worker_reserved_at: Optional[datetime] = None
    sip_dial_started_at: Optional[datetime] = None
    sip_joined_at: Optional[datetime] = None
    first_bot_audio_at: Optional[datetime] = None
    first_user_audio_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    warm_start_used: bool = False
    answer_to_first_audio_ms: Optional[int] = None


@dataclass
class WarmBotWorker:
    room_name: str
    bot_identity: str
    created_at: datetime
    ready_at: Optional[datetime] = None
    reserved_at: Optional[datetime] = None
    call_info: Optional[dict] = None
