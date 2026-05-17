"""LiveKit SIP outbound calling for customer verification.

This module:
1. Creates a unique LiveKit room per outbound phone call
2. Starts a Pipecat bot in that same room
3. Dials the callee as a SIP participant via a LiveKit outbound trunk
"""

import asyncio
import json
import time
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from io import BytesIO
from typing import Any, Callable, Optional
from uuid import uuid4

from livekit import api
import httpx
from fastapi import HTTPException, status
from loguru import logger
from pypdf import PdfReader
from config import config
from db.mongo import get_db
from models.outbound_calls import CallStatus, OutboundCallRequest, WarmBotWorker
from services.callback_bot_service import BotSessionObserver, run_bot
from services.call_artifact_service import (
    append_audio_chunk,
    append_transcript_turn,
    finalize_assistant_audio_turn,
    persist_call_artifacts,
)
from services.conversation_service import append_event
from services.ivr_detection_service import detect_ivr_from_turns
from services.knowledge_ingestion_service import embed_pdf_bytes_for_search
from services.knowledge_retrieval_service import register_temporary_knowledge
from pipecat.runner.types import LiveKitRunnerArguments
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport


# In-memory store for active calls (use Redis in production)
_active_calls: dict[str, dict] = {}
_bot_tasks: dict[str, asyncio.Task] = {}
_call_watch_tasks: dict[str, asyncio.Task] = {}
_call_watchdog_tasks: dict[str, asyncio.Task] = {}
_issabel_bootstrap_tasks: dict[str, asyncio.Task] = {}
_completed_call_eviction_tasks: dict[str, asyncio.Task] = {}
_warm_workers: dict[str, WarmBotWorker] = {}
_warm_pool_task: asyncio.Task | None = None
_warm_pool_last_replenish_at: datetime | None = None
_warm_pool_lock = asyncio.Lock()
_warm_pool_ensure_lock = asyncio.Lock()

BOT_JOIN_TIMEOUT_SECS = 15


def _request_value(request: OutboundCallRequest, *names: str) -> Any:
    extras = getattr(request, "model_extra", None) or {}
    for name in names:
        value = getattr(request, name, None)
        if value is not None:
            return value
        if isinstance(extras, dict) and extras.get(name) is not None:
            return extras[name]
    return None


def _clean_string(value: Any) -> str:
    return str(value or "").strip()


def _normalize_language_code(value: Any) -> str:
    clean = _clean_string(value)
    lowered = clean.lower().replace("_", "-")
    if lowered in {"en-in", "english", "english-india", "english (india)"}:
        return "en-IN"
    if lowered in {"hi-in", "hindi", "hindi-india", "hindi (india)"}:
        return "hi-IN"
    if lowered in {"kn-in", "kannada", "kannada-india", "kannada (india)"}:
        return "kn-IN"
    return clean


def _normalize_request_bot_config(request: OutboundCallRequest) -> None:
    """Fold direct-call UI fields into verification_context.bot_config."""
    context = dict(request.verification_context or {})
    nested = context.get("bot_config")
    bot_config = dict(nested) if isinstance(nested, dict) else {}

    top_level = _request_value(request, "bot_config", "botConfig")
    if isinstance(top_level, dict):
        bot_config.update(top_level)

    string_fields = {
        "initial_greeting": ("initial_greeting", "opening_greeting", "initialGreeting", "openingGreeting"),
        "bot_system_prompt": ("bot_system_prompt", "system_prompt", "botSystemPrompt", "systemPrompt"),
        "tts_prompt_template": (
            "tts_prompt_template",
            "style_instructions",
            "ttsPromptTemplate",
            "styleInstructions",
        ),
        "tts_speed": ("tts_speed", "ttsSpeed"),
        "tts_tone": ("tts_tone", "ttsTone"),
        "voice_agent": ("voice_agent", "voice", "voiceAgent"),
        "outbound_knowledge_token": (
            "outbound_knowledge_token",
            "knowledge_token",
            "outboundKnowledgeToken",
            "knowledgeToken",
        ),
        "bot_knowledge": ("bot_knowledge", "botKnowledge"),
    }
    for target, aliases in string_fields.items():
        clean = _clean_string(_request_value(request, *aliases))
        if clean:
            bot_config[target] = clean

    barge_in_value = _request_value(request, "barge_in", "bargeIn")
    if barge_in_value is not None:
        bot_config["barge_in"] = bool(barge_in_value)

    language = _normalize_language_code(_request_value(request, "tts_language", "language", "ttsLanguage"))
    if language:
        bot_config["tts_language"] = language

    collect_fields = _request_value(request, "collect_fields", "collectFields")
    if isinstance(collect_fields, list):
        bot_config["collect_fields"] = collect_fields

    if bot_config:
        context["bot_config"] = bot_config
    request.verification_context = context


async def extract_outbound_pdf_knowledge(
    *,
    filename: str,
    pdf_bytes: bytes,
    content_type: str | None = None,
) -> dict:
    """Embed an uploaded PDF for one-off outbound retrieval without storing it in DB."""
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty PDF upload.")

    max_bytes = max(1_000_000, config.int_setting("KNOWLEDGE_MAX_PDF_BYTES", 50_000_000))
    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"PDF too large. Max allowed size is {max_bytes // (1024 * 1024)} MB "
                f"(received {len(pdf_bytes) // (1024 * 1024)} MB)."
            ),
        )

    clean_name = (filename or "knowledge.pdf").strip() or "knowledge.pdf"
    normalized_content_type = str(content_type or "").strip().lower()
    looks_like_pdf_mime = normalized_content_type == "application/pdf" or normalized_content_type.endswith("+pdf")
    looks_like_pdf = bytes(pdf_bytes[:5]) == b"%PDF-"
    if not clean_name.lower().endswith(".pdf") and not (looks_like_pdf or looks_like_pdf_mime):
        raise HTTPException(status_code=400, detail="Only PDF files are supported. Upload a .pdf file.")

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
    except Exception as exc:
        logger.warning(f"Outbound PDF parse failed: {exc}")
        raise HTTPException(status_code=400, detail="Could not read the uploaded PDF.")

    try:
        chunks, page_count = await embed_pdf_bytes_for_search(pdf_bytes)
    except Exception as exc:
        logger.warning(f"Outbound PDF embedding failed: {exc}")
        raise HTTPException(status_code=400, detail=f"Could not prepare the uploaded PDF for search: {exc}")

    token_payload = register_temporary_knowledge(chunks)
    return {
        "ok": True,
        "filename": clean_name,
        "pages": page_count,
        "knowledge_token": token_payload["token"],
        "expires_at": token_payload["expires_at"],
        "knowledge_chunks": len(chunks),
    }


def _call_status_from_info(call_id: str, call_info: dict) -> CallStatus:
    return CallStatus(
        call_id=call_id,
        status=call_info.get("status", "queued"),
        phone_number=call_info.get("phone_number", ""),
        call_requested_at=call_info.get("call_requested_at"),
        warm_worker_reserved_at=call_info.get("warm_worker_reserved_at"),
        sip_dial_started_at=call_info.get("sip_dial_started_at"),
        sip_joined_at=call_info.get("sip_joined_at"),
        first_bot_audio_at=call_info.get("first_bot_audio_at"),
        first_user_audio_at=call_info.get("first_user_audio_at"),
        started_at=call_info.get("started_at"),
        ended_at=call_info.get("ended_at"),
        duration_seconds=call_info.get("duration_seconds"),
        warm_start_used=bool(call_info.get("warm_start_used")),
        answer_to_first_audio_ms=call_info.get("answer_to_first_audio_ms"),
    )


def _is_terminal_call_status(status: Optional[str]) -> bool:
    normalized = str(status or "").strip().lower().replace("-", "_").replace(" ", "_")
    return normalized in {"completed", "failed", "busy", "no_answer", "canceled", "cancelled"}


def _completed_call_ttl_secs() -> int:
    try:
        return max(10, config.int_setting("COMPLETED_CALL_TTL_SECS", 30))
    except Exception:
        return 30


def _call_max_duration_secs() -> int:
    try:
        return max(60, config.int_setting("CALL_MAX_DURATION_SECS", 1200))
    except Exception:
        return 1200


def _call_inactivity_timeout_secs() -> int:
    try:
        return max(30, config.int_setting("CALL_INACTIVITY_TIMEOUT_SECS", 300))
    except Exception:
        return 300


def _cleanup_call_watchdog(call_id: str):
    task = _call_watchdog_tasks.pop(call_id, None)
    if task and not task.done():
        task.cancel()


