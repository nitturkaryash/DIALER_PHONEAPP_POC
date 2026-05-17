"""Bridge Issabel RTP (direct SIP) to a LiveKit room for human-agent softphone calls."""

from __future__ import annotations

import asyncio
import contextlib
import random
import struct
import time
from datetime import datetime
from typing import Callable, Optional

from livekit import rtc
from loguru import logger

from config import config
from models.issabel import IssabelSipCallSession
from services.issabel_sip_signaling import issabel_invite_until_answered, issabel_send_bye

try:
    import audioop
except ImportError:
    from utils import audioop_shim as audioop

TELEPHONY_RATE = 8000
FRAME_SAMPLES = 160  # 20ms @ 8kHz
FRAME_BYTES = FRAME_SAMPLES * 2

_bridge_tasks: dict[str, asyncio.Task] = {}
_bridge_sessions: dict[str, IssabelSipCallSession] = {}


def _unpack_rtp_header(data: bytes) -> Optional[tuple[int, int, int, bytes]]:
    if len(data) < 12:
        return None
    if ((data[0] >> 6) & 0x3) != 2:
        return None
    pt = data[1] & 0x7F
    seq = int.from_bytes(data[2:4], "big")
    ts = int.from_bytes(data[4:8], "big")
    return pt, seq, ts, data[12:]


def _pack_rtp(payload: bytes, *, seq: int, ts: int, ssrc: int, pt: int) -> bytes:
    header = bytearray(12)
    header[0] = 0x80
    header[1] = pt & 0x7F
    struct.pack_into("!H", header, 2, seq & 0xFFFF)
    struct.pack_into("!I", header, 4, ts & 0xFFFFFFFF)
    struct.pack_into("!I", header, 8, ssrc & 0xFFFFFFFF)
    return bytes(header) + payload


def bridge_task_active(call_id: str) -> bool:
    task = _bridge_tasks.get(call_id)
    return task is not None and not task.done()


def refresh_human_issabel_call_status(call_info: dict) -> None:
    """Update in-memory status for human calls bridged via direct Issabel."""
    status = str(call_info.get("status") or "").lower()
    if status in {"completed", "failed", "ended"}:
        return

    call_id = str(call_info.get("call_id") or "")
    if bridge_task_active(call_id):
        if call_info.get("sip_joined_at"):
            call_info["status"] = "in_progress"
        else:
            call_info["status"] = "ringing"
        return

    if call_info.get("sip_joined_at") and status not in {"completed", "failed", "ended"}:
        call_info["status"] = "completed"
        call_info.setdefault("end_reason", "bridge_stopped")
    elif status in {"queued", "ringing"}:
        call_info["status"] = "failed"
        call_info.setdefault("failure_reason", "issabel_bridge_stopped")
        call_info.setdefault("end_reason", "sip_setup_failed")

    if not call_info.get("ended_at"):
        call_info["ended_at"] = datetime.now()


async def stop_human_issabel_bridge(call_id: str) -> None:
    task = _bridge_tasks.pop(call_id, None)
    if task and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    session = _bridge_sessions.pop(call_id, None)
    if session:
        try:
            issabel_send_bye(session)
        except Exception as exc:
            logger.warning(f"Issabel BYE failed for {call_id}: {exc}")
        with contextlib.suppress(Exception):
            session.rtp_sock.close()
        with contextlib.suppress(Exception):
            session.sip_sock.close()


