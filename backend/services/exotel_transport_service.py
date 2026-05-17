"""Exotel websocket transport helpers."""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional

from fastapi import WebSocket
from loguru import logger
from models.exotel import ExotelStartInfo
from config import config

from pipecat.serializers.exotel import ExotelFrameSerializer

try:
    # Newer module path
    from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
except Exception:  # pragma: no cover - fallback for older pipecat versions
    from pipecat.transports.network.fastapi_websocket import (  # type: ignore
        FastAPIWebsocketTransport,
        FastAPIWebsocketParams,
    )


def decode_exotel_payload(payload_b64: str) -> bytes:
    """Decode base64 PCM payload from Exotel media message."""
    if not payload_b64:
        return b""
    return base64.b64decode(payload_b64)


def _now_ms() -> float:
    return time.time() * 1000.0


def _parse_sample_rate(value: Any, default: int = 8000) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _read_int_env(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _extract_stream_sid(message: dict[str, Any]) -> str:
    return (
        message.get("stream_sid")
        or (message.get("start") or {}).get("stream_sid")
        or (message.get("start") or {}).get("streamSid")
        or ""
    )


def _extract_call_sid(message: dict[str, Any]) -> Optional[str]:
    start = message.get("start") or {}
    return start.get("call_sid") or start.get("callSid")


def _extract_media_format(message: dict[str, Any]) -> dict[str, Any]:
    start = message.get("start") or {}
    return start.get("media_format") or start.get("mediaFormat") or {}


class LoggingExotelFrameSerializer(ExotelFrameSerializer):
    """Exotel serializer with minimal logging for chunk size and latency."""

    def __init__(
        self,
        stream_sid: str,
        call_sid: Optional[str],
        start_time_ms: float,
        exotel_sample_rate: int,
        pipeline_sample_rate: Optional[int],
    ):
        params = ExotelFrameSerializer.InputParams(
            exotel_sample_rate=exotel_sample_rate,
            sample_rate=pipeline_sample_rate,
        )
        super().__init__(stream_sid=stream_sid, call_sid=call_sid, params=params)
        self._start_time_ms = start_time_ms

    async def deserialize(self, data: str | bytes):
        try:
            text = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data
            message = json.loads(text)
            if message.get("event") == "media":
                media = message.get("media") or {}
                payload_b64 = media.get("payload") or ""
                payload = decode_exotel_payload(payload_b64)
                logger.debug(f"Exotel media rx bytes={len(payload)}")

                ts = media.get("timestamp")
                if ts is not None:
                    try:
                        latency_ms = _now_ms() - (self._start_time_ms + float(ts))
                        logger.debug(f"Exotel media rx latency_ms={int(latency_ms)}")
                    except Exception:
                        pass
        except Exception:
            # Keep deserialize robust; let base serializer handle errors.
            pass
        return await super().deserialize(data)

    async def serialize(self, frame):
        encoded = await super().serialize(frame)
        if encoded and isinstance(encoded, str):
            try:
                message = json.loads(encoded)
                if message.get("event") == "media":
                    payload_b64 = (message.get("media") or {}).get("payload") or ""
                    logger.debug(f"Exotel media tx bytes={len(decode_exotel_payload(payload_b64))}")
            except Exception:
                pass
        return encoded


async def _await_exotel_start(websocket: WebSocket) -> ExotelStartInfo:
    """Wait for Exotel connected/start and return stream metadata."""
    while True:
        raw = await websocket.receive_text()
        message = json.loads(raw)
        event = message.get("event")

        if event == "connected":
            continue

        if event == "start":
            stream_sid = _extract_stream_sid(message)
            if not stream_sid:
                raise RuntimeError("Exotel start message missing stream_sid")

            media_format = _extract_media_format(message)
            sample_rate = _parse_sample_rate(media_format.get("sample_rate"), default=8000)
            call_sid = _extract_call_sid(message)

            return ExotelStartInfo(
                stream_sid=stream_sid,
                call_sid=call_sid,
                sample_rate=sample_rate,
                raw_start=message,
                started_at_ms=_now_ms(),
            )

        if event == "stop":
            raise RuntimeError("Exotel stream stopped before start")


async def _build_exotel_transport(
    websocket: WebSocket,
    *,
    start_info: ExotelStartInfo,
    pipeline_sample_rate: int,
    audio_out_10ms_chunks: int,
) -> FastAPIWebsocketTransport:
    serializer = LoggingExotelFrameSerializer(
        stream_sid=start_info.stream_sid,
        call_sid=start_info.call_sid,
        start_time_ms=start_info.started_at_ms,
        exotel_sample_rate=start_info.sample_rate,
        pipeline_sample_rate=pipeline_sample_rate,
    )

    params = FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        audio_in_sample_rate=pipeline_sample_rate,
        audio_out_sample_rate=start_info.sample_rate,
        audio_out_10ms_chunks=audio_out_10ms_chunks,
        serializer=serializer,
    )

    return FastAPIWebsocketTransport(websocket, params=params)


async def create_exotel_transport_from_websocket(
    websocket: WebSocket,
    *,
    pipeline_sample_rate: Optional[int] = None,
    audio_out_10ms_chunks: Optional[int] = None,
) -> FastAPIWebsocketTransport:
    """Helper to create an Exotel transport directly from a WebSocket connection."""
    start_info = await _await_exotel_start(websocket)
    pipeline_sample_rate = pipeline_sample_rate or _read_int_env("EXOTEL_PIPELINE_SAMPLE_RATE", 8000)
    audio_out_10ms_chunks = audio_out_10ms_chunks or _read_int_env("EXOTEL_AUDIO_10MS_CHUNKS", 10)
    transport = await _build_exotel_transport(
        websocket,
        start_info=start_info,
        pipeline_sample_rate=pipeline_sample_rate,
        audio_out_10ms_chunks=audio_out_10ms_chunks,
    )
    setattr(transport, "exotel_start_info", start_info)
    return transport