def _schedule_call_watchdog(call_id: Optional[str]):
    if not call_id:
        return

    existing = _call_watchdog_tasks.get(call_id)
    if existing and not existing.done():
        return

    async def _watchdog():
        check_interval = max(5.0, min(30.0, _call_inactivity_timeout_secs() / 2.0))

        while True:
            call_info = _active_calls.get(call_id)
            if not call_info:
                return
            if not call_info.get("call_id"):
                return
            if call_info.get("ended_at") or _is_terminal_call_status(call_info.get("status")):
                return

            now = time.monotonic()
            started_at = float(call_info.get("monotonic_started_at") or now)
            last_activity = float(
                call_info.get("last_activity_monotonic_at")
                or call_info.get("last_audio_monotonic_at")
                or started_at
            )

            reason = None
            if now - started_at >= _call_max_duration_secs():
                reason = "call_max_duration_reached"
            elif now - last_activity >= _call_inactivity_timeout_secs():
                reason = "call_inactive_timeout"

            if reason:
                call_info["status"] = "failed"
                call_info["end_reason"] = reason
                call_info["failure_reason"] = reason
                call_info["ended_at"] = datetime.now()
                _update_call_duration(call_info)
                await persist_call_artifacts(call_info)
                await _persist_call_session(call_info)

                provider = call_info.get("provider")
                room_name = call_info.get("room_name")
                if provider == "livekit-sip" and room_name:
                    await _cleanup_room(room_name)
                elif provider == "issabel-sip":
                    if call_id:
                        task = _bot_tasks.get(call_id)
                        if task and not task.done():
                            task.cancel()
                    _cleanup_call_watch(call_id)

                _schedule_completed_call_eviction(call_id)
                return

            await asyncio.sleep(check_interval)

    task = asyncio.create_task(_watchdog(), name=f"call-watchdog:{call_id}")
    _call_watchdog_tasks[call_id] = task

    def _cleanup_done(finished: asyncio.Task, *, cid: str = call_id):
        if _call_watchdog_tasks.get(cid) is finished:
            _call_watchdog_tasks.pop(cid, None)
        with suppress(asyncio.CancelledError):
            finished.exception()

    task.add_done_callback(_cleanup_done)


def _schedule_completed_call_eviction(call_id: Optional[str]):
    if not call_id:
        return

    call_info = _active_calls.get(call_id)
    if not call_info or not _is_terminal_call_status(call_info.get("status")) or not call_info.get("ended_at"):
        return

    existing = _completed_call_eviction_tasks.get(call_id)
    if existing and not existing.done():
        return

    async def _evict_when_ready():
        while True:
            latest = _active_calls.get(call_id)
            if not latest:
                return
            if not _is_terminal_call_status(latest.get("status")) or not latest.get("ended_at"):
                return

            age_seconds = (datetime.now() - latest["ended_at"]).total_seconds()
            remaining = _completed_call_ttl_secs() - age_seconds
            if remaining <= 0:
                _active_calls.pop(call_id, None)
                _cleanup_call_watchdog(call_id)
                _cleanup_call_watch(call_id)
                return

            await asyncio.sleep(min(remaining, 30))

    task = asyncio.create_task(_evict_when_ready(), name=f"completed-call-evict:{call_id}")
    _completed_call_eviction_tasks[call_id] = task

    def _cleanup_done(finished: asyncio.Task, *, cid: str = call_id):
        if _completed_call_eviction_tasks.get(cid) is finished:
            _completed_call_eviction_tasks.pop(cid, None)
        with suppress(asyncio.CancelledError):
            finished.exception()

    task.add_done_callback(_cleanup_done)


async def _load_persisted_call_status(call_id: str) -> Optional[CallStatus]:
    try:
        db = get_db()
    except Exception:
        return None

    record = await db.call_sessions.find_one({"call_id": call_id})
    if not record:
        return None

    return _call_status_from_info(
        call_id,
        {
            "status": record.get("status", "unknown"),
            "phone_number": record.get("phone_number", ""),
            "call_requested_at": record.get("call_requested_at") or record.get("created_at"),
            "warm_worker_reserved_at": record.get("warm_worker_reserved_at"),
            "sip_dial_started_at": record.get("sip_dial_started_at"),
            "sip_joined_at": record.get("sip_joined_at"),
            "first_bot_audio_at": record.get("first_bot_audio_at"),
            "first_user_audio_at": record.get("first_user_audio_at"),
            "started_at": record.get("started_at"),
            "ended_at": record.get("ended_at"),
            "duration_seconds": record.get("duration_seconds"),
            "warm_start_used": bool(record.get("warm_start_used")),
            "answer_to_first_audio_ms": record.get("answer_to_first_audio_ms"),
        },
    )


async def _persist_call_session(call_info: dict):
    call_id = call_info.get("call_id")
    if not call_id:
        return
    try:
        db = get_db()
    except Exception as exc:
        logger.warning(f"Skipping call_session persistence; MongoDB unavailable ({call_id=}): {exc}")
        call_info["status"] = "failed"
        call_info["end_reason"] = "call_session_db_unavailable"
        call_info["failure_reason"] = str(exc)
        call_info.setdefault("ended_at", datetime.now())
        return

    payload = {
        "call_id": call_id,
        "user_id": call_info.get("user_id"),
        "campaign_id": call_info.get("campaign_id"),
        "campaign_contact_id": call_info.get("campaign_contact_id"),
        "bot_config": call_info.get("bot_config") if isinstance(call_info.get("bot_config"), dict) else {},
        "phone_number": call_info.get("phone_number"),
        "customer_name": call_info.get("customer_name"),
        "customer_id": call_info.get("customer_id"),
        "status": call_info.get("status"),
        "end_reason": call_info.get("end_reason"),
        "attempt_no": int(call_info.get("retry_count", 0)),
        "provider": call_info.get("provider"),
        "call_mode": call_info.get("call_mode"),
        "room_name": call_info.get("room_name"),
        "sip_call_to": call_info.get("sip_call_to"),
        "agent_joined_at": call_info.get("agent_joined_at"),
        "agent_identity": call_info.get("agent_identity"),
        "call_requested_at": call_info.get("call_requested_at"),
        "warm_worker_reserved_at": call_info.get("warm_worker_reserved_at"),
        "sip_dial_started_at": call_info.get("sip_dial_started_at"),
        "sip_joined_at": call_info.get("sip_joined_at"),
        "first_bot_audio_at": call_info.get("first_bot_audio_at"),
        "first_user_audio_at": call_info.get("first_user_audio_at"),
        "started_at": call_info.get("started_at"),
        "ended_at": call_info.get("ended_at"),
        "duration_seconds": call_info.get("audio_duration_seconds", call_info.get("duration_seconds")),
        "answer_to_first_audio_ms": call_info.get("answer_to_first_audio_ms"),
        "warm_start_used": bool(call_info.get("warm_start_used")),
        "sip_joined_at": call_info.get("sip_joined_at"),
        "first_bot_audio_at": call_info.get("first_bot_audio_at"),
        "first_user_audio_at": call_info.get("first_user_audio_at"),
        "created_at": call_info.get("call_requested_at") or datetime.now(),
        "updated_at": datetime.now(),
    }
    try:
        await db.call_sessions.update_one({"call_id": call_id}, {"$set": payload}, upsert=True)
    except Exception as exc:
        logger.warning(f"call_session persistence failed ({call_id=}): {exc}")
        call_info["status"] = "failed"
        call_info["end_reason"] = "call_session_persist_failed"
        call_info["failure_reason"] = str(exc)
        call_info.setdefault("ended_at", datetime.now())
        return
    if _is_terminal_call_status(call_info.get("status")) and call_info.get("ended_at"):
        _schedule_completed_call_eviction(call_id)


async def _persist_conversation_event(call_info: dict, actor: str, event_type: str, content: str):
    call_id = call_info.get("call_id")
    if not call_id:
        return
    try:
        await append_event(
            call_id=call_id,
            user_id=call_info.get("user_id"),
            actor=actor,
            event_type=event_type,
            content=content,
        )
    except Exception as exc:
        logger.warning(f"Failed to persist conversation event ({call_id=}, {actor=}, {event_type=}): {exc}")
        return


def _warm_pool_enabled() -> bool:
    if not _livekit_configured():
        return False
    return config.bool_setting("WARM_BOT_POOL_ENABLED", False)


def _warm_pool_size() -> int:
    return max(0, config.int_setting("WARM_BOT_POOL_SIZE", 1))


def _warm_worker_idle_ttl_secs() -> int:
    return max(30, config.int_setting("WARM_BOT_IDLE_TTL_SECS", 90))


def _livekit_configured() -> bool:
    return bool(config.setting("LIVEKIT_URL")) and bool(config.setting("LIVEKIT_API_KEY")) and bool(
        config.setting("LIVEKIT_API_SECRET")
    )


def _outbound_provider_preference() -> str:
    return config.setting("OUTBOUND_PROVIDER", "auto").lower()


def _exotel_config(user_config: dict | None = None) -> dict:
    uc = user_config or {}

    # Prioritize user-specific config from DB, then fall back to global config
    sid = _clean_string(uc.get("exotel_sid")) or config.setting("EXOTEL_SID")
    api_key = _clean_string(uc.get("exotel_api_key")) or config.setting("EXOTEL_API_KEY")
    api_token = _clean_string(uc.get("exotel_api_token")) or config.setting("EXOTEL_API_TOKEN")
    caller_id = _clean_string(uc.get("exotel_caller_id")) or config.setting("EXOTEL_CALLER_ID")
    base_url = config.setting("EXOTEL_API_BASE_URL", "https://api.exotel.com")
    flow_url = _clean_string(uc.get("exotel_flow_url")) or config.setting("EXOTEL_FLOW_URL")
    app_id = config.setting("EXOTEL_APP_ID")
    flow_base = config.setting("EXOTEL_FLOW_BASE_URL")
    call_type = config.setting("EXOTEL_CALL_TYPE", "trans")
    status_callback = config.setting("EXOTEL_STATUS_CALLBACK")

    if not base_url.startswith("http"):
        base_url = f"https://{base_url}"

    if not flow_base:
        # Default to the documented Exotel flow URL format.
        # Example: http://my.exotel.com/{sid}/exoml/start_voice/{app_id}
        flow_base = f"http://my.exotel.com/{sid}/exoml/start_voice" if sid else "http://my.exotel.com/exoml/start_voice"

    if not flow_url and app_id:
        flow_url = f"{flow_base.rstrip('/')}/{app_id}"

    return {
        "sid": sid,
        "api_key": api_key,
        "api_token": api_token,
        "caller_id": caller_id,
        "base_url": base_url,
        "flow_url": flow_url,
        "call_type": call_type,
        "status_callback": status_callback,
    }


