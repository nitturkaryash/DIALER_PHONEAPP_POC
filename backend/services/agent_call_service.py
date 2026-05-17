"""Human-agent softphone: LiveKit room + SIP customer leg, no Pipecat bot."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, status
from livekit import api
from loguru import logger

from config import config
from db.mongo import get_db
from models.agent_calls import (
    HumanAgentCallRequest,
    HumanAgentCallResponse,
    HumanAgentCallStatus,
    HumanAgentDispositionRequest,
)
from services.outbound_call_service import (
    _active_calls,
    _call_status_from_info,
    _cleanup_call_watchdog,
    _cleanup_room,
    _get_livekit_client,
    _is_terminal_call_status,
    _livekit_ws_url,
    _persist_call_session,
    _required_env,
    _schedule_call_watchdog,
    _watch_sip_join,
    check_call_status,
    get_user_outbound_config,
)

# Human-agent calls tracked in the same in-memory map for status refresh helpers.
_human_agent_call_ids: set[str] = set()
_call_watch_tasks: dict[str, asyncio.Task] = {}


def _cleanup_human_call_watch(call_id: str) -> None:
    task = _call_watch_tasks.pop(call_id, None)
    if task and not task.done():
        task.cancel()


def _clean_string(value) -> str:
    return str(value or "").strip()


def _livekit_configured() -> bool:
    return bool(
        config.setting("LIVEKIT_URL")
        and config.setting("LIVEKIT_API_KEY")
        and config.setting("LIVEKIT_API_SECRET")
    )


def _issabel_direct_configured() -> bool:
    return bool(config.setting("ISSABEL_SIP_HOST") and config.setting("ISSABEL_SIP_PASSWORD"))


def _private_issabel_host() -> bool:
    host = _clean_string(config.setting("ISSABEL_SIP_HOST"))
    return host.startswith(("10.", "172.", "192.168."))


def _use_issabel_direct_human() -> bool:
    """Use backend VPN SIP for the phone leg when Issabel is on a private network."""
    explicit = config.optional_setting("HUMAN_AGENT_USE_ISSABEL_DIRECT")
    if explicit is not None:
        return config.bool_setting("HUMAN_AGENT_USE_ISSABEL_DIRECT", False)
    return _issabel_direct_configured() and _private_issabel_host()


def _human_agent_provider(user_conf: dict | None, requested: str | None) -> str:
    pref = _clean_string(requested or "auto").lower()
    if pref in {"livekit-issabel", "issabel", "issabel-sip", "issabel-direct"}:
        if not _issabel_direct_configured():
            raise HTTPException(
                status_code=500,
                detail="Issabel direct SIP is not configured. Set ISSABEL_SIP_HOST and ISSABEL_SIP_PASSWORD.",
            )
        if not _livekit_configured():
            raise HTTPException(
                status_code=500,
                detail="LiveKit is required for agent browser audio. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.",
            )
        return "issabel-human-agent"
    if pref in {"livekit-sip", "sip", "livekit"}:
        if not _livekit_configured():
            raise HTTPException(
                status_code=500,
                detail="LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_SIP_TRUNK_ID.",
            )
        return "livekit-human-agent"
    if pref == "exotel":
        raise HTTPException(
            status_code=501,
            detail="Human agent voice is not supported on the Exotel bot flow. Use LiveKit SIP for agent softphone calls.",
        )
    # auto — prefer direct Issabel when PBX is only reachable over VPN from this backend.
    if _use_issabel_direct_human() and _livekit_configured():
        return "issabel-human-agent"
    if _livekit_configured() and (
        _clean_string(user_conf.get("sip_trunk_id") if user_conf else "")
        or config.setting("LIVEKIT_SIP_TRUNK_ID")
    ):
        return "livekit-human-agent"
    raise HTTPException(
        status_code=500,
        detail="No telephony provider available for human agent calls. Configure Issabel SIP or LiveKit SIP trunk.",
    )


def _build_agent_token(*, room_name: str, identity: str, name: str) -> str:
    return _build_livekit_token(room_name=room_name, identity=identity, name=name, agent=False)


def _build_livekit_token(*, room_name: str, identity: str, name: str, agent: bool) -> str:
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


def _issabel_dial_for_human(phone: str, user_conf: dict | None) -> str:
    from services.issabel_sip_dial import sip_dial_user_for_issabel

    prefix = _clean_string(user_conf.get("issabel_dial_prefix") if user_conf else "") or None
    if prefix is None:
        prefix = config.optional_setting("LIVEKIT_SIP_DIAL_PREFIX")
    if prefix is None:
        prefix = config.optional_setting("ISSABEL_SIP_DIAL_PREFIX")
    dial = sip_dial_user_for_issabel(phone, prefix_digits=prefix)
    if not dial:
        raise HTTPException(status_code=400, detail="Invalid phone number for Issabel dial string")
    return dial


async def _bootstrap_human_issabel_direct(
    *,
    call_id: str,
    dial: str,
    room_name: str,
    bridge_token: str,
    agent_identity: str,
    user_conf: dict | None,
) -> None:
    from services.human_issabel_bridge import start_human_issabel_bridge_task

    info = _active_calls.get(call_id)
    if not info:
        return

    def _on_answered() -> None:
        if not info.get("sip_joined_at"):
            info["sip_joined_at"] = datetime.now()
        info["status"] = "in_progress"
        info.pop("failure_reason", None)
        asyncio.create_task(_persist_call_session(info), name=f"persist-human-answered:{call_id}")

    def _on_failed(exc: Exception) -> None:
        info["status"] = "failed"
        info["failure_reason"] = str(exc)
        info["end_reason"] = "sip_setup_failed"
        info["ended_at"] = datetime.now()
        asyncio.create_task(_persist_call_session(info), name=f"persist-human-failed:{call_id}")
        _cleanup_call_watchdog(call_id)
        _cleanup_human_call_watch(call_id)

    try:
        await start_human_issabel_bridge_task(
            call_id=call_id,
            dial=dial,
            livekit_url=_livekit_ws_url(),
            bridge_token=bridge_token,
            agent_identity=agent_identity,
            issabel_config=user_conf,
            on_answered=_on_answered,
            on_failed=_on_failed,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _on_failed(exc)
    finally:
        final = _active_calls.get(call_id)
        if final and final.get("status") not in {"ended", "failed"}:
            final["status"] = "completed"
            final.setdefault("end_reason", "bridge_stopped")
            final["ended_at"] = datetime.now()
            await _persist_call_session(final)
        _cleanup_call_watchdog(call_id)
        _cleanup_human_call_watch(call_id)


def _human_room_metadata(
    *,
    phone_number: str,
    customer_name: str,
    user_id: str,
    campaign_id: Optional[str],
    lead_id: Optional[str],
) -> str:
    return json.dumps(
        {
            "call_mode": "human_agent",
            "customer_name": customer_name,
            "phone_number": phone_number,
            "user_id": user_id,
            "campaign_id": campaign_id,
            "campaign_contact_id": lead_id,
        }
    )


def _human_status_from_info(call_id: str, info: dict) -> HumanAgentCallStatus:
    base = _call_status_from_info(call_id, info)
    return HumanAgentCallStatus(
        call_id=base.call_id,
        status=base.status,
        phone_number=base.phone_number,
        room_name=info.get("room_name"),
        provider=info.get("provider"),
        call_requested_at=base.call_requested_at,
        sip_dial_started_at=base.sip_dial_started_at,
        sip_joined_at=base.sip_joined_at,
        agent_joined_at=info.get("agent_joined_at"),
        started_at=base.started_at,
        ended_at=base.ended_at,
        duration_seconds=base.duration_seconds,
    )


def _livekit_sip_call_to(phone_number: str) -> str:
    config.reload()
    dial_prefix = config.optional_setting("LIVEKIT_SIP_DIAL_PREFIX")
    if dial_prefix is None:
        dial_prefix = config.optional_setting("ISSABEL_SIP_DIAL_PREFIX")
    if dial_prefix is None:
        return phone_number

    from services.issabel_sip_dial import sip_dial_user_for_issabel

    dial_user = sip_dial_user_for_issabel(phone_number, prefix_digits=dial_prefix)
    return dial_user or phone_number


async def create_human_agent_call(request: HumanAgentCallRequest, user_id: str) -> HumanAgentCallResponse:
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user")

    user_conf = await get_user_outbound_config(user_id)
    provider = _human_agent_provider(user_conf, request.provider)

    phone = _clean_string(request.phone_number)
    if not phone:
        raise HTTPException(status_code=400, detail="phone_number is required")

    call_id = str(uuid4())
    room_name = f"human-{call_id.replace('-', '')[:12]}"
    agent_identity = f"agent-{user_id[:8]}-{call_id[:8]}"
    customer_name = _clean_string(request.customer_name) or "Manual Dial"
    sip_identity = f"sip-{phone.replace('+', '')}"

    metadata = _human_room_metadata(
        phone_number=phone,
        customer_name=customer_name,
        user_id=user_id,
        campaign_id=request.campaign_id,
        lead_id=request.lead_id,
    )

    lk = _get_livekit_client()
    try:
        await lk.room.create_room(
            api.CreateRoomRequest(name=room_name, empty_timeout=300, metadata=metadata)
        )

        agent_token = _build_agent_token(
            room_name=room_name,
            identity=agent_identity,
            name=customer_name,
        )

        now = datetime.now()
        call_info = {
            "call_id": call_id,
            "room_name": room_name,
            "phone_number": phone,
            "customer_name": customer_name,
            "customer_id": request.lead_id,
            "status": "queued",
            "call_requested_at": now,
            "started_at": now,
            "provider": provider,
            "call_mode": "human_agent",
            "user_id": user_id,
            "campaign_id": request.campaign_id,
            "campaign_contact_id": request.lead_id,
            "agent_identity": agent_identity,
            "sip_participant_identity": sip_identity,
            "bot_config": {},
        }
        _active_calls[call_id] = call_info
        _human_agent_call_ids.add(call_id)
        await _persist_call_session(call_info)

        if provider == "issabel-human-agent":
            dial = _issabel_dial_for_human(phone, user_conf)
            bridge_identity = f"phone-bridge-{call_id[:8]}"
            bridge_token = _build_livekit_token(
                room_name=room_name,
                identity=bridge_identity,
                name="Phone Bridge",
                agent=True,
            )
            call_info["sip_call_to"] = dial
            call_info["bridge_identity"] = bridge_identity
            call_info["sip_dial_started_at"] = datetime.now()
            call_info["status"] = "ringing"
            await _persist_call_session(call_info)
            _schedule_call_watchdog(call_id)
            _call_watch_tasks[call_id] = asyncio.create_task(
                _bootstrap_human_issabel_direct(
                    call_id=call_id,
                    dial=dial,
                    room_name=room_name,
                    bridge_token=bridge_token,
                    agent_identity=agent_identity,
                    user_conf=user_conf,
                ),
                name=f"human-issabel-bridge:{call_id}",
            )
            logger.info(
                f"Human agent call created (Issabel direct): {call_id} room={room_name} "
                f"phone={phone} sip_call_to={dial}"
            )
        else:
            trunk_id = _clean_string(user_conf.get("sip_trunk_id")) or _required_env("LIVEKIT_SIP_TRUNK_ID")
            sip_call_to = _livekit_sip_call_to(phone)
            call_info["sip_call_to"] = sip_call_to
            request_kwargs = {
                "sip_trunk_id": trunk_id,
                "sip_call_to": sip_call_to,
                "room_name": room_name,
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
            call_info["status"] = "ringing"
            response = await lk.sip.create_sip_participant(api.CreateSIPParticipantRequest(**request_kwargs))
            sip_call_id = response.sip_call_id
            if sip_call_id and sip_call_id != call_id:
                call_info["provider_call_id"] = sip_call_id

            _active_calls[call_id] = call_info
            await _persist_call_session(call_info)
            _schedule_call_watchdog(call_id)
            _call_watch_tasks[call_id] = asyncio.create_task(
                _watch_sip_join(call_id),
                name=f"human-sip-join:{call_id}",
            )
            logger.info(
                f"Human agent call created (LiveKit SIP): {call_id} room={room_name} "
                f"phone={phone} sip_call_to={sip_call_to} sip_number={outbound_number or '<default>'}"
            )

        return HumanAgentCallResponse(
            call_id=call_id,
            room_name=room_name,
            livekit_url=_livekit_ws_url(),
            agent_token=agent_token,
            agent_identity=agent_identity,
            status=call_info.get("status", "ringing"),
            provider=provider,
            phone_number=phone,
            customer_name=customer_name,
        )
    except HTTPException:
        await _cleanup_room(room_name, cancel_bot_task=False)
        _active_calls.pop(call_id, None)
        _human_agent_call_ids.discard(call_id)
        raise
    except Exception as exc:
        logger.exception(f"Failed to create human agent call: {exc}")
        await _cleanup_room(room_name, cancel_bot_task=False)
        _active_calls.pop(call_id, None)
        _human_agent_call_ids.discard(call_id)
        raise HTTPException(status_code=500, detail=str(exc) or "Failed to create human agent call")
    finally:
        await lk.aclose()


async def get_human_agent_call_status(call_id: str, user_id: str) -> HumanAgentCallStatus:
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user")

    info = _active_calls.get(call_id)
    if info:
        if str(info.get("user_id") or "") != str(user_id):
            raise HTTPException(status_code=404, detail="Call not found")
        if call_id in _human_agent_call_ids and not _is_terminal_call_status(info.get("status")):
            refreshed = await check_call_status(call_id)
            info = _active_calls.get(call_id, info)
            return _human_status_from_info(call_id, info)

    try:
        db = get_db()
    except Exception:
        raise HTTPException(status_code=404, detail="Call not found") from None

    doc = await db.call_sessions.find_one(
        {"call_id": call_id, "user_id": user_id, "call_mode": "human_agent"}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Call not found")
    return _human_status_from_info(call_id, doc)


async def hangup_human_agent_call(call_id: str, user_id: str) -> dict:
    info = _active_calls.get(call_id)
    if not info or str(info.get("user_id") or "") != str(user_id):
        raise HTTPException(status_code=404, detail="Call not found")

    room_name = info.get("room_name")
    sip_identity = info.get("sip_participant_identity")

    if info.get("provider") == "issabel-human-agent":
        from services.human_issabel_bridge import stop_human_issabel_bridge

        await stop_human_issabel_bridge(call_id)
    elif room_name and sip_identity and not info.get("ended_at"):
        lk = _get_livekit_client()
        try:
            await lk.room.remove_participant(
                api.RoomParticipantIdentity(room=room_name, identity=sip_identity)
            )
        except Exception as exc:
            logger.warning(f"Failed to remove SIP participant {sip_identity}: {exc}")
        finally:
            await lk.aclose()

    info["status"] = "ended"
    info["ended_at"] = datetime.now()
    if info.get("sip_joined_at") and not info.get("duration_seconds"):
        delta = (info["ended_at"] - info["sip_joined_at"]).total_seconds()
        info["duration_seconds"] = max(0, int(delta))

    await _persist_call_session(info)
    _cleanup_call_watchdog(call_id)
    _cleanup_human_call_watch(call_id)

    if room_name:
        await _cleanup_room(room_name, cancel_bot_task=False)

    return {"success": True, "status": info.get("status", "ended")}


async def save_human_agent_disposition(
    call_id: str,
    user_id: str,
    payload: HumanAgentDispositionRequest,
) -> dict:
    try:
        db = get_db()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}") from exc

    call = await db.call_sessions.find_one(
        {"call_id": call_id, "user_id": user_id, "call_mode": "human_agent"}
    )
    if not call:
        raise HTTPException(status_code=404, detail="Call session not found")

    now = datetime.now()
    outcome_state = str(payload.outcome or "completed").strip().lower().replace(" ", "-")
    await db.call_sessions.update_one(
        {"_id": call["_id"]},
        {
            "$set": {
                "outcome": payload.outcome,
                "notes": payload.notes,
                "callback_time": payload.callback_time,
                "status": "ended",
                "ended_at": call.get("ended_at") or now,
                "updated_at": now,
            }
        },
    )

    contact_id = call.get("campaign_contact_id")
    if contact_id:
        from bson import ObjectId

        if ObjectId.is_valid(str(contact_id)):
            await db.campaign_contacts.update_one(
                {"_id": ObjectId(str(contact_id))},
                {"$set": {"state": outcome_state, "updated_at": now}},
            )

    info = _active_calls.get(call_id)
    if info:
        info["status"] = "ended"
        info.setdefault("ended_at", now)

    return {"success": True}


async def mark_agent_joined(call_id: str, user_id: str) -> None:
    """Optional heartbeat when the mobile/web client connects to LiveKit."""
    info = _active_calls.get(call_id)
    if not info or str(info.get("user_id") or "") != str(user_id):
        return
    if not info.get("agent_joined_at"):
        info["agent_joined_at"] = datetime.now()
        await _persist_call_session(info)
