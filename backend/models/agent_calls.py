from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class HumanAgentCallRequest(BaseModel):
    phone_number: str
    customer_name: str = "Manual Dial"
    provider: Optional[Literal["livekit-sip", "livekit-issabel", "auto"]] = "auto"
    campaign_id: Optional[str] = None
    lead_id: Optional[str] = None


class HumanAgentCallResponse(BaseModel):
    call_id: str
    room_name: str
    livekit_url: str
    agent_token: str
    agent_identity: str
    status: str
    provider: str
    phone_number: str
    customer_name: str


class HumanAgentCallStatus(BaseModel):
    call_id: str
    status: str
    phone_number: str
    room_name: Optional[str] = None
    provider: Optional[str] = None
    call_requested_at: Optional[datetime] = None
    sip_dial_started_at: Optional[datetime] = None
    sip_joined_at: Optional[datetime] = None
    agent_joined_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None


class HumanAgentDispositionRequest(BaseModel):
    outcome: str
    notes: Optional[str] = None
    callback_time: Optional[datetime] = None


class HumanAgentDispositionResponse(BaseModel):
    success: bool = True