def _exotel_enabled(user_config: dict | None = None) -> bool:
    if _outbound_provider_preference() in {"livekit", "sip"}:
        return False
    conf = _exotel_config(user_config)
    return all([conf["sid"], conf["api_key"], conf["api_token"], conf["caller_id"], conf["flow_url"]])


def current_outbound_provider(user_config: dict | None = None) -> str:
    provider_preference = _outbound_provider_preference()

    if provider_preference in {"livekit", "sip"}:
        return "livekit-sip" if _livekit_configured() else "disabled"
    if provider_preference == "exotel":
        return "exotel" if _exotel_enabled(user_config) else "disabled"
    if provider_preference in {"issabel", "direct"}:
        return "issabel-sip" if _issabel_direct_enabled(user_config) else "disabled"

    if _issabel_direct_enabled(user_config):
        return "issabel-sip"
    if _exotel_enabled(user_config):
        return "exotel"
    if _livekit_configured():
        return "livekit-sip"
    return "disabled"


def _issabel_direct_enabled(user_config: dict | None = None) -> bool:
    if not config.bool_setting("OUTBOUND_ISSABEL_DIRECT", True):
        return False
    uc = user_config or {}
    host = _clean_string(uc.get("issabel_host")) or config.setting("ISSABEL_SIP_HOST")
    pwd = _clean_string(uc.get("issabel_password")) or config.setting("ISSABEL_SIP_PASSWORD")
    return bool(host and pwd)


def _parse_exotel_sid(response_text: str, content_type: str | None) -> Optional[str]:
    content_type = (content_type or "").lower()
    if "json" in content_type:
        try:
            payload = json.loads(response_text)
            call = payload.get("Call") or payload.get("call") or {}
            return call.get("Sid") or call.get("sid")
        except Exception:
            return None

    try:
        root = ET.fromstring(response_text)
        sid_node = root.find(".//Sid")
        return sid_node.text.strip() if sid_node is not None and sid_node.text else None
    except Exception:
        return None


async def _create_exotel_outbound_call(request: OutboundCallRequest) -> str:
    user_id = (request.verification_context or {}).get("user_id")
    user_conf = await get_user_outbound_config(user_id)
    exotel_conf = _exotel_config(user_conf)

    if not _exotel_enabled(user_conf):
        raise HTTPException(status_code=500, detail="Exotel outbound is not configured for this user.")

    url = f"{exotel_conf['base_url'].rstrip('/')}/v1/Accounts/{exotel_conf['sid']}/Calls/connect"
    payload = {
        "From": request.phone_number.strip(),
        "CallerId": exotel_conf["caller_id"],
        "CallType": exotel_conf["call_type"],
        "Url": exotel_conf["flow_url"],
    }
    if exotel_conf["status_callback"] or request.callback_url:
        payload["StatusCallback"] = (request.callback_url or exotel_conf["status_callback"]).strip()
    if request.customer_id:
        payload["CustomField"] = request.customer_id

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            auth=(exotel_conf["api_key"], exotel_conf["api_token"]),
        ) as client:
            response = await client.post(url, data=payload)
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=response.text)
    except httpx.TimeoutException as exc:
        logger.error(f"Exotel connect request timed out: {exc}")
        raise HTTPException(status_code=504, detail="Timed out contacting Exotel while creating the outbound call.")
    except httpx.RequestError as exc:
        logger.error(f"Exotel connect request failed: {exc}")
        raise HTTPException(status_code=502, detail="Failed to contact Exotel while creating the outbound call.")

    call_id = _parse_exotel_sid(response.text, response.headers.get("content-type"))
    if not call_id:
        raise HTTPException(status_code=500, detail="Exotel connect succeeded but CallSid was not found in response.")

    bot_config = (request.verification_context or {}).get("bot_config")
    if not isinstance(bot_config, dict):
        bot_config = {}

    _active_calls[call_id] = {
        "call_id": call_id,
        "status": "queued",
        "phone_number": request.phone_number,
        "customer_name": request.customer_name,
        "customer_id": request.customer_id,
        "call_requested_at": datetime.now(),
        "started_at": datetime.now(),
        "provider": "exotel",
        "exotel_ws_connected": False,
        "exotel_ws_closed": False,
        "campaign_id": (request.verification_context or {}).get("campaign_id"),
        "campaign_contact_id": (request.verification_context or {}).get("campaign_contact_id"),
        "retry_count": (request.verification_context or {}).get("retry_count", 0),
        "user_id": (request.verification_context or {}).get("user_id"),
        "bot_config": bot_config,
        "monotonic_started_at": time.monotonic(),
    }
    await _persist_call_session(_active_calls[call_id])
    _schedule_call_watchdog(call_id)
    return call_id


def _promote_issabel_call_to_exotel_fallback(issabel_call_id: str, exotel_call_id: str):
    """Keep the original Issabel call id while switching provider tracking to Exotel."""
    original = _active_calls.get(issabel_call_id)
    exotel_info = _active_calls.get(exotel_call_id)
    if not original or not exotel_info:
        return

    merged = dict(exotel_info)
    merged["call_id"] = issabel_call_id
    merged["provider"] = "exotel"
    merged["provider_call_id"] = exotel_call_id
    merged["fallback_from"] = "issabel-sip"
    merged["phone_number"] = original.get("phone_number") or exotel_info.get("phone_number")
    merged["customer_name"] = original.get("customer_name") or exotel_info.get("customer_name")
    merged["customer_id"] = original.get("customer_id") or exotel_info.get("customer_id")
    merged["call_requested_at"] = original.get("call_requested_at") or exotel_info.get("call_requested_at")
    merged["started_at"] = original.get("started_at") or exotel_info.get("started_at")
    merged["exotel_ws_connected"] = bool(exotel_info.get("exotel_ws_connected"))
    merged["exotel_ws_closed"] = bool(exotel_info.get("exotel_ws_closed"))
    _active_calls[issabel_call_id] = merged


def _exotel_call_infos_for_sid(call_sid: str) -> list[dict]:
    out: list[dict] = []
    for info in _active_calls.values():
        if info.get("provider") != "exotel":
            continue
        if info.get("call_id") == call_sid or info.get("provider_call_id") == call_sid:
            out.append(info)
    return out


def mark_exotel_voice_websocket_connected(call_sid: str) -> None:
    if not (call_sid or "").strip():
        return
    for info in _exotel_call_infos_for_sid(call_sid.strip()):
        info["exotel_ws_connected"] = True


def mark_exotel_voice_websocket_disconnected(call_sid: str) -> None:
    if not (call_sid or "").strip():
        return
    sid = call_sid.strip()
    for info in _exotel_call_infos_for_sid(sid):
        info["exotel_ws_closed"] = True
        if str(info.get("status") or "").lower() == "disconnecting":
            info["status"] = "completed"
            if not info.get("ended_at"):
                info["ended_at"] = datetime.now()
            _update_call_duration(info)


def _exotel_ws_should_defer_completed(api_call_id: str) -> bool:
    for info in _exotel_call_infos_for_sid(api_call_id):
        if info.get("exotel_ws_connected") and not info.get("exotel_ws_closed"):
            return True
    return False


async def _get_exotel_call_status(call_id: str) -> Optional[CallStatus]:
    call_info = _active_calls.get(call_id, {})
    user_id = call_info.get("user_id")
    user_conf = await get_user_outbound_config(user_id)

    if not _exotel_enabled(user_conf):
        return None

    exotel_conf = _exotel_config(user_conf)
    url = f"{exotel_conf['base_url'].rstrip('/')}/v1/Accounts/{exotel_conf['sid']}/Calls/{call_id}.json"
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            auth=(exotel_conf["api_key"], exotel_conf["api_token"]),
        ) as client:
            response = await client.get(url)
            if response.status_code == 404:
                return None
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=response.text)
    except httpx.TimeoutException as exc:
        logger.warning(f"Exotel status lookup timed out for {call_id}: {exc}")
        if call_info:
            return _call_status_from_info(call_id, call_info)
        raise HTTPException(status_code=504, detail="Timed out while checking Exotel call status.")
    except httpx.RequestError as exc:
        logger.warning(f"Exotel status lookup failed for {call_id}: {exc}")
        if call_info:
            return _call_status_from_info(call_id, call_info)
        raise HTTPException(status_code=502, detail="Failed to contact Exotel while checking call status.")

    payload = response.json()
    call = payload.get("Call") or payload.get("call") or {}
    raw_status = call.get("Status") or call.get("status") or "queued"
    status = str(raw_status).lower().replace("-", "_")
    phone_number = call.get("To") or call.get("From") or ""

    alias_rows = _exotel_call_infos_for_sid(call_id)
    if alias_rows:
        if phone_number:
            for info in alias_rows:
                info["phone_number"] = phone_number
        if status == "completed" and _exotel_ws_should_defer_completed(call_id):
            for info in alias_rows:
                info["status"] = "disconnecting"
        elif status in {"completed", "failed"}:
            ended_at = datetime.now()
            for info in alias_rows:
                if not info.get("ended_at"):
                    info["ended_at"] = ended_at
                _update_call_duration(info)
                info["status"] = status
        else:
            for info in alias_rows:
                info["status"] = status
        return _call_status_from_info(call_id, alias_rows[0])

    call_info["status"] = status
    if phone_number:
        call_info["phone_number"] = phone_number
    if status in {"completed", "failed"} and not call_info.get("ended_at"):
        call_info["ended_at"] = datetime.now()
        _update_call_duration(call_info)
    return _call_status_from_info(call_id, call_info)


