from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import re
from typing import Any
import json

from bson import ObjectId
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from loguru import logger

from db.mongo import get_db
from utils.redis_client import get_redis



DATE_ONLY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _truncate_text(value: str, *, max_chars: int = 8000) -> str:
    if max_chars > 0 and len(value) > max_chars:
        return value[: max_chars - 3] + "..."
    return value


def _build_transcript(events: list[dict], *, max_chars: int = 8000) -> str:
    lines: list[str] = []
    for event in events:
        actor = str(event.get("actor") or "").lower()
        if actor not in {"user", "assistant"}:
            continue
        content = _safe_text(event.get("content")).strip()
        if not content:
            continue
        prefix = "USER" if actor == "user" else "ASSISTANT"
        lines.append(f"{prefix}: {content}")

    transcript = "\n".join(lines).strip()
    return _truncate_text(transcript, max_chars=max_chars)


def _build_structured_transcript_text(items: Any, *, max_chars: int = 8000) -> str:
    if not isinstance(items, list):
        return ""

    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        speaker = _safe_text(item.get("speaker")).strip().lower()
        text = _safe_text(item.get("text")).strip()
        if not text:
            continue
        prefix = "USER" if speaker == "user" else ("ASSISTANT" if speaker == "agent" else "")
        if not prefix:
            continue
        lines.append(f"{prefix}: {text}")

    transcript = "\n".join(lines).strip()
    return _truncate_text(transcript, max_chars=max_chars)


def _clip_text(value: str, *, max_chars: int = 8000) -> str:
    clean = _safe_text(value).strip()
    if not clean:
        return ""
    return _truncate_text(clean, max_chars=max_chars)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_date_filter(value: str | None, *, is_end: bool = False) -> datetime | None:
    clean = _safe_text(value).strip()
    if not clean:
        return None

    try:
        if DATE_ONLY_PATTERN.fullmatch(clean):
            boundary = datetime.strptime(clean, "%Y-%m-%d")
            return boundary + timedelta(days=1) if is_end else boundary

        parsed = datetime.fromisoformat(clean.replace("Z", "+00:00"))
        return _normalize_datetime(parsed)
    except ValueError:
        return None


def _build_history_query(
    *,
    user_id: str,
    search: str = "",
    status: str = "",
    campaign_id: str = "",
    date_from: str = "",
    date_to: str = "",
) -> dict[str, Any]:
    query: dict[str, Any] = {"user_id": user_id}
    and_conditions: list[dict[str, Any]] = []

    normalized_status = _safe_text(status).strip().lower()
    if normalized_status and normalized_status != "all":
        query["status"] = normalized_status

    normalized_campaign = _safe_text(campaign_id).strip()
    if normalized_campaign and normalized_campaign != "all":
        if normalized_campaign == "__direct__":
            and_conditions.append(
                {
                    "$or": [
                        {"campaign_id": {"$exists": False}},
                        {"campaign_id": None},
                        {"campaign_id": ""},
                    ]
                }
            )
        else:
            query["campaign_id"] = normalized_campaign

    created_at_filter: dict[str, datetime] = {}
    from_dt = _parse_date_filter(date_from)
    if from_dt is not None:
        created_at_filter["$gte"] = from_dt
    to_dt = _parse_date_filter(date_to, is_end=True)
    if to_dt is not None:
        created_at_filter["$lt"] = to_dt
    if created_at_filter:
        query["created_at"] = created_at_filter

    normalized_search = _safe_text(search).strip()
    if normalized_search:
        regex = {"$regex": re.escape(normalized_search), "$options": "i"}
        and_conditions.append(
            {
                "$or": [
                    {"call_id": regex},
                    {"phone_number": regex},
                    {"customer_name": regex},
                ]
            }
        )

    if and_conditions:
        query["$and"] = and_conditions

    return query


