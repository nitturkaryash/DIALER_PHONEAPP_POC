from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import Awaitable, Callable, Optional
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from config import config
from db.mongo import get_db
from services.callback_bot_service import BotSessionObserver, run_bot
from services.call_failure_service import mark_call_failed
from services.conversation_service import append_event
from services.exotel_transport_service import create_exotel_transport_from_websocket
from services.outbound_call_service import (
    active_calls as outbound_active_calls,
    mark_exotel_voice_websocket_connected,
    mark_exotel_voice_websocket_disconnected,
    _schedule_completed_call_eviction,
    _update_call_duration,
)
from services.ivr_detection_service import detect_ivr_from_turns
from utils.auth import basic_auth_matches

from pipecat.runner.types import WebSocketRunnerArguments


_active_exotel_sessions = 0
_last_exotel_connect_ts: int | None = None
_last_exotel_disconnect_ts: int | None = None
_last_exotel_webhook_ts: int | None = None
_last_exotel_webhook_payload: dict | None = None
_last_exotel_session: dict | None = None
_TERMINAL_EXOTEL_STATUSES = {"completed", "failed", "busy", "no-answer", "no_answer", "canceled", "cancelled"}


def _mark_session_timestamp(session_state: dict, key: str):
    if not session_state.get(key):
        session_state[key] = int(time.time())


def _cancel_task(session_state: dict, key: str):
    task = session_state.pop(key, None)
    if task and not task.done():
        task.cancel()


def _resolve_exotel_call_id(websocket: WebSocket) -> str:
    params = websocket.query_params
    candidates = [
        params.get("CallSid"),
        params.get("call_sid"),
        params.get("callSid"),
        params.get("sid"),
    ]
    for value in candidates:
        clean = (value or "").strip()
        if clean:
            return clean
    return f"exotel-{uuid4().hex}"


def _append_transcript_turn(session_state: dict, actor: str, text: str):
    clean = (text or "").strip()
    if not clean:
        return
    session_state.setdefault("transcript_turns", []).append({"actor": actor, "text": clean})
    _schedule_transcript_snapshot(session_state)


async def _persist_conversation_event(session_state: dict, actor: str, event_type: str, content: str):
    call_id = session_state.get("call_id")
    if not call_id:
        return
    try:
        await append_event(
            call_id=call_id,
            user_id=session_state.get("user_id"),
            actor=actor,
            event_type=event_type,
            content=content,
        )
    except Exception as exc:
        logger.warning(f"Failed to persist Exotel conversation event ({call_id=}, {actor=}, {event_type=}): {exc}")


def _build_final_transcript(session_state: dict) -> tuple[str, int]:
    lines: list[str] = []
    for turn in session_state.get("transcript_turns", []):
        actor = str((turn or {}).get("actor") or "").strip().lower()
        text = str((turn or {}).get("text") or "").strip()
        if not text:
            continue
        speaker = "user" if actor == "user" else ("assistant" if actor == "assistant" else actor or "system")
        lines.append(f"{speaker}: {text}")
    return "\n".join(lines), len(lines)


async def _persist_final_transcript(session_state: dict, reason: str):
    if session_state.get("final_transcript_saved"):
        return

    final_transcript, turn_count = _build_final_transcript(session_state)
    call_id = session_state.get("call_id")
    if not call_id:
        return

    try:
        db = get_db()
    except Exception:
        await mark_call_failed(
            call_id,
            end_reason="exotel_final_transcript_db_unavailable",
            state=session_state,
        )
        return

    now = datetime.now()
    try:
        await db.call_sessions.update_one(
            {"call_id": call_id},
            {
                "$set": {
                    "call_id": call_id,
                    "provider": "exotel",
                    "status": session_state.get("status") or "completed",
                    "end_reason": reason,
                    "started_at": session_state.get("started_at"),
                    "ended_at": now,
                    "final_transcript": final_transcript,
                    "transcript_turn_count": turn_count,
                    "transcript_saved_at": now,
                    "created_at": session_state.get("started_at") or now,
                }
            },
            upsert=True,
        )
    except Exception as exc:
        await mark_call_failed(
            call_id,
            end_reason="exotel_final_transcript_persist_failed",
            error_message=str(exc),
            state=session_state,
        )
        return
    session_state["final_transcript_saved"] = True


