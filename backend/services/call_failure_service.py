from __future__ import annotations

from datetime import datetime
from typing import Optional

from loguru import logger

from db.mongo import get_db


def _apply_failed_state(target: Optional[dict], *, end_reason: str, error_message: str | None = None) -> None:
    if not isinstance(target, dict):
        return
    target["status"] = "failed"
    target["end_reason"] = end_reason
    if error_message:
        target["failure_reason"] = error_message
        target["last_error"] = error_message
    target.setdefault("ended_at", datetime.now())


async def mark_call_failed(
    call_id: str | None,
    *,
    end_reason: str,
    error_message: str | None = None,
    state: Optional[dict] = None,
) -> None:
    clean_call_id = str(call_id or "").strip()
    if not clean_call_id:
        return

    _apply_failed_state(state, end_reason=end_reason, error_message=error_message)

    try:
        from services import outbound_call_service

        active_call = outbound_call_service.active_calls.get(clean_call_id)
        _apply_failed_state(active_call, end_reason=end_reason, error_message=error_message)
        if isinstance(active_call, dict):
            try:
                outbound_call_service._update_call_duration(active_call)
            except Exception:
                pass
    except Exception as exc:
        logger.debug(f"mark_call_failed: could not update active call cache ({clean_call_id=}): {exc}")

    try:
        db = get_db()
        now = datetime.now()
        payload = {
            "call_id": clean_call_id,
            "status": "failed",
            "end_reason": end_reason,
            "ended_at": now,
            "updated_at": now,
        }
        if error_message:
            payload["failure_reason"] = error_message
            payload["last_error"] = error_message
        await db.call_sessions.update_one(
            {"call_id": clean_call_id},
            {"$set": payload},
            upsert=True,
        )
    except Exception as exc:
        logger.warning(f"mark_call_failed: could not persist failed status ({clean_call_id=}): {exc}")