async def _build_history_summary(db, *, query: dict[str, Any], user_id: str) -> dict[str, Any]:
    summary_rows = [
        row async for row in db.call_sessions.aggregate(
            [
                {"$match": query},
                {
                    "$group": {
                        "_id": None,
                        "total_calls": {"$sum": 1},
                        "completed_calls": {
                            "$sum": {
                                "$cond": [
                                    {"$eq": ["$status", "completed"]},
                                    1,
                                    0,
                                ]
                            }
                        },
                        "total_duration_seconds": {
                            "$sum": {"$ifNull": ["$duration_seconds", 0]}
                        },
                    }
                },
            ]
        )
    ]
    summary_doc = summary_rows[0] if summary_rows else {}

    campaign_rows = [
        row async for row in db.call_sessions.aggregate(
            [
                {"$match": query},
                {
                    "$group": {
                        "_id": "$campaign_id",
                        "total_calls": {"$sum": 1},
                        "total_duration_seconds": {
                            "$sum": {"$ifNull": ["$duration_seconds", 0]}
                        },
                    }
                },
                {"$sort": {"total_duration_seconds": -1, "total_calls": -1}},
            ]
        )
    ]

    campaign_breakdown_by_id: dict[str, dict[str, Any]] = {}
    for row in campaign_rows:
        raw_campaign_id = _safe_text(row.get("_id")).strip()
        bucket_key = raw_campaign_id or "__direct__"
        item = campaign_breakdown_by_id.setdefault(
            bucket_key,
            {
                "campaign_id": None if bucket_key == "__direct__" else bucket_key,
                "campaign_name": "Direct / No campaign" if bucket_key == "__direct__" else bucket_key,
                "total_calls": 0,
                "total_duration_seconds": 0,
            },
        )
        item["total_calls"] += int(row.get("total_calls") or 0)
        item["total_duration_seconds"] += int(row.get("total_duration_seconds") or 0)

    campaign_ids = [key for key in campaign_breakdown_by_id.keys() if key != "__direct__"]
    if campaign_ids:
        campaign_cursor = db.campaigns.find({"id": {"$in": campaign_ids}, "user_id": user_id})
        async for campaign in campaign_cursor:
            cid = _safe_text(campaign.get("id")).strip()
            if cid and cid in campaign_breakdown_by_id:
                campaign_breakdown_by_id[cid]["campaign_name"] = _safe_text(campaign.get("name")).strip() or cid

    campaign_breakdown = sorted(
        campaign_breakdown_by_id.values(),
        key=lambda item: (-int(item.get("total_duration_seconds") or 0), -int(item.get("total_calls") or 0)),
    )

    return {
        "total_calls": int(summary_doc.get("total_calls") or 0),
        "completed_calls": int(summary_doc.get("completed_calls") or 0),
        "total_duration_seconds": int(summary_doc.get("total_duration_seconds") or 0),
        "campaign_total_duration_seconds": sum(
            int(item.get("total_duration_seconds") or 0)
            for item in campaign_breakdown
            if item.get("campaign_id")
        ),
        "direct_total_duration_seconds": sum(
            int(item.get("total_duration_seconds") or 0)
            for item in campaign_breakdown
            if not item.get("campaign_id")
        ),
        "campaign_breakdown": campaign_breakdown,
    }


async def list_call_history(
    *,
    user_id: str,
    page: int = 1,
    limit: int = 10,
    include_transcript: bool = True,
    search: str = "",
    status: str = "",
    campaign_id: str = "",
    date_from: str = "",
    date_to: str = "",
) -> dict[str, Any]:
    db = get_db()
    safe_limit = max(1, min(int(limit or 10), 200))
    skip = (max(1, page) - 1) * safe_limit
    query = _build_history_query(
        user_id=user_id,
        search=search,
        status=status,
        campaign_id=campaign_id,
        date_from=date_from,
        date_to=date_to,
    )

    total = await db.call_sessions.count_documents(query)
    total_pages = (total + safe_limit - 1) // safe_limit if safe_limit > 0 else 0
    projection = {
        "_id": 1,
        "call_id": 1,
        "customer_name": 1,
        "campaign_contact_id": 1,
        "campaign_id": 1,
        "phone_number": 1,
        "status": 1,
        "started_at": 1,
        "duration_seconds": 1,
        "created_at": 1,
    }
    cursor = (
        db.call_sessions.find(query, projection)
        .sort("created_at", -1)
        .skip(skip)
        .limit(safe_limit)
    )
    sessions = [doc async for doc in cursor]
    summary = await _build_history_summary(db, query=query, user_id=user_id)
    if not sessions:
        return {
            "calls": [],
            "summary": summary,
            "pagination": {
                "total": total,
                "page": max(1, page),
                "limit": safe_limit,
                "total_pages": total_pages,
            },
        }

    contact_object_ids: list[ObjectId] = []
    campaign_ids: list[str] = []
    for session in sessions:
        raw_contact_id = session.get("campaign_contact_id")
        if raw_contact_id and isinstance(raw_contact_id, str) and ObjectId.is_valid(raw_contact_id):
            contact_object_ids.append(ObjectId(raw_contact_id))

        session_campaign_id = _safe_text(session.get("campaign_id")).strip()
        if session_campaign_id:
            campaign_ids.append(session_campaign_id)

    contact_name_by_id: dict[str, str] = {}
    if contact_object_ids:
        contact_cursor = db.campaign_contacts.find({"_id": {"$in": list(set(contact_object_ids))}})
        async for contact in contact_cursor:
            name = (
                (contact.get("csv_payload") or {}).get("customer_name")
                or (contact.get("csv_payload") or {}).get("name")
                or ""
            )
            contact_name_by_id[str(contact["_id"])] = _safe_text(name).strip()

    campaign_name_by_id: dict[str, str] = {}
    if campaign_ids:
        campaign_cursor = db.campaigns.find({"id": {"$in": list(set(campaign_ids))}, "user_id": user_id})
        async for campaign in campaign_cursor:
            cid = _safe_text(campaign.get("id")).strip()
            if cid:
                campaign_name_by_id[cid] = _safe_text(campaign.get("name")).strip() or cid


    history: list[dict[str, Any]] = []
    for session in sessions:
        mongo_id = session.get("_id")
        session_call_id = str(session.get("call_id") or "")
        campaign_contact_id = session.get("campaign_contact_id")
        customer_name = _safe_text(session.get("customer_name")).strip()
        if not customer_name and campaign_contact_id:
            customer_name = contact_name_by_id.get(str(campaign_contact_id), "")

        history.append(
            {
                "id": str(mongo_id) if mongo_id is not None else "",
                "call_id": session_call_id,
                "customer_name": customer_name or "Unknown",
                "phone_number": _safe_text(session.get("phone_number")).strip(),
                "status": _safe_text(session.get("status")).strip() or "unknown",
                "campaign_name": campaign_name_by_id.get(_safe_text(session.get("campaign_id")).strip()) or None,
                "started_at": session.get("started_at"),
                "duration_seconds": session.get("duration_seconds"),
            }
        )

    return {
        "calls": history,
        "summary": summary,
        "pagination": {
            "total": total,
            "page": max(1, page),
            "limit": safe_limit,
            "total_pages": total_pages,
        }
    }

