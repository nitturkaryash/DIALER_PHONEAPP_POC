"""Database access for conversation events."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger

from db.mongo import get_db
from services.call_failure_service import mark_call_failed


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_event(event: dict[str, Any]) -> dict[str, Any]:
    row = dict(event)
    row["id"] = str(row.get("_id") or "")
    row.pop("_id", None)
    return row


async def append_event(
    *,
    call_id: str,
    user_id: str | None,
    actor: str,
    event_type: str,
    content: str = "",
    meta: dict[str, Any] | None = None,
) -> None:
    """Persist a single conversation event."""
    db = get_db()
    try:
        await db.conversation_events.insert_one(
            {
                "call_id": call_id,
                "user_id": user_id,
                "actor": actor,
                "event_type": event_type,
                "content": content,
                "meta": meta or {},
                "created_at": _utcnow(),
            }
        )
    except Exception as exc:
        logger.warning(f"Failed to append conversation event ({call_id=}, {actor=}): {exc}")

async def get_conversation(call_id: str, user_id: str) -> list[dict]:
    """Return conversation events for a call, scoped to the authenticated user."""
    db = get_db()
    cursor = (
        db.conversation_events.find({"call_id": call_id})
        .sort("created_at", 1)
        .limit(500)
    )
    events: list[dict] = []
    async for event in cursor:
        if event.get("user_id") and event["user_id"] != user_id:
            continue
        events.append(_serialize_event(event))
    return events


async def list_recent_events_for_user(user_id: str, limit: int = 200) -> list[dict]:
    """Return most recent conversation events for a given user."""
    db = get_db()
    cursor = (
        db.conversation_events.find({"user_id": user_id})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 500)))
    )
    return [_serialize_event(event) async for event in cursor]