def _schedule_transcript_snapshot(session_state: dict):
    if session_state.get("final_transcript_saved"):
        return
    task = session_state.get("transcript_snapshot_task")
    if task and not task.done():
        return

    async def _persist_snapshot():
        call_id = session_state.get("call_id")
        if not call_id:
            return
        final_transcript, turn_count = _build_final_transcript(session_state)
        if turn_count == 0:
            return
        if session_state.get("last_transcript_snapshot_turn_count") == turn_count:
            return
        try:
            db = get_db()
        except Exception:
            await mark_call_failed(
                call_id,
                end_reason="exotel_transcript_snapshot_db_unavailable",
                state=session_state,
            )
            return
        now = datetime.now()
        try:
            await db.call_sessions.update_one(
                {"call_id": call_id},
                {
                    "$set": {
                        "call_id": call_id,
                        "provider": "exotel",
                        "final_transcript": final_transcript,
                        "transcript_turn_count": turn_count,
                        "transcript_saved_at": now,
                        "created_at": session_state.get("started_at") or now,
                    }
                },
                upsert=True,
            )
        except Exception as exc:
            await mark_call_failed(
                call_id,
                end_reason="exotel_transcript_snapshot_persist_failed",
                error_message=str(exc),
                state=session_state,
            )
            return
        session_state["last_transcript_snapshot_turn_count"] = turn_count

    task = asyncio.create_task(
        _persist_snapshot(),
        name=f"exotel-transcript-snapshot:{session_state.get('call_id', 'unknown')}",
    )

    def _clear_snapshot_task(done_task):
        if session_state.get("transcript_snapshot_task") is done_task:
            session_state.pop("transcript_snapshot_task", None)

    task.add_done_callback(_clear_snapshot_task)
    session_state["transcript_snapshot_task"] = task


def _build_session_observer(
    session_state: dict,
    on_ivr_detected: Optional[Callable[[], Awaitable[None]]] = None,
) -> BotSessionObserver:
    def _ivr_no_user_timeout_secs() -> float:
        try:
            return max(5.0, config.float_setting("IVR_NO_USER_TIMEOUT_SECS", 12.0))
        except Exception:
            return 12.0

    async def _watch_no_user_response():
        await asyncio.sleep(_ivr_no_user_timeout_secs())
        if session_state.get("ivr_detection_triggered"):
            return
        if session_state.get("first_user_audio_ts"):
            return
        reason = "no_user_response_after_bot_audio"
        session_state["ivr_detection_triggered"] = True
        session_state["end_reason"] = reason
        session_state["status"] = "ended_ivr"
        session_state["ended_at"] = datetime.now()
        await _persist_final_transcript(session_state, reason)
        if on_ivr_detected:
            await on_ivr_detected()

    async def _on_user_transcript(text: str):
        _append_transcript_turn(session_state, "user", text)
        await _persist_conversation_event(session_state, "user", "transcript", text)
        _cancel_task(session_state, "ivr_no_user_watch_task")
        if session_state.get("ivr_detection_triggered"):
            return
        turns = session_state.get("transcript_turns") or []
        ai_context = config.setting("IVR_DETECTION_CONTEXT") or None
        if not detect_ivr_from_turns(turns, ai_context):
            return

        session_state["ivr_detection_triggered"] = True
        session_state["end_reason"] = "ivr_detected"
        await _persist_final_transcript(session_state, "ivr_detected")
        if on_ivr_detected:
            await on_ivr_detected()

    async def _on_assistant_text(text: str):
        _append_transcript_turn(session_state, "assistant", text)
        await _persist_conversation_event(session_state, "assistant", "response", text)

    def _on_first_bot_audio():
        _mark_session_timestamp(session_state, "first_bot_audio_ts")
        watch = session_state.get("ivr_no_user_watch_task")
        if not watch or watch.done():
            session_state["ivr_no_user_watch_task"] = asyncio.create_task(
                _watch_no_user_response(),
                name=f"exotel-ivr-no-user-watch:{session_state.get('call_id', 'unknown')}",
            )

    def _on_first_user_audio():
        _mark_session_timestamp(session_state, "first_user_audio_ts")
        _cancel_task(session_state, "ivr_no_user_watch_task")

    async def _on_session_end(reason: str):
        _cancel_task(session_state, "ivr_no_user_watch_task")
        await _persist_final_transcript(session_state, reason or "farewell")

    return BotSessionObserver(
        on_first_bot_audio=_on_first_bot_audio,
        on_first_user_audio=_on_first_user_audio,
        on_user_transcript=_on_user_transcript,
        on_assistant_text=_on_assistant_text,
        on_session_end=_on_session_end,
    )