def _fixed_initial_greeting() -> str:
    # Empty means no fixed greeting; bot can open naturally from prompt.
    return config.setting("OUTBOUND_FIXED_GREETING")


def _warm_room_name() -> str:
    return f"verification-warm-{uuid4().hex[:12]}"


def _set_timestamp_once(call_info: Optional[dict], key: str, value: Optional[datetime] = None):
    if not call_info or call_info.get(key):
        return

    call_info[key] = value or datetime.now()
    if key in {"sip_joined_at", "first_bot_audio_at"}:
        _update_answer_to_first_audio(call_info)


def _update_answer_to_first_audio(call_info: Optional[dict]):
    if not call_info:
        return

    sip_joined_at = call_info.get("sip_joined_at")
    first_bot_audio_at = call_info.get("first_bot_audio_at")
    if not sip_joined_at or not first_bot_audio_at:
        return

    call_info["answer_to_first_audio_ms"] = max(
        0,
        int((first_bot_audio_at - sip_joined_at).total_seconds() * 1000),
    )


def _flush_pending_audio_timestamps(call_info: Optional[dict]):
    if not call_info:
        return

    sip_joined_at = call_info.get("sip_joined_at")
    pending_first_bot_audio_at = call_info.pop("pending_first_bot_audio_at", None)
    if sip_joined_at and pending_first_bot_audio_at and not call_info.get("first_bot_audio_at"):
        _set_timestamp_once(
            call_info,
            "first_bot_audio_at",
            max(sip_joined_at, pending_first_bot_audio_at),
        )


def _duration_started_at(call_info: Optional[dict]) -> Optional[datetime]:
    if not call_info:
        return None
    return (
        call_info.get("sip_joined_at")
        or call_info.get("started_at")
        or call_info.get("call_requested_at")
    )


def _update_call_duration(call_info: Optional[dict]) -> None:
    if not call_info:
        return
    started = _duration_started_at(call_info)
    ended = call_info.get("ended_at")
    if started and ended:
        call_info["duration_seconds"] = max(0, int((ended - started).total_seconds()))


def _warm_worker_expired(worker: WarmBotWorker) -> bool:
    if worker.call_info is not None:
        return False

    age_seconds = (datetime.now() - worker.created_at).total_seconds()
    return age_seconds >= _warm_worker_idle_ttl_secs()


def _warm_pool_snapshot() -> dict:
    ready = 0
    in_use = 0
    for worker in _warm_workers.values():
        if worker.call_info is None:
            ready += 1
        else:
            in_use += 1

    return {
        "warm_pool_enabled": _warm_pool_enabled(),
        "warm_pool_size": _warm_pool_size(),
        "warm_pool_ready": ready,
        "warm_pool_in_use": in_use,
        "warm_pool_last_replenish_at": _warm_pool_last_replenish_at,
    }


def _build_bot_session_observer(call_info_provider: Callable[[], Optional[dict]]) -> BotSessionObserver:
    def _ivr_no_user_timeout_secs() -> float:
        try:
            return max(5.0, config.float_setting("IVR_NO_USER_TIMEOUT_SECS", 12.0))
        except Exception:
            return 12.0

    async def _watch_no_user_response(call_info: dict):
        await asyncio.sleep(_ivr_no_user_timeout_secs())
        if not call_info:
            return
        if call_info.get("ended_at") or call_info.get("ivr_detection_triggered"):
            return
        if call_info.get("first_user_audio_at"):
            return

        call_info["ivr_detection_triggered"] = True
        call_info["status"] = "ended_ivr"
        call_info["end_reason"] = "no_user_response_after_bot_audio"
        call_info["ended_at"] = datetime.now()
        await persist_call_artifacts(call_info)
        _cleanup_call_watchdog(call_info.get("call_id") or "")
        await _persist_conversation_event(
            call_info,
            "system",
            "ivr_detected",
            "No user response after bot audio; call terminated",
        )
        await _persist_call_session(call_info)

        call_id = call_info.get("call_id")
        provider = call_info.get("provider")
        room_name = call_info.get("room_name")
        if provider == "livekit-sip" and room_name:
            await _cleanup_room(room_name)
            if call_id:
                _cleanup_call_watch(call_id)
        elif provider == "issabel-sip" and call_id:
            task = _bot_tasks.get(call_id)
            if task and not task.done():
                task.cancel()
            _cleanup_call_watch(call_id)

    async def _maybe_cut_call_if_ivr_detected(call_info: Optional[dict]):
        if not call_info or call_info.get("ivr_detection_triggered"):
            return

        turns = call_info.get("transcript_turns") or []
        if not turns:
            return

        # Use one shared IVR detector for both Issabel and Exotel call flows.
        ai_context = config.setting("IVR_DETECTION_CONTEXT") or None
        if not detect_ivr_from_turns(turns, ai_context):
            return

        call_info["ivr_detection_triggered"] = True
        call_info["status"] = "ended_ivr"
        call_info["end_reason"] = "ivr_detected"
        call_info["ended_at"] = datetime.now()

        await persist_call_artifacts(call_info)
        _cleanup_call_watchdog(call_info.get("call_id") or "")
        await _persist_conversation_event(call_info, "system", "ivr_detected", "IVR auto-detected; call terminated")
        await _persist_call_session(call_info)

        call_id = call_info.get("call_id")
        provider = call_info.get("provider")
        room_name = call_info.get("room_name")
        if provider == "livekit-sip" and room_name:
            await _cleanup_room(room_name)
            if call_id:
                _cleanup_call_watch(call_id)
        elif provider == "issabel-sip" and call_id:
            task = _bot_tasks.get(call_id)
            if task and not task.done():
                task.cancel()
            _cleanup_call_watch(call_id)

    async def _on_participant_joined(participant_id: str, metadata: dict):
        call_info = call_info_provider()
        if not call_info:
            return

        sip_identity = call_info.get("sip_participant_identity")
        participant_identity = (
            str((metadata or {}).get("identity") or "")
            or str((metadata or {}).get("participant_identity") or "")
            or str(participant_id or "")
        )
        if participant_identity == sip_identity or participant_identity.startswith("sip-"):
            if isinstance(metadata, dict):
                metadata.setdefault("call_id", call_info.get("call_id"))
                metadata.setdefault("user_id", call_info.get("user_id"))
                metadata.setdefault("campaign_id", call_info.get("campaign_id"))
                metadata.setdefault("campaign_contact_id", call_info.get("campaign_contact_id"))
                metadata.setdefault("bot_config", call_info.get("bot_config") or {})
            call_info["saw_sip_participant"] = True
            _set_timestamp_once(call_info, "sip_joined_at")
            _flush_pending_audio_timestamps(call_info)
            if call_info.get("status") in {"queued", "ringing"}:
                call_info["status"] = "in_progress"
            if metadata:
                call_info["participant_metadata"] = metadata
            await _persist_conversation_event(call_info, "system", "participant_joined", participant_identity)

    def _on_first_bot_audio():
        call_info = call_info_provider()
        if not call_info:
            return
        if call_info.get("sip_joined_at"):
            _set_timestamp_once(call_info, "first_bot_audio_at")
        else:
            call_info.setdefault("pending_first_bot_audio_at", datetime.now())
        existing_watch = call_info.get("ivr_no_user_watch_task")
        if not existing_watch or existing_watch.done():
            call_info["ivr_no_user_watch_task"] = asyncio.create_task(
                _watch_no_user_response(call_info),
                name=f"ivr-no-user-watch:{call_info.get('call_id', 'unknown')}",
            )

    def _on_first_user_audio():
        call_info = call_info_provider()
        _set_timestamp_once(call_info, "first_user_audio_at")
        if not call_info:
            return
        watch = call_info.pop("ivr_no_user_watch_task", None)
        if watch and not watch.done():
            watch.cancel()

    async def _on_session_end(reason: str = "farewell"):
        call_info = call_info_provider()
        if not call_info:
            return
        watch = call_info.pop("ivr_no_user_watch_task", None)
        if watch and not watch.done():
            watch.cancel()

        call_id = call_info.get("call_id")
        call_info.setdefault("end_reason", reason)
        call_info["farewell_requested_at"] = datetime.now()
        await _persist_conversation_event(call_info, "system", "session_end", reason)

        # Issabel / Exotel: wait for transport or voice WS teardown before terminal status.
        current_status = str(call_info.get("status") or "").strip().lower()
        if current_status == "failed":
            call_info["status"] = "failed"
        elif call_info.get("provider") in {"issabel-sip", "exotel"}:
            call_info["status"] = "disconnecting"
        else:
            call_info["status"] = "completed"
        call_info["ended_at"] = datetime.now()
        _update_call_duration(call_info)

        await persist_call_artifacts(call_info)
        _cleanup_call_watchdog(call_id or "")
        if call_id:
            _cleanup_call_watch(call_id)

        await _persist_call_session(call_info)

        # Provider-specific livekit cleanup
        room_name = call_info.get("room_name")
        if call_info.get("provider") == "livekit-sip" and room_name:
            if call_info.get("farewell_cleanup_started"):
                return
            call_info["farewell_cleanup_started"] = True

            async def _cleanup_after_farewell():
                try:
                    delay_secs = config.float_setting("LIVEKIT_FAREWELL_HANGUP_DELAY_SECS", 0.25)
                except Exception:
                    delay_secs = 0.25
                delay_secs = max(0.15, delay_secs)
                if delay_secs > 0:
                    await asyncio.sleep(delay_secs)

                participant_removed = False
                sip_identity = call_info.get("sip_participant_identity")
                if sip_identity and room_name:
                    lk = _get_livekit_client()
                    try:
                        await lk.room.remove_participant(
                            api.RoomParticipantIdentity(room=room_name, identity=sip_identity)
                        )
                        participant_removed = True
                        logger.info(f"Removed SIP participant {sip_identity} from room {room_name}")
                    except Exception as exc:
                        logger.warning(
                            f"Failed to remove SIP participant {sip_identity} from room {room_name}: {exc}"
                        )
                    finally:
                        await lk.aclose()

                await _cleanup_room(room_name, cancel_bot_task=False)

            asyncio.create_task(
                _cleanup_after_farewell(),
                name=f"farewell-cleanup:{call_id or room_name}",
            )

    async def _on_session_error(error_message: str):
        call_info = call_info_provider()
        if not call_info:
            return
        watch = call_info.pop("ivr_no_user_watch_task", None)
        if watch and not watch.done():
            watch.cancel()
        call_info["status"] = "ended_llm_failure"
        call_info["end_reason"] = "llm_error"
        call_info["ended_at"] = datetime.now()
        await persist_call_artifacts(call_info)
        await _persist_conversation_event(call_info, "system", "llm_error", error_message)
        await _persist_call_session(call_info)
        call_id = call_info.get("call_id")
        provider = call_info.get("provider")
        room_name = call_info.get("room_name")

        # Immediately cut the call when LLM fails.
        if provider == "livekit-sip" and room_name:
            await _cleanup_room(room_name)
            if call_id:
                _cleanup_call_watch(call_id)
        elif provider == "issabel-sip" and call_id:
            task = _bot_tasks.get(call_id)
            if task and not task.done():
                task.cancel()
            _cleanup_call_watch(call_id)

    async def _on_user_transcript(text: str):
        call_info = call_info_provider()
        if not call_info:
            return
        append_transcript_turn(call_info, "user", text)
        await _persist_conversation_event(call_info, "user", "transcript", text)
        await _maybe_cut_call_if_ivr_detected(call_info)

    async def _on_assistant_text(text: str):
        call_info = call_info_provider()
        if not call_info:
            return
        append_transcript_turn(call_info, "assistant", text)
        await _persist_conversation_event(call_info, "assistant", "response", text)

    def _on_user_audio_chunk(audio_bytes: bytes, sample_rate: int, num_channels: int):
        append_audio_chunk(call_info_provider(), "user", audio_bytes, sample_rate, num_channels)

    def _on_assistant_audio_chunk(audio_bytes: bytes, sample_rate: int, num_channels: int):
        append_audio_chunk(call_info_provider(), "assistant", audio_bytes, sample_rate, num_channels)

    def _on_assistant_audio_turn_complete():
        finalize_assistant_audio_turn(call_info_provider())

    return BotSessionObserver(
        on_participant_joined=_on_participant_joined,
        on_first_bot_audio=_on_first_bot_audio,
        on_first_user_audio=_on_first_user_audio,
        on_user_audio_chunk=_on_user_audio_chunk,
        on_assistant_audio_chunk=_on_assistant_audio_chunk,
        on_assistant_audio_turn_complete=_on_assistant_audio_turn_complete,
        on_session_end=_on_session_end,
        on_session_error=_on_session_error,
        on_user_transcript=_on_user_transcript,
        on_assistant_text=_on_assistant_text,
    )


