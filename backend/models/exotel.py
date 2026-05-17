from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class ExotelStartInfo:
    stream_sid: str
    call_sid: Optional[str]
    sample_rate: int
    raw_start: dict[str, Any]
    started_at_ms: float
