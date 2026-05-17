from __future__ import annotations
from typing import Optional
from pydantic import BaseModel

class UserOutboundConfig(BaseModel):
    """User-specific configuration for outbound calls (Exotel + Issabel)."""
    user_id: str

    # Exotel
    exotel_sid: Optional[str] = None
    exotel_api_key: Optional[str] = None
    exotel_api_token: Optional[str] = None
    exotel_caller_id: Optional[str] = None
    exotel_flow_url: Optional[str] = None

    # Issabel/Asterisk SIP direct signaling
    issabel_host: Optional[str] = None
    issabel_port: Optional[int] = None
    issabel_user: Optional[str] = None
    issabel_login: Optional[str] = None
    issabel_domain: Optional[str] = None
    issabel_password: Optional[str] = None
    issabel_dial_prefix: Optional[str] = None
