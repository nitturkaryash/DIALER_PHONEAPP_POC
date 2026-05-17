from __future__ import annotations

import asyncio
import io
import json
import time
import wave
from datetime import datetime
from typing import Optional

from google import genai
from google.genai import types as genai_types
from loguru import logger

from config import config
from db.mongo import get_db
from services.call_failure_service import mark_call_failed
from services.s3_service import upload_call_wav

try:
    import audioop
except Exception:  # pragma: no cover
    from utils import audioop_shim as audioop


def append_transcript_turn(call_info: Optional[dict], actor: str, text: str):
    if not call_info:
        return
    clean = (text or "").strip()
    if not clean:
        return
    touch_call_activity(call_info)
    turns = call_info.setdefault("transcript_turns", [])
    turns.append({"actor": actor, "text": clean})
    _schedule_transcript_snapshot(call_info)


def _build_structured_transcript(call_info: Optional[dict]) -> list[dict[str, str]]:
    turns = (call_info or {}).get("transcript_turns") or []
    transcript: list[dict[str, str]] = []
    for turn in turns:
        actor = str((turn or {}).get("actor") or "").strip().lower()
        text = str((turn or {}).get("text") or "").strip()
        if not text:
            continue
        if actor == "assistant":
            speaker = "agent"
        elif actor == "user":
            speaker = "user"
        else:
            continue
        transcript.append({"speaker": speaker, "text": text})
    return transcript


def _get_call_id(call_info: Optional[dict]) -> str:
    return str((call_info or {}).get("call_id") or "").strip()


def touch_call_activity(call_info: Optional[dict]) -> None:
    if not call_info:
        return
    call_info["last_activity_monotonic_at"] = time.monotonic()


async def _persist_structured_transcript(
    call_id: str,
    transcript: list[dict[str, str]],
    *,
    error_context: str,
    call_info: Optional[dict] = None,
) -> bool:
    try:
        db = get_db()
        await db.call_sessions.update_one(
            {"call_id": call_id},
            {
                "$set": {
                    "call_id": call_id,
                    "transcript": transcript,
                    "transcript_turn_count": len(transcript),
                    "transcript_saved_at": datetime.now(),
                },
                "$unset": {
                    "final_transcript": "",
                },
            },
            upsert=True,
        )
    except Exception as exc:
        logger.warning(f"{error_context} for {call_id}: {exc}")
        await mark_call_failed(
            call_id,
            end_reason="transcript_persist_failed",
            error_message=str(exc),
            state=call_info,
        )
        return False
    return True


async def _persist_final_transcript(call_info: Optional[dict]):
    if not call_info:
        return
    if call_info.get("final_transcript_saved"):
        return

    call_id = _get_call_id(call_info)
    if not call_id:
        return

    transcript = _build_structured_transcript(call_info)
    if not transcript:
        return

    if not await _persist_structured_transcript(
        call_id,
        transcript,
        error_context="Failed to persist final transcript",
        call_info=call_info,
    ):
        return

    call_info["transcript"] = transcript
    call_info["final_transcript_saved"] = True


def _schedule_transcript_snapshot(call_info: Optional[dict]):
    if not call_info:
        return
    if call_info.get("final_transcript_saved"):
        return

    task = call_info.get("transcript_snapshot_task")
    if task and not task.done():
        return

    async def _persist_snapshot():
        call_id = _get_call_id(call_info)
        if not call_id:
            return

        transcript = _build_structured_transcript(call_info)
        turn_count = len(transcript)
        if turn_count == 0:
            return
        if call_info.get("last_transcript_snapshot_turn_count") == turn_count:
            return

        saved = await _persist_structured_transcript(
            call_id,
            transcript,
            error_context="Failed to persist transcript snapshot",
            call_info=call_info,
        )
        if not saved:
            return

        call_info["last_transcript_snapshot_turn_count"] = turn_count

    task = asyncio.create_task(
        _persist_snapshot(),
        name=f"transcript-snapshot:{call_info.get('call_id', 'unknown')}",
    )
    call_info["transcript_snapshot_task"] = task

    def _clear_snapshot_task(finished: asyncio.Task):
        if call_info.get("transcript_snapshot_task") is finished:
            call_info.pop("transcript_snapshot_task", None)

    task.add_done_callback(_clear_snapshot_task)