async def get_call_details(
    *,
    user_id: str,
    call_id: str,
) -> dict[str, Any]:
    redis = get_redis()
    cache_key = f"call_details:{user_id}:{call_id}"

    if redis:
        cached = redis.get(cache_key)
        if cached:
            logger.info(f"Cache hit for call details: {user_id}:{call_id}")
            return json.loads(cached)
        logger.info(f"Cache miss for call details: {user_id}:{call_id}")

    db = get_db()

    session = await db.call_sessions.find_one(
        {
            "user_id": user_id,
            "call_id": call_id,
        },
        {
            "_id": 1,
            "call_id": 1,
            "customer_name": 1,
            "phone_number": 1,
            "status": 1,
            "provider": 1,
            "attempt_no": 1,
            "campaign_id": 1,
            "campaign_contact_id": 1,
            "started_at": 1,
            "ended_at": 1,
            "created_at": 1,
            "duration_seconds": 1,
            "answer_to_first_audio_ms": 1,
            "warm_start_used": 1,
            "audio_url": 1,
            "transcript": 1,
            "final_transcript": 1,
        },
    )

    if not session:
        raise HTTPException(status_code=404, detail="Call not found")

    campaign_name = None

    campaign_id = _safe_text(session.get("campaign_id")).strip()

    if campaign_id:
        campaign = await db.campaigns.find_one(
            {
                "id": campaign_id,
                "user_id": user_id,
            },
            {
                "name": 1,
            },
        )

        if campaign:
            campaign_name = _safe_text(campaign.get("name")).strip()

    # Step 1: Issabel structured transcript list  [{speaker, text}, ...]
    transcription = ""
    structured = session.get("transcript")
    if structured and isinstance(structured, list):
        transcription = _build_structured_transcript_text(structured)

    # Step 2: Exotel plain-string transcript
    if not transcription:
        transcription = _safe_text(session.get("final_transcript")).strip()

    # Step 3: conversation_events fallback (actor + content — not role/text)
    if not transcription:
        transcript_parts: list[str] = []
        events_cursor = (
            db.conversation_events.find({"call_id": call_id})
            .sort("created_at", 1)
        )
        async for event in events_cursor:
            actor = _safe_text(event.get("actor")).strip()
            text = _safe_text(event.get("content")).strip()
            if text:
                transcript_parts.append(f"{actor}: {text}")
        transcription = "\n".join(transcript_parts)

    result = {
        "id": str(session.get("_id")),
        "call_id": session.get("call_id"),
        "customer_name": _safe_text(session.get("customer_name")).strip(),
        "phone_number": _safe_text(session.get("phone_number")).strip(),
        "campaign_name": campaign_name,
        "started_at": session.get("started_at"),
        "ended_at": session.get("ended_at"),
        "created_at": session.get("created_at"),
        "duration_seconds": session.get("duration_seconds"),
        "audio_url": session.get("audio_url"),
        "transcription": transcription,
    }

    if redis:
        redis.setex(cache_key, 3600, json.dumps(jsonable_encoder(result)))
        logger.info(f"Cached call details for {user_id}:{call_id}")

    return result