async def _authorize_websocket(websocket: WebSocket) -> bool:
    expected_user = config.setting("EXOTEL_WS_BASIC_USER")
    expected_token = config.setting("EXOTEL_WS_BASIC_TOKEN")
    if not expected_user and not expected_token:
        return True

    auth_header = websocket.headers.get("authorization") or ""
    if basic_auth_matches(auth_header, expected_user, expected_token):
        return True

    await websocket.close(code=1008)
    return False


async def _load_runner_body_for_call(call_id: str) -> dict:
    if not call_id:
        return {"call_id": call_id, "bot_config": {}}
    try:
        db = get_db()
    except Exception:
        await mark_call_failed(
            call_id,
            end_reason="exotel_runner_body_db_unavailable",
        )
        return {"call_id": call_id, "bot_config": {}}

    doc = await db.call_sessions.find_one({"call_id": call_id})
    if not doc:
        return {"call_id": call_id, "bot_config": {}}

    bot_config = doc.get("bot_config")
    if not isinstance(bot_config, dict):
        bot_config = {}

    return {
        "call_id": call_id,
        "user_id": doc.get("user_id"),
        "campaign_id": doc.get("campaign_id"),
        "campaign_contact_id": doc.get("campaign_contact_id"),
        "bot_config": bot_config,
    }