def append_audio_chunk(
    call_info: Optional[dict],
    stream: str,
    audio_bytes: bytes,
    sample_rate: int,
    num_channels: int,
):
    if not call_info or not audio_bytes:
        return
    touch_call_activity(call_info)
    if str(stream or "").strip().lower() == "assistant":
        pending = call_info.setdefault("pending_assistant_audio_turn", {})
        if not pending:
            pending["sample_rate"] = max(1, int(sample_rate or 24000))
            pending["num_channels"] = max(1, int(num_channels or 1))
            pending["captured_at"] = time.monotonic()
            pending["audio"] = bytearray()
        pending_audio = pending.get("audio")
        if not isinstance(pending_audio, bytearray):
            pending_audio = bytearray(bytes(pending_audio or b""))
            pending["audio"] = pending_audio
        pending_audio.extend(bytes(audio_bytes))
        pending["sample_rate"] = max(1, int(sample_rate or pending.get("sample_rate") or 24000))
        pending["num_channels"] = max(1, int(num_channels or pending.get("num_channels") or 1))
        return

    chunk_index = int(call_info.get("_audio_chunk_index") or 0)
    call_info["_audio_chunk_index"] = chunk_index + 1
    chunks = call_info.setdefault("audio_chunks", [])
    chunks.append(
        {
            "chunk_index": chunk_index,
            "stream": stream,
            "audio": bytes(audio_bytes),
            "sample_rate": max(1, int(sample_rate or 16000)),
            "num_channels": max(1, int(num_channels or 1)),
            "captured_at": time.monotonic(),
        }
    )


def finalize_assistant_audio_turn(call_info: Optional[dict]) -> None:
    if not call_info:
        return
    touch_call_activity(call_info)
    pending = call_info.pop("pending_assistant_audio_turn", None)
    if not isinstance(pending, dict):
        return
    audio_bytes = bytes(pending.get("audio") or b"")
    if not audio_bytes:
        return

    chunk_index = int(call_info.get("_audio_chunk_index") or 0)
    call_info["_audio_chunk_index"] = chunk_index + 1
    chunks = call_info.setdefault("audio_chunks", [])
    chunks.append(
        {
            "chunk_index": chunk_index,
            "stream": "assistant",
            "audio": audio_bytes,
            "sample_rate": max(1, int(pending.get("sample_rate") or 24000)),
            "num_channels": max(1, int(pending.get("num_channels") or 1)),
            "captured_at": float(pending.get("captured_at") or time.monotonic()),
        }
    )


def _resample_pcm16(audio_bytes: bytes, *, input_rate: int, output_rate: int) -> bytes:
    if not audio_bytes or input_rate == output_rate:
        return audio_bytes
    converted, _ = audioop.ratecv(audio_bytes, 2, 1, input_rate, output_rate, None)
    return converted


def _max_render_gap_secs() -> float:
    return max(0.0, config.float_setting("CALL_AUDIO_RENDER_MAX_GAP_SECS", 0.35))


def _build_call_audio_wav(call_info: Optional[dict]) -> bytes | None:
    finalize_assistant_audio_turn(call_info)
    chunks = list((call_info or {}).get("audio_chunks") or [])
    if not chunks:
        return None

    ordered_chunks = sorted(
        chunks,
        key=lambda item: (
            float(item.get("captured_at") or 0.0),
            int(item.get("chunk_index") or 0),
        ),
    )
    target_rate = max(int((item or {}).get("sample_rate") or 16000) for item in ordered_chunks)
    first_at = float(ordered_chunks[0].get("captured_at") or 0.0)
    last_end_at = 0.0
    rendered = bytearray()

    for item in ordered_chunks:
        audio_bytes = bytes(item.get("audio") or b"")
        if not audio_bytes:
            continue
        num_channels = max(1, int(item.get("num_channels") or 1))
        if num_channels > 1:
            audio_bytes = audioop.tomono(audio_bytes, 2, 0.5, 0.5)
        sample_rate = max(1, int(item.get("sample_rate") or target_rate))
        pcm_bytes = _resample_pcm16(audio_bytes, input_rate=sample_rate, output_rate=target_rate)
        if not pcm_bytes:
            continue

        chunk_start_at = max(0.0, float(item.get("captured_at") or first_at) - first_at)
        if chunk_start_at > last_end_at:
            silence_gap = min(chunk_start_at - last_end_at, _max_render_gap_secs())
            silence_frames = int(silence_gap * target_rate)
            if silence_frames > 0:
                rendered.extend(b"\x00\x00" * silence_frames)

        rendered.extend(pcm_bytes)
        chunk_duration_secs = len(pcm_bytes) / float(target_rate * 2)
        if chunk_start_at > last_end_at:
            last_end_at = chunk_start_at + chunk_duration_secs
        else:
            last_end_at += chunk_duration_secs

    if not rendered:
        return None

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(target_rate)
        wav_file.writeframes(bytes(rendered))
    return buffer.getvalue()


def _wav_duration_seconds(wav_bytes: bytes | None) -> int | None:
    if not wav_bytes:
        return None
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            frame_rate = int(wav_file.getframerate() or 0)
            frame_count = int(wav_file.getnframes() or 0)
        if frame_rate <= 0:
            return None
        return max(0, int(frame_count / frame_rate))
    except Exception:
        return None


def _transcription_model() -> str:
    return "gemini-2.5-flash-lite"


def _normalize_transcript_payload(payload: object) -> list[dict[str, str]]:
    if not isinstance(payload, list):
        return []

    transcript: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker") or "").strip().lower()
        text = str(item.get("text") or "").strip()
        if speaker not in {"agent", "user"} or not text:
            continue
        if transcript and transcript[-1]["speaker"] == speaker:
            transcript[-1]["text"] = f"{transcript[-1]['text']} {text}".strip()
            continue
        transcript.append({"speaker": speaker, "text": text})
    return transcript


