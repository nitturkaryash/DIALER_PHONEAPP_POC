from __future__ import annotations

import io
import wave
from datetime import datetime, timezone
from functools import lru_cache
from hashlib import sha256

from google import genai
from google.genai import types as genai_types

from config import config
from db.mongo import get_db
from services.s3_service import upload_wav


_COLLECTION_NAME = "gemini_voice_previews"


@lru_cache(maxsize=1)
def _tts_model() -> str:
    return config.setting("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")


def _pcm16_to_wav(pcm_audio: bytes, *, sample_rate: int = 24000, num_channels: int = 1) -> bytes:
    with io.BytesIO() as wav_buffer:
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(num_channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_audio)
        return wav_buffer.getvalue()


def _normalize_text(text: str) -> str:
    return " ".join(str(text or "").split())


def _preview_id(*, voice_name: str, text: str) -> str:
    payload = f"{str(voice_name or '').strip().lower()}::{_normalize_text(text)}"
    return sha256(payload.encode("utf-8")).hexdigest()


def _collection():
    return get_db()[_COLLECTION_NAME]


async def list_voice_preview_entries() -> list[dict]:
    cursor = _collection().find({}, {"_id": 0}).sort("voice_name", 1)
    return await cursor.to_list(length=1000)


async def _get_voice_preview_entry(*, voice_name: str, text: str) -> dict | None:
    clean_voice = str(voice_name or "").strip()
    clean_text = _normalize_text(text)
    entry = await _collection().find_one({"voice_name": clean_voice, "text": clean_text}, {"_id": 0})
    return entry if isinstance(entry, dict) else None


async def _save_voice_preview_entry(*, voice_name: str, text: str, url: str, s3_key: str) -> dict:
    clean_voice = str(voice_name or "").strip()
    clean_text = _normalize_text(text)
    entry = {
        "id": _preview_id(voice_name=clean_voice, text=clean_text),
        "voice_name": clean_voice,
        "text": clean_text,
        "url": str(url).strip(),
        "s3_key": str(s3_key).strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await _collection().update_one(
        {"voice_name": clean_voice, "text": clean_text},
        {"$set": entry},
        upsert=True,
    )
    return entry


async def generate_voice_sample(*, voice_name: str, text: str) -> bytes:
    clean_voice = str(voice_name or "").strip()
    if not clean_voice:
        raise ValueError("voice_name is required.")

    clean_text = str(text or "").strip()
    if not clean_text:
        raise ValueError("text is required.")

    api_key = config.setting("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for Gemini voice samples.")

    client = genai.Client(api_key=api_key)
    response = await client.aio.models.generate_content(
        model=_tts_model(),
        contents=clean_text,
        config=genai_types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=genai_types.SpeechConfig(
                voice_config=genai_types.VoiceConfig(
                    prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                        voice_name=clean_voice,
                    )
                )
            ),
        ),
    )

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline_data = getattr(part, "inline_data", None)
            if inline_data is None:
                continue
            data = getattr(inline_data, "data", None)
            if isinstance(data, (bytes, bytearray)):
                return _pcm16_to_wav(bytes(data))
            if isinstance(data, str) and data:
                import base64

                return _pcm16_to_wav(base64.b64decode(data))

    raise RuntimeError("Gemini TTS returned no audio data.")


def _preview_s3_key(*, voice_name: str, text: str) -> str:
    prefix = "voice-previews"
    voice_slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in voice_name).strip("-") or "default"
    sample_hash = sha256(f"{voice_name}::{text}".encode("utf-8")).hexdigest()[:16]
    if prefix:
        return f"{prefix}/{voice_slug}/{sample_hash}.wav"
    return f"{voice_slug}/{sample_hash}.wav"


async def get_or_create_voice_sample_url(*, voice_name: str, text: str) -> dict:
    clean_voice = str(voice_name or "").strip()
    if not clean_voice:
        raise ValueError("voice_name is required.")

    clean_text = str(text or "").strip()
    if not clean_text:
        raise ValueError("text is required.")

    cached = await _get_voice_preview_entry(voice_name=clean_voice, text=clean_text)
    if cached and cached.get("url"):
        return {
            "voice_name": clean_voice,
            "text": clean_text,
            "audio_url": cached["url"],
            "cached": True,
            "s3_key": cached.get("s3_key"),
        }

    wav_bytes = await generate_voice_sample(voice_name=clean_voice, text=clean_text)
    s3_key = _preview_s3_key(voice_name=clean_voice, text=clean_text)
    audio_url = upload_wav(wav_bytes=wav_bytes, key=s3_key)
    await _save_voice_preview_entry(voice_name=clean_voice, text=clean_text, url=audio_url, s3_key=s3_key)
    return {
        "voice_name": clean_voice,
        "text": clean_text,
        "audio_url": audio_url,
        "cached": False,
        "s3_key": s3_key,
    }