async def handle_exotel_websocket(websocket: WebSocket):
    global _active_exotel_sessions, _last_exotel_connect_ts, _last_exotel_disconnect_ts, _last_exotel_session

    if not await _authorize_websocket(websocket):
        return

    await websocket.accept()
    logger.info("Exotel WS connected")
    _active_exotel_sessions += 1
    _last_exotel_connect_ts = int(time.time())
    session_state = {
        "call_id": _resolve_exotel_call_id(websocket),
        "started_at": datetime.now(),
        "connected_ts": _last_exotel_connect_ts,
        "first_bot_audio_ts": None,
        "first_user_audio_ts": None,
        "disconnected_ts": None,
        "error": None,
        "transcript_turns": [],
        "final_transcript_saved": False,
    }
    _last_exotel_session = session_state

    async def _terminate_exotel_call_on_ivr():
        logger.info(f"Exotel call {session_state.get('call_id')} ended due to IVR detection")
        session_state["status"] = "ended_ivr"
        session_state["ended_at"] = datetime.now()
        try:
            await websocket.close(code=1000)
        except Exception:
            pass

    session_observer = _build_session_observer(session_state, on_ivr_detected=_terminate_exotel_call_on_ivr)

    try:
        transport = await create_exotel_transport_from_websocket(websocket)
        start_info = getattr(transport, "exotel_start_info", None)
        call_id = None
        if start_info is not None:
            call_id = getattr(start_info, "call_sid", None) or getattr(start_info, "stream_sid", None)
        if call_id:
            session_state["call_id"] = call_id
        runner_body = await _load_runner_body_for_call(session_state.get("call_id") or "")
        session_state["user_id"] = runner_body.get("user_id")
        session_state["campaign_id"] = runner_body.get("campaign_id")
        session_state["campaign_contact_id"] = runner_body.get("campaign_contact_id")
        mark_exotel_voice_websocket_connected(session_state["call_id"])
        runner_args = WebSocketRunnerArguments(websocket=websocket)
        setattr(runner_args, "body", runner_body)
        await run_bot(
            transport,
            runner_args,
            session_observer=session_observer,
        )
    except WebSocketDisconnect:
        logger.info("Exotel WS disconnected")
    except Exception as exc:
        session_state["error"] = str(exc)
        logger.error(f"Exotel session error: {exc}")
    finally:
        snapshot_task = session_state.pop("transcript_snapshot_task", None)
        if snapshot_task and not snapshot_task.done():
            snapshot_task.cancel()
        watch = session_state.pop("ivr_no_user_watch_task", None)
        if watch and not watch.done():
            watch.cancel()
        await _persist_final_transcript(session_state, "disconnect")
        mark_exotel_voice_websocket_disconnected(session_state.get("call_id") or "")
        try:
            await websocket.close()
        except Exception:
            pass
        _active_exotel_sessions = max(0, _active_exotel_sessions - 1)
        _last_exotel_disconnect_ts = int(time.time())
        session_state["disconnected_ts"] = _last_exotel_disconnect_ts


async def record_webhook_payload(payload: dict):
    global _last_exotel_webhook_ts, _last_exotel_webhook_payload

    _last_exotel_webhook_ts = int(time.time())
    _last_exotel_webhook_payload = payload
    logger.debug(f"Received Exotel webhook payload: {payload}")

    call_id = payload.get("CallSid") or payload.get("call_sid")
    status = payload.get("Status") or payload.get("status")

    if call_id and status:
        try:
            db = get_db()
            normalized_status = str(status).strip().lower()
            update = {"status": normalized_status}
            if normalized_status in _TERMINAL_EXOTEL_STATUSES:
                ended_at = datetime.now()
                update["ended_at"] = ended_at
                call_state = outbound_active_calls.get(call_id)
                if call_state:
                    call_state["status"] = normalized_status
                    call_state["ended_at"] = ended_at
                    _update_call_duration(call_state)
                    _schedule_completed_call_eviction(call_id)
            elif call_id in outbound_active_calls:
                outbound_active_calls[call_id]["status"] = normalized_status
            await db.call_sessions.update_one({"call_id": call_id}, {"$set": update})
            logger.info(f"Updated Exotel call {call_id} status to {status} via webhook")
        except Exception as exc:
            logger.warning(f"Failed to update Exotel call status via webhook: {exc}")
            await mark_call_failed(
                call_id,
                end_reason="exotel_webhook_status_persist_failed",
                error_message=str(exc),
            )

    return "OK"


def get_health_payload():
    return {
        "ok": True,
        "active_sessions": _active_exotel_sessions,
        "last_connect_ts": _last_exotel_connect_ts,
        "last_disconnect_ts": _last_exotel_disconnect_ts,
        "ws_path": "/exotel/voice",
    }


def get_debug_payload():
    return {
        "ok": True,
        "active_sessions": _active_exotel_sessions,
        "last_connect_ts": _last_exotel_connect_ts,
        "last_disconnect_ts": _last_exotel_disconnect_ts,
        "last_webhook_ts": _last_exotel_webhook_ts,
        "last_webhook_payload": _last_exotel_webhook_payload,
        "last_session": _last_exotel_session,
        "ws_path": "/exotel/voice",
        "webhook_path": "/exotel-webhook",
    }
