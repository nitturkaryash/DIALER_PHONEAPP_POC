"""API shape for voice-collected campaign answers (Mongo document, minus legacy scheduling keys)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class CollectedParamsSubmission(BaseModel):
    """One saved submission linked to a call. Extra keys from old documents (e.g. preferred_start) are ignored."""

    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: Optional[str] = None
    campaign_id: Optional[str] = None
    campaign_contact_id: Optional[str] = None
    call_id: Optional[str] = None
    answers: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