def _livekit_ws_url() -> str:
    value = config.setting("LIVEKIT_URL")
    if not value:
        raise RuntimeError("LIVEKIT_URL not configured")
    return value


def _livekit_http_url() -> str:
    return _livekit_ws_url().replace("wss://", "https://").replace("ws://", "http://")


async def get_user_outbound_config(user_id: str | None) -> dict:
    """Fetch user-specific SIP/Exotel configuration from DB."""
    if not user_id:
        return {}
    try:
        db = get_db()
        config_doc = await db.user_outbound_config.find_one({"user_id": user_id})
        return config_doc or {}
    except Exception as exc:
        logger.warning(f"Failed to fetch user outbound config for {user_id}: {exc}")
        return {}


def _required_env(name: str) -> str:
    value = config.setting(name)
    if not value:
        raise RuntimeError(f"{name} not configured")
    return value


def _room_metadata(
    *,
    phone_number: str,
    customer_name: str,
    customer_id: Optional[str],
    verification_context: Optional[dict],
) -> str:
    return json.dumps(
        {
            "customer_name": customer_name,
            "customer_id": customer_id,
            "phone_number": phone_number,
            "verification_context": verification_context or {},
            "call_type": "customer_verification",
        }
    )


def _bot_identity(room_name: str) -> str:
    return f"callpulse-agent-{room_name[-12:]}"


def _get_livekit_client() -> api.LiveKitAPI:
    """Create LiveKit API client."""
    return api.LiveKitAPI(
        _livekit_http_url(),
        _required_env("LIVEKIT_API_KEY"),
        _required_env("LIVEKIT_API_SECRET"),
    )


def _build_livekit_token(*, room_name: str, identity: str, name: str, agent: bool = False) -> str:
    token = api.AccessToken(_required_env("LIVEKIT_API_KEY"), _required_env("LIVEKIT_API_SECRET"))
    token.with_identity(identity).with_name(name).with_grants(
        api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
            agent=agent,
        )
    )
    return token.to_jwt()