async def run_human_issabel_bridge(
    *,
    call_id: str,
    dial: str,
    livekit_url: str,
    bridge_token: str,
    agent_identity: str,
    issabel_config: Optional[dict] = None,
    on_answered: Optional[Callable[[], None]] = None,
    on_failed: Optional[Callable[[Exception], None]] = None,
) -> None:
    """Dial Issabel directly, then bridge RTP with the agent's LiveKit room."""
    loop = asyncio.get_running_loop()
    dial_timeout = config.float_setting("ISSABEL_INVITE_TIMEOUT", 45.0)
    session: Optional[IssabelSipCallSession] = None
    room: Optional[rtc.Room] = None
    stop = asyncio.Event()

    try:
        session = await loop.run_in_executor(
            None,
            lambda: issabel_invite_until_answered(
                dial_digits=dial,
                dial_timeout=dial_timeout,
                call_id=call_id,
                issabel_config=issabel_config,
            ),
        )
        _bridge_sessions[call_id] = session
        if on_answered:
            on_answered()

        room = rtc.Room()
        await room.connect(livekit_url, bridge_token)

        source = rtc.AudioSource(TELEPHONY_RATE, 1)
        local_track = rtc.LocalAudioTrack.create_audio_track("phone-audio", source)
        await room.local_participant.publish_track(local_track)

        rtp_seq = random.randint(0, 0xFFFF)
        rtp_ts = random.randint(0, 0xFFFFFFFF)
        rtp_ssrc = random.randint(0, 0xFFFFFFFF)
        send_pt = 8 if session.use_pcma else 0

        async def _issabel_to_livekit() -> None:
            sock = session.rtp_sock
            sock.settimeout(0.05)
            while not stop.is_set():
                try:
                    pkt, _addr = await asyncio.to_thread(sock.recvfrom, 2048)
                except TimeoutError:
                    continue
                except OSError:
                    break

                unpacked = _unpack_rtp_header(pkt)
                if not unpacked:
                    continue
                pt, _seq, _ts, payload = unpacked
                if not payload:
                    continue
                try:
                    if pt == 0:
                        pcm = audioop.ulaw2lin(payload, 2)
                    elif pt == 8:
                        pcm = audioop.alaw2lin(payload, 2)
                    else:
                        continue
                except Exception:
                    continue

                for offset in range(0, len(pcm), FRAME_BYTES):
                    chunk = pcm[offset : offset + FRAME_BYTES]
                    if len(chunk) < FRAME_BYTES:
                        chunk = chunk + b"\x00" * (FRAME_BYTES - len(chunk))
                    frame = rtc.AudioFrame(chunk, TELEPHONY_RATE, 1, FRAME_SAMPLES)
                    await source.capture_frame(frame)
                    await asyncio.sleep(0.02)

        async def _livekit_to_issabel() -> None:
            nonlocal rtp_seq, rtp_ts
            agent_track: Optional[rtc.RemoteAudioTrack] = None

            @room.on("track_subscribed")
            def _on_track(
                track: rtc.Track,
                publication,
                participant: rtc.RemoteParticipant,
            ):
                nonlocal agent_track
                if participant.identity == agent_identity and isinstance(track, rtc.RemoteAudioTrack):
                    agent_track = track

            deadline = time.monotonic() + 60.0
            while agent_track is None and time.monotonic() < deadline and not stop.is_set():
                await asyncio.sleep(0.1)

            if agent_track is None:
                logger.warning(f"[{call_id}] Agent audio track not found for {agent_identity}")
                return

            stream = rtc.AudioStream(agent_track, sample_rate=TELEPHONY_RATE, num_channels=1)
            async for event in stream:
                if stop.is_set():
                    break
                pcm = bytes(event.frame.data)
                if session.use_pcma:
                    payload = audioop.lin2alaw(pcm, 2)
                else:
                    payload = audioop.lin2ulaw(pcm, 2)
                packet = _pack_rtp(
                    payload,
                    seq=rtp_seq,
                    ts=rtp_ts,
                    ssrc=rtp_ssrc,
                    pt=send_pt,
                )
                rtp_seq = (rtp_seq + 1) & 0xFFFF
                rtp_ts = (rtp_ts + FRAME_SAMPLES) & 0xFFFFFFFF
                session.rtp_sock.sendto(packet, (session.remote_rtp_host, session.remote_rtp_port))
                await asyncio.sleep(0.02)

        await asyncio.gather(_issabel_to_livekit(), _livekit_to_issabel())
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.error(f"Human Issabel bridge failed for {call_id}: {exc}")
        if on_failed:
            on_failed(exc)
        raise
    finally:
        stop.set()
        if room:
            with contextlib.suppress(Exception):
                await room.disconnect()
        _bridge_sessions.pop(call_id, None)


def start_human_issabel_bridge_task(**kwargs) -> asyncio.Task:
    call_id = kwargs["call_id"]
    existing = _bridge_tasks.get(call_id)
    if existing and not existing.done():
        existing.cancel()

    task = asyncio.create_task(
        run_human_issabel_bridge(**kwargs),
        name=f"human-issabel-bridge:{call_id}",
    )
    _bridge_tasks[call_id] = task

    def _done(finished: asyncio.Task, *, cid: str = call_id) -> None:
        if _bridge_tasks.get(cid) is finished:
            _bridge_tasks.pop(cid, None)

    task.add_done_callback(_done)
    return task
