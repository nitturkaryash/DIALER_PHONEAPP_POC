from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends

from db.mongo import get_db
from utils.jwt_auth import current_user

router = APIRouter(prefix="/v1/dashboard/agent", tags=["dashboard"])

_CONNECTED_STATUSES = {"answered", "in_progress", "completed", "ended"}
_FAILED_STATUSES = {"failed", "busy", "no_answer", "canceled", "cancelled"}
_FATAL_END_REASONS = {
    "llm_error",
    "sip_setup_failed",
    "call_inactive_timeout",
    "call_max_duration_reached",
    "no_user_response_after_bot_audio",
    "bot_task_failed",
    "ivr_detected",
}
_QUALIFIED_OUTCOMES = {"qualified", "interested", "positive"}
_CONVERTED_OUTCOMES = {"converted", "sale", "won", "success", "booked"}
_LOST_OUTCOMES = {"lost", "invalid", "no answer", "busy", "not interested"}
_GHOST_END_REASONS = {"no_user_response_after_bot_audio", "ivr_detected", "call_inactive_timeout"}


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_token(value: Any) -> str:
    return _safe_text(value).lower().replace("_", " ").replace("-", " ")


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def _as_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _extract_quality_score(doc: dict[str, Any]) -> float | None:
    for key in ("quality_score", "quality_score_avg", "qa_score", "qa_quality_score"):
        score = _as_number(doc.get(key))
        if score is not None:
            return score

    qa = doc.get("qa")
    if isinstance(qa, dict):
        for key in ("quality_score", "score", "overall_score"):
            score = _as_number(qa.get(key))
            if score is not None:
                return score
    return None


def _extract_qa_categories(doc: dict[str, Any]) -> list[str]:
    categories: list[str] = []
    candidate_lists: list[Any] = [
        doc.get("qa_failed_params"),
        doc.get("qa_failures"),
        doc.get("failed_parameters"),
        doc.get("failed_qa_parameters"),
    ]
    qa = doc.get("qa")
    if isinstance(qa, dict):
        candidate_lists.extend([qa.get("failed_params"), qa.get("failed_parameters"), qa.get("failures")])

    for candidate in candidate_lists:
        if not isinstance(candidate, list):
            continue
        for item in candidate:
            if isinstance(item, str):
                token = _normalize_token(item)
                if token:
                    categories.append(token)
            elif isinstance(item, dict):
                token = _normalize_token(
                    item.get("category") or item.get("parameter") or item.get("name") or item.get("label")
                )
                if token:
                    categories.append(token)
    return categories


def _is_connected(doc: dict[str, Any]) -> bool:
    status = _normalize_token(doc.get("status"))
    outcome = _normalize_token(doc.get("outcome"))
    return status in _CONNECTED_STATUSES or any(token in outcome for token in ("connected", "qualified", "converted"))


def _is_failed(doc: dict[str, Any]) -> bool:
    status = _normalize_token(doc.get("status"))
    outcome = _normalize_token(doc.get("outcome"))
    return status in _FAILED_STATUSES or any(token in outcome for token in ("no answer", "busy", "invalid", "failed"))


def _is_fatal(doc: dict[str, Any]) -> bool:
    status = _normalize_token(doc.get("status"))
    end_reason = _normalize_token(doc.get("end_reason"))
    failure_reason = _normalize_token(doc.get("failure_reason"))
    return status == "failed" or end_reason in _FATAL_END_REASONS or bool(failure_reason)


def _is_qualified(doc: dict[str, Any]) -> bool:
    outcome = _normalize_token(doc.get("outcome"))
    return outcome in _QUALIFIED_OUTCOMES or "qualified" in outcome or "interested" in outcome


def _is_converted(doc: dict[str, Any]) -> bool:
    outcome = _normalize_token(doc.get("outcome"))
    return outcome in _CONVERTED_OUTCOMES or "converted" in outcome or "won" in outcome


def _is_lost(doc: dict[str, Any]) -> bool:
    outcome = _normalize_token(doc.get("outcome"))
    return outcome in _LOST_OUTCOMES or "lost" in outcome or "invalid" in outcome