async def _start_bot_for_room(
    room_name: str,
    *,
    session_observer: Optional[BotSessionObserver] = None,
    fixed_initial_greeting: Optional[str] = None,
):
    """Start a Pipecat bot task in the given LiveKit room."""
    existing = _bot_tasks.get(room_name)
    if existing and not existing.done():
        return

    identity = _bot_identity(room_name)
    token = _build_livekit_token(
        room_name=room_name,
        identity=identity,
        name="CallPulse Agent",
        agent=True,
    )

    transport = LiveKitTransport(
        _livekit_ws_url(),
        token,
        room_name,
        params=LiveKitParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    runner_args = LiveKitRunnerArguments(room_name=room_name, url=_livekit_ws_url(), token=token)
    task = asyncio.create_task(
        run_bot(
            transport,
            runner_args,
            session_observer=session_observer,
            fixed_initial_greeting=fixed_initial_greeting,
        ),
        name=f"bot:{room_name}",
    )
    _bot_tasks[room_name] = task
    logger.info(f"Started bot for room {room_name}")

    def _cleanup_done(finished: asyncio.Task, *, room: str = room_name):
        if _bot_tasks.get(room) is finished:
            _bot_tasks.pop(room, None)
        with suppress(asyncio.CancelledError):
            exc = finished.exception()
            if exc:
                logger.error(f"Bot task failed for room {room}: {exc}")

    task.add_done_callback(_cleanup_done)


def _cleanup_call_watch(call_id: str):
    task = _call_watch_tasks.pop(call_id, None)
    if task and not task.done():
        task.cancel()


async def _watch_sip_join(call_id: str):
    while True:
        call_info = _active_calls.get(call_id)
        if not call_info or call_info.get("sip_joined_at") or call_info.get("ended_at"):
            return

        await _refresh_call_status(call_info)
        if call_info.get("sip_joined_at") or call_info.get("ended_at"):
            return

        await asyncio.sleep(0.5)


async def _wait_for_bot_join(lk: api.LiveKitAPI, room_name: str):
    """Wait until the bot participant is visible in the target room."""
    deadline = asyncio.get_running_loop().time() + BOT_JOIN_TIMEOUT_SECS
    identity = _bot_identity(room_name)

    while asyncio.get_running_loop().time() < deadline:
        participants = await lk.room.list_participants(api.ListParticipantsRequest(room=room_name))
        if any(p.identity == identity for p in participants.participants):
            return
        await asyncio.sleep(0.5)

    raise RuntimeError(f"Bot did not join room {room_name} within {BOT_JOIN_TIMEOUT_SECS}s")


async def _create_warm_worker() -> WarmBotWorker:
    room_name = _warm_room_name()
    metadata = _room_metadata(
        phone_number="",
        customer_name="",
        customer_id=f"warm-{uuid4().hex[:8]}",
        verification_context={"warm_pool": True},
    )

    worker = WarmBotWorker(
        room_name=room_name,
        bot_identity=_bot_identity(room_name),
        created_at=datetime.now(),
    )
    session_observer = _build_bot_session_observer(lambda: worker.call_info)
    lk = _get_livekit_client()

    try:
        await lk.room.create_room(
            api.CreateRoomRequest(name=room_name, empty_timeout=300, metadata=metadata)
        )
        await _start_bot_for_room(
            room_name,
            session_observer=session_observer,
            fixed_initial_greeting=_fixed_initial_greeting(),
        )
        await _wait_for_bot_join(lk, room_name)
        worker.ready_at = datetime.now()
        logger.info(f"Warm bot worker ready in room {room_name}")
        return worker
    except Exception:
        await _cleanup_room(room_name)
        raise
    finally:
        await lk.aclose()


async def _ensure_warm_pool():
    global _warm_pool_last_replenish_at

    if not _warm_pool_enabled() or _warm_pool_size() <= 0:
        return

    async with _warm_pool_ensure_lock:
        stale_rooms: list[str] = []

        async with _warm_pool_lock:
            for room_name, worker in list(_warm_workers.items()):
                if _warm_worker_expired(worker):
                    stale_rooms.append(room_name)
                    _warm_workers.pop(room_name, None)

            ready_count = sum(1 for worker in _warm_workers.values() if worker.call_info is None)
            missing = max(0, _warm_pool_size() - ready_count)

        for room_name in stale_rooms:
            await _cleanup_room(room_name)

        for _ in range(missing):
            worker = await _create_warm_worker()
            async with _warm_pool_lock:
                _warm_workers[worker.room_name] = worker
                _warm_pool_last_replenish_at = worker.ready_at or datetime.now()


async def _reserve_warm_worker(call_info: dict) -> Optional[WarmBotWorker]:
    if not _warm_pool_enabled() or _warm_pool_size() <= 0:
        return None

    await _ensure_warm_pool()

    stale_rooms: list[str] = []
    reserved_worker: Optional[WarmBotWorker] = None

    async with _warm_pool_lock:
        for room_name, worker in list(_warm_workers.items()):
            if _warm_worker_expired(worker):
                stale_rooms.append(room_name)
                _warm_workers.pop(room_name, None)

        for worker in _warm_workers.values():
            if worker.call_info is None:
                worker.call_info = call_info
                worker.reserved_at = datetime.now()
                reserved_worker = worker
                break

    for room_name in stale_rooms:
        await _cleanup_room(room_name)

    if not reserved_worker:
        asyncio.create_task(_ensure_warm_pool())
        return None

    call_info["warm_start_used"] = True
    call_info["warm_worker_reserved_at"] = reserved_worker.reserved_at
    call_info["room_name"] = reserved_worker.room_name
    call_info["bot_identity"] = reserved_worker.bot_identity
    asyncio.create_task(_ensure_warm_pool())
    logger.info(f"Reserved warm bot worker in room {reserved_worker.room_name}")
    return reserved_worker


async def _warm_pool_maintainer():
    while True:
        try:
            await _ensure_warm_pool()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(f"Warm pool maintenance failed: {exc}")
        await asyncio.sleep(5)


async def _stop_bot_for_room(room_name: str):
    task = _bot_tasks.pop(room_name, None)
    if not task:
        return

    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def _delete_livekit_room(room_name: str) -> bool:
    lk = _get_livekit_client()
    try:
        await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
        logger.info(f"Deleted room {room_name}")
        return True
    except Exception as e:
        logger.warning(f"Room cleanup failed for {room_name}: {e}")
        return False
    finally:
        await lk.aclose()


async def _cleanup_room(room_name: str, *, cancel_bot_task: bool = True) -> bool:
    async with _warm_pool_lock:
        _warm_workers.pop(room_name, None)

    if cancel_bot_task:
        await _stop_bot_for_room(room_name)

    return await _delete_livekit_room(room_name)


async def create_sip_outbound_call(
    phone_number: str,
    customer_name: str,
    customer_id: Optional[str] = None,
    verification_context: Optional[dict] = None,
) -> str:
    """Create a SIP outbound call via LiveKit.

    Args:
        phone_number: E.164 formatted phone number
        customer_name: Customer name for personalization
        customer_id: Optional customer ID for tracking
        verification_context: Additional context passed to the bot

    Returns:
        call_id: The LiveKit SIP call ID
    """

    lk = _get_livekit_client()

    room_name = f"verification-{customer_id or datetime.now().strftime('%Y%m%d%H%M%S')}"
    metadata = _room_metadata(
        phone_number=phone_number,
        customer_name=customer_name,
        customer_id=customer_id,
        verification_context=verification_context,
    )
    sip_identity = f"sip-{phone_number.replace('+', '')}"
    bot_config = (verification_context or {}).get("bot_config")
    if not isinstance(bot_config, dict):
        bot_config = {}
    call_info = {
        "call_id": None,
        "room_name": room_name,
        "phone_number": phone_number,
        "customer_name": customer_name,
        "customer_id": customer_id,
        "status": "queued",
        "call_requested_at": datetime.now(),
        "started_at": datetime.now(),
        "bot_identity": _bot_identity(room_name),
        "sip_participant_identity": sip_identity,
        "saw_sip_participant": False,
        "warm_start_used": False,
        "provider": "livekit-sip",
        "campaign_id": (verification_context or {}).get("campaign_id"),
        "campaign_contact_id": (verification_context or {}).get("campaign_contact_id"),
        "retry_count": (verification_context or {}).get("retry_count", 0),
        "user_id": (verification_context or {}).get("user_id"),
        "bot_config": bot_config,
        "monotonic_started_at": time.monotonic(),
    }
    warm_worker = await _reserve_warm_worker(call_info)

    try:
        if not warm_worker:
            await lk.room.create_room(
                api.CreateRoomRequest(name=room_name, empty_timeout=300, metadata=metadata)
            )
            await _start_bot_for_room(
                room_name,
                session_observer=_build_bot_session_observer(lambda: call_info),
                fixed_initial_greeting=_fixed_initial_greeting(),
            )
            await _wait_for_bot_join(lk, room_name)

        user_id = (verification_context or {}).get("user_id")
        user_conf = await get_user_outbound_config(user_id)

        trunk_id = _clean_string(user_conf.get("sip_trunk_id")) or _required_env("LIVEKIT_SIP_TRUNK_ID")
        request_kwargs = {
            "sip_trunk_id": trunk_id,
            "sip_call_to": phone_number,
            "room_name": call_info["room_name"],
            "participant_identity": sip_identity,
            "participant_name": customer_name,
            "participant_metadata": metadata,
            "wait_until_answered": False,
        }

        outbound_number = (
            _clean_string(user_conf.get("sip_outbound_number"))
            or config.setting("LIVEKIT_SIP_OUTBOUND_NUMBER")
            or config.setting("TELNYX_OUTBOUND_NUMBER")
            or ""
        ).strip()
        if outbound_number:
            request_kwargs["sip_number"] = outbound_number

        call_info["sip_dial_started_at"] = datetime.now()
        response = await lk.sip.create_sip_participant(api.CreateSIPParticipantRequest(**request_kwargs))
        call_id = response.sip_call_id
        call_info["call_id"] = call_id
        _active_calls[call_id] = call_info
        await _persist_call_session(call_info)
        _schedule_call_watchdog(call_id)
        _call_watch_tasks[call_id] = asyncio.create_task(
            _watch_sip_join(call_id),
            name=f"sip-join:{call_id}",
        )

        logger.info(
            f"Created LiveKit SIP outbound call: {call_id} to {phone_number} in room {call_info['room_name']}"
        )
        return call_id
    except Exception:
        await _cleanup_room(call_info["room_name"])
        raise
    finally:
        await lk.aclose()


async def create_issabel_direct_outbound_call(request: OutboundCallRequest) -> str:
    """Queue an Issabel direct call and bootstrap SIP+bot in background."""
    from services.issabel_sip_dial import sip_dial_user_for_issabel

    user_id = (request.verification_context or {}).get("user_id")
    user_conf = await get_user_outbound_config(user_id) if user_id else {}
    prefix = user_conf.get("issabel_dial_prefix")

    dial = sip_dial_user_for_issabel(request.phone_number, prefix_digits=prefix)
    if not dial:
        raise ValueError("Invalid phone number for Issabel dial string")

    call_id = f"issabel-{uuid4().hex}"
    bot_config = (request.verification_context or {}).get("bot_config")
    if not isinstance(bot_config, dict):
        bot_config = {}
    call_info = {
        "call_id": call_id,
        "room_name": None,
        "phone_number": request.phone_number,
        "customer_name": request.customer_name,
        "customer_id": request.customer_id,
        "status": "queued",
        "call_requested_at": datetime.now(),
        "started_at": datetime.now(),
        "sip_participant_identity": None,
        "provider": "issabel-sip",
        "campaign_id": (request.verification_context or {}).get("campaign_id"),
        "campaign_contact_id": (request.verification_context or {}).get("campaign_contact_id"),
        "retry_count": (request.verification_context or {}).get("retry_count", 0),
        "user_id": (request.verification_context or {}).get("user_id"),
        "bot_config": bot_config,
        "monotonic_started_at": time.monotonic(),
    }
    _active_calls[call_id] = call_info
    await _persist_call_session(call_info)
    _schedule_call_watchdog(call_id)

    task = asyncio.create_task(
        _bootstrap_issabel_direct_call(call_id=call_id, request=request, dial=dial),
        name=f"issabel-bootstrap:{call_id}",
    )
    _issabel_bootstrap_tasks[call_id] = task

    def _issabel_bootstrap_finished(finished: asyncio.Task, *, cid: str = call_id):
        current = _issabel_bootstrap_tasks.get(cid)
        if current is finished:
            _issabel_bootstrap_tasks.pop(cid, None)
        with suppress(asyncio.CancelledError):
            exc = finished.exception()
            if exc:
                logger.error(f"Issabel bootstrap task crashed for {cid}: {exc}")

    task.add_done_callback(_issabel_bootstrap_finished)

    logger.info(f"Issabel direct outbound queued: {call_id} -> {dial}")
    return call_id


async def _bootstrap_issabel_direct_call(call_id: str, request: OutboundCallRequest, dial: str):
    """Run blocking SIP INVITE and bot startup for Issabel direct calls."""
    from services.issabel_rtp_transport import IssabelRTPTransport
    from models.issabel import IssabelRunnerArguments
    from services.issabel_sip_signaling import issabel_invite_until_answered

    info = _active_calls.get(call_id)
    if not info:
        return

    user_id = (request.verification_context or {}).get("user_id")
    user_conf = await get_user_outbound_config(user_id) if user_id else None
    
    dial_timeout = config.float_setting("ISSABEL_INVITE_TIMEOUT", 45.0)
    loop = asyncio.get_running_loop()
    try:
        info["status"] = "ringing"
        info["sip_dial_started_at"] = datetime.now()

        session = await loop.run_in_executor(
            None,
            lambda: issabel_invite_until_answered(
                dial_digits=dial, 
                dial_timeout=dial_timeout, 
                call_id=call_id,
                issabel_config=user_conf
            ),
        )

        pipeline_rate = config.int_setting("ISSABEL_PIPELINE_SAMPLE_RATE", 8000)
        chunks = config.int_setting("ISSABEL_AUDIO_10MS_CHUNKS", 4)

        params = TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=pipeline_rate,
            audio_out_sample_rate=pipeline_rate,
            audio_out_10ms_chunks=chunks,
        )
        transport = IssabelRTPTransport(session, params)

        meta = {
            "customer_name": request.customer_name,
            "customer_id": request.customer_id,
            "phone_number": request.phone_number,
            "call_id": call_id,
            **(request.verification_context or {}),
        }
        runner_args = IssabelRunnerArguments(call_id=call_id, body=meta)

        info["status"] = "in_progress"
        info["sip_joined_at"] = datetime.now()
        info.pop("failure_reason", None)

        task = asyncio.create_task(
            run_bot(
                transport,
                runner_args,
                session_observer=_build_bot_session_observer(lambda: _active_calls.get(call_id)),
                fixed_initial_greeting=_fixed_initial_greeting(),
            ),
            name=f"issabel-bot:{call_id}",
        )
        _bot_tasks[call_id] = task

        def _issabel_bot_finished(finished: asyncio.Task, *, cid: str = call_id):
            if _bot_tasks.get(cid) is finished:
                _bot_tasks.pop(cid, None)
            final_info = _active_calls.get(cid)
            if not final_info:
                return
            exc = None
            with suppress(asyncio.CancelledError):
                exc = finished.exception()
            if exc:
                logger.error(f"Issabel bot task failed for {cid}: {exc}")
                final_info["status"] = "failed"
                final_info["failure_reason"] = "bot_task_failed"
                final_info["end_reason"] = "bot_error"
            else:
                final_info["status"] = "completed"
                final_info["end_reason"] = "bot_completed"
            final_info["ended_at"] = datetime.now()
            _update_call_duration(final_info)
            _cleanup_call_watchdog(cid)
            asyncio.create_task(
                persist_call_artifacts(final_info),
                name=f"persist-call-artifacts:{cid}",
            )
            asyncio.create_task(
                _persist_call_session(final_info),
                name=f"persist-call-session:{cid}",
            )

        task.add_done_callback(_issabel_bot_finished)
        logger.info(f"Issabel direct outbound answered: {call_id} -> {dial}")
    except asyncio.CancelledError:
        info["status"] = "failed"
        info["failure_reason"] = "bootstrap_cancelled"
        info["end_reason"] = "cancelled"
        info["ended_at"] = datetime.now()
        raise
    except Exception as exc:
        logger.error(f"Issabel direct outbound failed before bot start for {call_id}: {exc}")
        info["status"] = "failed"
        info["failure_reason"] = str(exc)
        info["end_reason"] = "sip_setup_failed"
        info["ended_at"] = datetime.now()
        _update_call_duration(info)
        await persist_call_artifacts(info)
        _cleanup_call_watchdog(call_id)
        if _exotel_enabled():
            try:
                exotel_call_id = await _create_exotel_outbound_call(request)
                _promote_issabel_call_to_exotel_fallback(call_id, exotel_call_id)
                logger.warning(f"Issabel call {call_id} failed; switched to Exotel fallback {exotel_call_id}.")
            except Exception as exotel_exc:
                logger.error(f"Issabel fallback to Exotel failed for {call_id}: {exotel_exc}")