async def _transcribe_call_audio(call_info: Optional[dict], wav_bytes: bytes | None) -> list[dict[str, str]]:
    fallback_transcript = _build_structured_transcript(call_info)
    if not wav_bytes:
        return fallback_transcript

    api_key = config.setting("GEMINI_API_KEY")
    if not api_key:
        return fallback_transcript

    client = genai.Client(api_key=api_key)
    prompt = (
        "You are transcribing a phone-call recording that contains both sides of the conversation. "
        "Return only a JSON array. "
        "Each item must have exactly two keys: speaker and text. "
        'speaker must be either "agent" or "user". '
        "Keep turns in chronological order. "
        "Return all text only in Roman script (Latin letters). "
        "If the caller or agent speaks Hindi or another Indian language, transliterate it naturally into Roman letters. "
        "Do not use Devanagari or any other native script. "
        "Keep English words in normal English spelling. "
        "Do not include timestamps, markdown, explanations, or any extra keys. "
        "If the audio is silent or unintelligible, return []."
    )

    try:
        response = await client.aio.models.generate_content(
            model=_transcription_model(),
            contents=[
                prompt,
                genai_types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"),
            ],
            config=genai_types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=4096,
                response_mime_type="application/json",
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        raw_text = (getattr(response, "text", "") or "").strip()
        transcript = _normalize_transcript_payload(json.loads(raw_text or "[]"))
        return transcript or fallback_transcript
    except Exception as exc:
        logger.warning(
            f"Gemini transcript generation failed for {call_info.get('call_id') if call_info else 'unknown'}: {exc}"
        )
        await mark_call_failed(
            _get_call_id(call_info),
            end_reason="audio_transcription_failed",
            error_message=str(exc),
            state=call_info,
        )
        return fallback_transcript


async def _persist_call_audio(call_info: Optional[dict], *, wav_bytes: bytes | None = None) -> Optional[str]:
    if not call_info or call_info.get("audio_uploaded"):
        return (call_info or {}).get("audio_url")

    call_id = _get_call_id(call_info)
    if not call_id:
        return None

    wav_bytes = wav_bytes or _build_call_audio_wav(call_info)
    if not wav_bytes:
        return None
    audio_duration_seconds = _wav_duration_seconds(wav_bytes)
    if audio_duration_seconds is not None:
        call_info["audio_duration_seconds"] = audio_duration_seconds
        call_info["duration_seconds"] = audio_duration_seconds

    try:
        audio_url = await asyncio.to_thread(
            upload_call_wav,
            wav_bytes=wav_bytes,
            call_id=call_id,
        )
    except Exception as exc:
        logger.warning(f"Failed to upload call audio for {call_id}: {exc}")
        await mark_call_failed(
            call_id,
            end_reason="audio_upload_failed",
            error_message=str(exc),
            state=call_info,
        )
        return None

    try:
        db = get_db()
        await db.call_sessions.update_one(
            {"call_id": call_id},
            {
                "$set": {
                    "call_id": call_id,
                    "audio_url": audio_url,
                    "audio_saved_at": datetime.now(),
                    "duration_seconds": call_info.get("duration_seconds"),
                }
            },
            upsert=True,
        )
    except Exception as exc:
        logger.warning(f"Failed to persist call audio URL for {call_id}: {exc}")
        await mark_call_failed(
            call_id,
            end_reason="audio_url_persist_failed",
            error_message=str(exc),
            state=call_info,
        )
        return None

    call_info["audio_url"] = audio_url
    call_info["audio_uploaded"] = True
    call_info.pop("audio_chunks", None)
    return audio_url


async def _persist_audio_transcript(call_info: Optional[dict], *, wav_bytes: bytes | None = None) -> list[dict[str, str]]:
    if not call_info or call_info.get("audio_transcript_saved"):
        return (call_info or {}).get("transcript") or []

    call_id = _get_call_id(call_info)
    if not call_id:
        return []

    transcript = await _transcribe_call_audio(call_info, wav_bytes)

    if not await _persist_structured_transcript(
        call_id,
        transcript,
        error_context="Failed to persist audio transcript",
        call_info=call_info,
    ):
        return []

    call_info["transcript"] = transcript
    call_info["audio_transcript_saved"] = True
    return transcript


async def persist_call_artifacts(call_info: Optional[dict]):
    if not call_info:
        return
    task = call_info.get("artifact_persist_task")
    if task and not task.done():
        await task
        return

    async def _run():
        wav_bytes = _build_call_audio_wav(call_info)
        await _persist_final_transcript(call_info)
        await _persist_audio_transcript(call_info, wav_bytes=wav_bytes)
        await _persist_call_audio(call_info, wav_bytes=wav_bytes)

    task = asyncio.create_task(
        _run(),
        name=f"persist-call-artifacts:{call_info.get('call_id', 'unknown')}",
    )
    call_info["artifact_persist_task"] = task
    try:
        await task
    finally:
        if call_info.get("artifact_persist_task") is task and task.done():
            call_info.pop("artifact_persist_task", None)