def _is_ghost(doc: dict[str, Any]) -> bool:
    end_reason = _normalize_token(doc.get("end_reason"))
    return end_reason in _GHOST_END_REASONS


def _humanize(token: str) -> str:
    return " ".join(part.capitalize() for part in token.split())


def _date_window(days: int) -> list[str]:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    return [(start + timedelta(days=offset)).isoformat() for offset in range(days)]


@router.get("/summary")
async def agent_summary(user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    now = datetime.now(timezone.utc)

    projection = {
        "_id": 0,
        "status": 1,
        "outcome": 1,
        "end_reason": 1,
        "failure_reason": 1,
        "duration_seconds": 1,
        "callback_time": 1,
        "quality_score": 1,
        "quality_score_avg": 1,
        "qa_score": 1,
        "qa_quality_score": 1,
        "qa": 1,
    }
    cursor = db.call_sessions.find({"user_id": user_id}, projection)

    total_calls = connected_calls = failed_calls = fatal_calls = 0
    conversion_count = qualified_count = lost_leads = ghost_leads = 0
    followups_due = callbacks_booked = 0
    talk_time_total = 0
    duration_count = 0
    quality_score_total = 0.0
    quality_score_count = 0

    async for doc in cursor:
        total_calls += 1

        duration = int(_as_number(doc.get("duration_seconds")) or 0)
        if duration > 0:
            talk_time_total += duration
            duration_count += 1

        if _is_connected(doc):
            connected_calls += 1
        if _is_failed(doc):
            failed_calls += 1
        if _is_fatal(doc):
            fatal_calls += 1
        if _is_qualified(doc):
            qualified_count += 1
        if _is_converted(doc):
            conversion_count += 1
        if _is_lost(doc):
            lost_leads += 1
        if _is_ghost(doc):
            ghost_leads += 1

        callback_time = _as_datetime(doc.get("callback_time"))
        if callback_time is not None:
            callbacks_booked += 1
            if callback_time <= now:
                followups_due += 1

        quality_score = _extract_quality_score(doc)
        if quality_score is not None:
            quality_score_total += quality_score
            quality_score_count += 1

    conversion_rate = (conversion_count / connected_calls * 100.0) if connected_calls else 0.0
    quality_score_avg = (quality_score_total / quality_score_count) if quality_score_count else 0.0
    avg_call_duration = (talk_time_total / duration_count) if duration_count else 0.0

    return {
        "ok": True,
        "summary": {
            "total_calls": total_calls,
            "connected_calls": connected_calls,
            "failed_calls": failed_calls,
            "fatal_calls": fatal_calls,
            "quality_score_avg": round(quality_score_avg, 2),
            "conversion_count": conversion_count,
            "conversion_rate": round(conversion_rate, 2),
            "avg_call_duration": round(avg_call_duration, 2),
            "talk_time_total": talk_time_total,
            "followups_due": followups_due,
            "lost_leads": lost_leads,
            "ghost_leads": ghost_leads,
            "callbacks_booked": callbacks_booked,
            "qualified_calls": qualified_count,
        },
    }


@router.get("/trends")
async def agent_trends(user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    now = datetime.now(timezone.utc)
    start_30 = datetime.combine((now - timedelta(days=29)).date(), datetime.min.time(), tzinfo=timezone.utc)

    projection = {
        "_id": 0,
        "created_at": 1,
        "started_at": 1,
        "status": 1,
        "outcome": 1,
        "end_reason": 1,
        "failure_reason": 1,
        "quality_score": 1,
        "quality_score_avg": 1,
        "qa_score": 1,
        "qa_quality_score": 1,
        "qa": 1,
    }

    daily: dict[str, dict[str, Any]] = {}
    for date_key in _date_window(30):
        daily[date_key] = {
            "date": date_key,
            "calls": 0,
            "connected_calls": 0,
            "fatal_calls": 0,
            "quality_score_sum": 0.0,
            "quality_score_count": 0,
            "conversions": 0,
        }

    cursor = db.call_sessions.find({"user_id": user_id, "created_at": {"$gte": start_30}}, projection)
    async for doc in cursor:
        stamp = _as_datetime(doc.get("created_at")) or _as_datetime(doc.get("started_at"))
        if stamp is None:
            continue
        date_key = stamp.date().isoformat()
        bucket = daily.get(date_key)
        if bucket is None:
            continue
        bucket["calls"] += 1
        if _is_connected(doc):
            bucket["connected_calls"] += 1
        if _is_fatal(doc):
            bucket["fatal_calls"] += 1
        if _is_converted(doc):
            bucket["conversions"] += 1
        quality = _extract_quality_score(doc)
        if quality is not None:
            bucket["quality_score_sum"] += quality
            bucket["quality_score_count"] += 1

    series_30: list[dict[str, Any]] = []
    for date_key in _date_window(30):
        bucket = daily[date_key]
        q_count = bucket["quality_score_count"]
        series_30.append(
            {
                "date": bucket["date"],
                "calls": bucket["calls"],
                "connected_calls": bucket["connected_calls"],
                "fatal_calls": bucket["fatal_calls"],
                "quality_score_avg": round(bucket["quality_score_sum"] / q_count, 2) if q_count else 0.0,
                "conversions": bucket["conversions"],
            }
        )

    return {
        "ok": True,
        "trends": {
            "last_7_days": series_30[-7:],
            "last_30_days": series_30,
        },
    }


@router.get("/failure-breakdown")
async def failure_breakdown(user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    projection = {
        "_id": 0,
        "status": 1,
        "end_reason": 1,
        "failure_reason": 1,
        "qa_failed_params": 1,
        "qa_failures": 1,
        "failed_parameters": 1,
        "failed_qa_parameters": 1,
        "qa": 1,
    }

    reason_counts: Counter[str] = Counter()
    qa_counts: Counter[str] = Counter()
    cursor = db.call_sessions.find({"user_id": user_id}, projection)
    async for doc in cursor:
        if not _is_fatal(doc):
            continue
        reason = _normalize_token(doc.get("end_reason")) or _normalize_token(doc.get("failure_reason")) or "unknown"
        reason_counts[reason] += 1
        qa_counts.update(_extract_qa_categories(doc))

    top_reasons = [
        {"reason": _humanize(reason), "count": count}
        for reason, count in reason_counts.most_common(8)
    ]
    top_qa_categories = [
        {"category": _humanize(category), "count": count}
        for category, count in qa_counts.most_common(8)
    ]

    coaching_insights: list[str] = []
    if top_reasons:
        coaching_insights.append(f"Top fatal driver: {top_reasons[0]['reason']}.")
    if top_qa_categories:
        coaching_insights.append(f"Most frequent QA gap: {top_qa_categories[0]['category']}.")
    if not coaching_insights:
        coaching_insights.append("No critical fatal patterns detected in the current call sample.")

    return {
        "ok": True,
        "breakdown": {
            "fatal_reasons": top_reasons,
            "top_failed_qa_categories": top_qa_categories,
            "coaching_insights": coaching_insights,
        },
    }


@router.get("/conversion-funnel")
async def conversion_funnel(user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")

    projection = {"_id": 0, "status": 1, "outcome": 1}
    attempted = connected = qualified = converted = lost = 0

    cursor = db.call_sessions.find({"user_id": user_id}, projection)
    async for doc in cursor:
        attempted += 1
        if _is_connected(doc):
            connected += 1
        if _is_qualified(doc):
            qualified += 1
        if _is_converted(doc):
            converted += 1
        if _is_lost(doc):
            lost += 1

    conversion_rate = (converted / connected * 100.0) if connected else 0.0
    return {
        "ok": True,
        "funnel": {
            "attempted": attempted,
            "connected": connected,
            "qualified": min(qualified, connected),
            "converted": min(converted, connected),
            "lost": min(lost, attempted),
            "conversion_rate": round(conversion_rate, 2),
        },
    }