async def get_call_status(call_id: str) -> Optional[CallStatus]:
    """Get the status of a call."""
    call_info = _active_calls.get(call_id)
    if not call_info:
        return await _load_persisted_call_status(call_id)

    await _refresh_call_status(call_info)

    return _call_status_from_info(call_id, call_info)


async def _refresh_call_status(call_info: dict):
    """Infer SIP call state from the LiveKit room when webhooks are absent or delayed."""
    if call_info.get("provider") == "issabel-human-agent":
        from services.human_issabel_bridge import refresh_human_issabel_call_status

        refresh_human_issabel_call_status(call_info)
        return

    if call_info.get("provider") == "issabel-sip":
        cid = call_info.get("call_id")
        if cid:
            task = _bot_tasks.get(cid)
            if task and not task.done():
                if call_info.get("status") not in {"completed", "failed"}:
                    call_info["status"] = "in_progress"
            elif call_info.get("status") not in {"completed", "failed"}:
                bootstrap_task = _issabel_bootstrap_tasks.get(cid)
                if bootstrap_task and not bootstrap_task.done():
                    if call_info.get("status") not in {"ringing", "in_progress"}:
                        call_info["status"] = "queued"
                elif call_info.get("status") in {"queued", "ringing"}:
                    call_info["status"] = "failed"
                    call_info.setdefault("failure_reason", "issabel_bootstrap_stopped")
                    call_info.setdefault("end_reason", "sip_setup_failed")
                    if not call_info.get("ended_at"):
                        call_info["ended_at"] = datetime.now()
                        _update_call_duration(call_info)
                        _cleanup_call_watchdog(cid)
        return

    status = str(call_info.get("status") or "").lower()
    if status in {"completed", "failed"}:
        return

    room_name = call_info.get("room_name")
    sip_identity = call_info.get("sip_participant_identity")
    if not room_name or not sip_identity:
        return

    lk = _get_livekit_client()
    try:
        participants = await lk.room.list_participants(api.ListParticipantsRequest(room=room_name))
        identities = {participant.identity for participant in participants.participants}
    except Exception as exc:
        logger.warning(f"Unable to refresh call status for {call_info.get('call_id')}: {exc}")
        return
    finally:
        await lk.aclose()

    if sip_identity in identities:
        call_info["saw_sip_participant"] = True
        _set_timestamp_once(call_info, "sip_joined_at")
        _flush_pending_audio_timestamps(call_info)
        if status in {"queued", "ringing"}:
            call_info["status"] = "in_progress"
        return

    if call_info.get("saw_sip_participant"):
        call_info["status"] = "completed"
    elif status in {"queued", "ringing"}:
        call_info["status"] = "failed"
    else:
        call_info["status"] = status or "failed"

    if not call_info.get("ended_at"):
        call_info["ended_at"] = datetime.now()
        _update_call_duration(call_info)
        await persist_call_artifacts(call_info)
        _cleanup_call_watchdog(call_info.get("call_id") or "")

    call_id = call_info.get("call_id")
    if call_id:
        _cleanup_call_watchdog(call_id)
        _cleanup_call_watch(call_id)

    await _cleanup_room(room_name)


