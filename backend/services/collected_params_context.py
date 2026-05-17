"""Per-call context for collected campaign fields (tool handler reads this; set from transport metadata)."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

CollectedParamsContext = dict[str, Any] | None

_collected_ctx: ContextVar[CollectedParamsContext] = ContextVar("collected_params_ctx", default=None)


def set_collected_params_context(data: CollectedParamsContext) -> None:
    _collected_ctx.set(data)


def get_collected_params_context() -> CollectedParamsContext:
    return _collected_ctx.get()
