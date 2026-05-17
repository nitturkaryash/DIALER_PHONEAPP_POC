"""Persist collected voice campaign parameters to MongoDB (`collected_params` collection)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from loguru import logger

from db.mongo import get_db
from services.call_failure_service import mark_call_failed


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_submission(row: dict[str, Any]) -> dict[str, Any]:
    submission = dict(row)
    submission["id"] = str(submission.get("id") or submission.get("_id") or "")
    submission.pop("_id", None)
    return submission


async def persist_collected_parameters(
    *,
    user_id: Optional[str],
    campaign_id: Optional[str],
    campaign_contact_id: Optional[str],
    call_id: Optional[str],
    answers: dict[str, Any],
) -> tuple[bool, Optional[str]]:
    """Insert one document: linkage fields + answers only (no synthetic scheduling window)."""
    try:
        db = get_db()
    except Exception as exc:
        logger.warning(f"collected_params: Mongo unavailable: {exc}")
        await mark_call_failed(
            call_id,
            end_reason="collected_params_db_unavailable",
            error_message=str(exc),
        )
        return False, str(exc)

    now = _utcnow()
    doc = {
        "id": str(uuid4()),
        "user_id": user_id,
        "campaign_id": campaign_id,
        "campaign_contact_id": campaign_contact_id,
        "call_id": call_id,
        "answers": answers,
        "created_at": now,
        "updated_at": now,
    }
    try:
        selectors: list[dict[str, Any]] = []
        if user_id and call_id:
            selectors.append({"user_id": user_id, "call_id": call_id})
        if user_id and campaign_id and campaign_contact_id:
            selectors.append(
                {
                    "user_id": user_id,
                    "campaign_id": campaign_id,
                    "campaign_contact_id": campaign_contact_id,
                }
            )

        existing = None
        for selector in selectors:
            existing = await db.collected_params.find_one(selector, sort=[("created_at", -1)])
            if existing:
                break

        if existing:
            await db.collected_params.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "user_id": user_id,
                        "campaign_id": campaign_id,
                        "campaign_contact_id": campaign_contact_id,
                        "call_id": call_id or existing.get("call_id"),
                        "answers": answers,
                        "updated_at": now,
                    }
                },
            )
        else:
            await db.collected_params.insert_one(doc)
        return True, None
    except Exception as exc:
        logger.warning(f"collected_params insert failed: {exc}")
        await mark_call_failed(
            call_id,
            end_reason="collected_params_persist_failed",
            error_message=str(exc),
        )
        return False, str(exc)


async def get_collected_params_by_call_id(*, call_id: str, user_id: str) -> Optional[dict]:
    """Fetch submission for this call, scoped to the authenticated user."""
    db = get_db()
    row = await db.collected_params.find_one(
        {"call_id": call_id, "user_id": user_id},
        sort=[("created_at", -1)],
    )
    if not row:
        call_session = await db.call_sessions.find_one({"call_id": call_id, "user_id": user_id})
        campaign_contact_id = str((call_session or {}).get("campaign_contact_id") or "").strip()
        if campaign_contact_id:
            row = await db.collected_params.find_one(
                {"campaign_contact_id": campaign_contact_id, "user_id": user_id},
                sort=[("created_at", -1)],
            )
    if not row:
        return None
    return _serialize_submission(row)