@asynccontextmanager
async def service_lifespan():
    global _warm_pool_task

    if _warm_pool_enabled() and _warm_pool_size() > 0:
        try:
            await _ensure_warm_pool()
        except Exception as exc:
            logger.warning(f"Initial warm pool creation failed: {exc}")
        _warm_pool_task = asyncio.create_task(_warm_pool_maintainer(), name="warm-pool")

    try:
        yield
    finally:
        if _warm_pool_task:
            _warm_pool_task.cancel()
            with suppress(asyncio.CancelledError):
                await _warm_pool_task
            _warm_pool_task = None

        watchdog_tasks = list(_call_watchdog_tasks.values())
        _call_watchdog_tasks.clear()
        for task in watchdog_tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        call_watch_tasks = list(_call_watch_tasks.values())
        _call_watch_tasks.clear()
        for task in call_watch_tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        bootstrap_tasks = list(_issabel_bootstrap_tasks.values())
        _issabel_bootstrap_tasks.clear()
        for task in bootstrap_tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        eviction_tasks = list(_completed_call_eviction_tasks.values())
        _completed_call_eviction_tasks.clear()
        for task in eviction_tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        rooms = list(set(_bot_tasks.keys()) | set(_warm_workers.keys()))
        for room_name in rooms:
            if isinstance(room_name, str) and room_name.startswith("issabel-"):
                t = _bot_tasks.pop(room_name, None)
                if t and not t.done():
                    t.cancel()
                    with suppress(asyncio.CancelledError):
                        await t
                _active_calls.pop(room_name, None)
                continue
            await _cleanup_room(room_name)


@asynccontextmanager
async def lifespan(app=None):
    async with service_lifespan():
        yield


async def initiate_outbound_call(request: OutboundCallRequest):
    """Initiate an outbound verification call."""
    try:
        _normalize_request_bot_config(request)
        user_id = (request.verification_context or {}).get("user_id")
        user_conf = await get_user_outbound_config(user_id)
        provider_preference = _outbound_provider_preference()

        if provider_preference in {"livekit", "sip"}:
            if not _livekit_configured():
                raise HTTPException(status_code=500, detail="OUTBOUND_PROVIDER forces LiveKit SIP, but LiveKit is not configured.")

            call_id = await create_sip_outbound_call(
                phone_number=request.phone_number,
                customer_name=request.customer_name,
                customer_id=request.customer_id,
                verification_context=request.verification_context,
            )

            return {
                "success": True,
                "call_id": call_id,
                "status": "queued",
                "message": f"Call initiated to {request.phone_number}",
                "provider": "livekit-sip",
            }

        if provider_preference == "exotel":
            if not _exotel_enabled(user_conf):
                raise HTTPException(status_code=500, detail="OUTBOUND_PROVIDER forces Exotel, but Exotel outbound is not configured for this user.")

            call_id = await _create_exotel_outbound_call(request)
            return {
                "success": True,
                "call_id": call_id,
                "status": "queued",
                "message": f"Call initiated to {request.phone_number}",
                "provider": "exotel",
            }

        if provider_preference in {"issabel", "direct"}:
            if not _issabel_direct_enabled():
                raise HTTPException(status_code=500, detail="OUTBOUND_PROVIDER forces Issabel SIP, but Issabel direct outbound is not configured.")

            call_id = await create_issabel_direct_outbound_call(request)
            return {
                "success": True,
                "call_id": call_id,
                "status": "queued",
                "message": f"Call initiated to {request.phone_number}",
                "provider": "issabel-sip",
            }

        if provider_preference not in {"auto", ""}:
            raise HTTPException(status_code=500, detail=f"Unsupported OUTBOUND_PROVIDER: {provider_preference}")

        if _issabel_direct_enabled():
            try:
                call_id = await create_issabel_direct_outbound_call(request)
                return {
                    "success": True,
                    "call_id": call_id,
                    "status": "queued",
                    "message": f"Call initiated to {request.phone_number}",
                    "provider": "issabel-sip",
                }
            except Exception as exc:
                logger.warning(f"Issabel direct outbound failed ({exc}); trying fallback providers.")
                if _exotel_enabled(user_conf):
                    try:
                        call_id = await _create_exotel_outbound_call(request)
                        return {
                            "success": True,
                            "call_id": call_id,
                            "status": "queued",
                            "message": f"Call initiated to {request.phone_number}",
                            "provider": "exotel",
                        }
                    except Exception as exotel_exc:
                        logger.warning(f"Exotel outbound fallback failed ({exotel_exc}); trying LiveKit SIP.")
        elif _exotel_enabled(user_conf):
            try:
                call_id = await _create_exotel_outbound_call(request)
                return {
                    "success": True,
                    "call_id": call_id,
                    "status": "queued",
                    "message": f"Call initiated to {request.phone_number}",
                    "provider": "exotel",
                }
            except Exception as exc:
                logger.warning(f"Exotel outbound failed ({exc}); trying LiveKit SIP.")

        if not _livekit_configured():
            raise HTTPException(
                status_code=500,
                detail="LiveKit is not configured and no other outbound provider succeeded.",
            )

        call_id = await create_sip_outbound_call(
            phone_number=request.phone_number,
            customer_name=request.customer_name,
            customer_id=request.customer_id,
            verification_context=request.verification_context,
        )

        return {
            "success": True,
            "call_id": call_id,
            "status": "queued",
            "message": f"Call initiated to {request.phone_number}",
            "provider": "livekit-sip",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create outbound call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def check_call_status(call_id: str):
    """Check the status of a call."""
    call_info = _active_calls.get(call_id)
    provider = call_info.get("provider") if call_info else None

    if provider == "exotel":
        provider_call_id = call_info.get("provider_call_id") or call_id
        status = await _get_exotel_call_status(provider_call_id)
        if not status:
            raise HTTPException(status_code=404, detail="Call not found")
        if provider_call_id != call_id:
            exotel_info = _active_calls.get(provider_call_id, {})
            call_info.update(
                {
                    "status": exotel_info.get("status", call_info.get("status", "queued")),
                    "phone_number": exotel_info.get("phone_number", call_info.get("phone_number", "")),
                    "customer_name": exotel_info.get("customer_name", call_info.get("customer_name")),
                    "customer_id": exotel_info.get("customer_id", call_info.get("customer_id")),
                    "ended_at": exotel_info.get("ended_at", call_info.get("ended_at")),
                    "duration_seconds": exotel_info.get("duration_seconds", call_info.get("duration_seconds")),
                }
            )
            await _persist_call_session(call_info)
            return _call_status_from_info(call_id, call_info)
        await _persist_call_session(_active_calls.get(call_id, {}))
        return status

    status = await get_call_status(call_id)
    if not status:
        raise HTTPException(status_code=404, detail="Call not found")
    await _persist_call_session(_active_calls.get(call_id, {}))
    return status


async def check_call_status_for_user(call_id: str, user_id: str) -> CallStatus:
    """Like check_call_status but only for the owning user; falls back to Mongo if not in memory."""
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user")

    info = _active_calls.get(call_id)
    if info:
        if str(info.get("user_id") or "") != str(user_id):
            raise HTTPException(status_code=404, detail="Call not found")
        return await check_call_status(call_id)

    try:
        db = get_db()
    except Exception:
        raise HTTPException(status_code=404, detail="Call not found") from None

    doc = await db.call_sessions.find_one({"call_id": call_id, "user_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Call not found")
    return _call_status_from_info(call_id, doc)


async def handle_livekit_call_status_webhook(data: dict):
    """Webhook to receive call status updates from LiveKit."""
    call_id = data.get("sipCallId") or data.get("sip_call_id")
    event = data.get("event") or data.get("callStatus")

    if call_id and call_id in _active_calls:
        if event == "CALL_ACCEPTED":
            _active_calls[call_id]["status"] = "in_progress"
            _set_timestamp_once(_active_calls[call_id], "sip_joined_at")
            _flush_pending_audio_timestamps(_active_calls[call_id])
        elif event == "CALL_ENDED":
            _active_calls[call_id]["status"] = "completed"
            _active_calls[call_id]["ended_at"] = datetime.now()
            _update_call_duration(_active_calls[call_id])
            await persist_call_artifacts(_active_calls[call_id])
            _cleanup_call_watchdog(call_id)
            _cleanup_call_watch(call_id)
            await _cleanup_room(_active_calls[call_id]["room_name"])
        elif str(event or "").strip().lower() in {"call_failed", "busy", "no_answer", "no-answer", "canceled", "cancelled"}:
            _active_calls[call_id]["status"] = "failed"
            _active_calls[call_id]["ended_at"] = datetime.now()
            _update_call_duration(_active_calls[call_id])
            await persist_call_artifacts(_active_calls[call_id])
            _cleanup_call_watchdog(call_id)
            _cleanup_call_watch(call_id)
        elif event:
            _active_calls[call_id]["status"] = str(event).lower()

        logger.info(f"Call {call_id} status updated: {event}")
        await _persist_call_session(_active_calls.get(call_id, {}))

    return {"ok": True}


def get_health_payload():
    pool = _warm_pool_snapshot()
    primary = (
        "issabel-sip"
        if _issabel_direct_enabled()
        else ("exotel" if _exotel_enabled() else ("livekit-sip" if _livekit_configured() else "none"))
    )
    return {
        "ok": True,
        "active_calls": len(_active_calls),
        "active_bots": len(_bot_tasks),
        "provider": primary,
        "issabel_direct_enabled": _issabel_direct_enabled(),
        **pool,
    }


active_calls = _active_calls
bot_tasks = _bot_tasks
call_watch_tasks = _call_watch_tasks
warm_workers = _warm_workers
