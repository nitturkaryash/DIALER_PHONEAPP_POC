"""Pipecat transport: RTP (PCMU/PCMA) to Issabel/Asterisk, resampled to pipeline rate."""

from __future__ import annotations

import asyncio
import random
import struct
import time
from typing import Optional

from loguru import logger

from config import config
from models.issabel import IssabelSipCallSession

try:
    import audioop
except ImportError:
    from utils import audioop_shim as audioop

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    CancelFrame,
    ClientConnectedFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    OutputAudioRawFrame,
    StartFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.transports.base_input import BaseInputTransport
from pipecat.transports.base_output import BaseOutputTransport
from pipecat.transports.base_transport import BaseTransport, TransportParams

from services.issabel_sip_signaling import issabel_send_bye


def _read_float_env(name: str, default: float) -> float:
    return config.float_setting(name, default)


def _read_int_env(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _unpack_rtp_header(data: bytes) -> Optional[tuple[int, int, int, bytes]]:
    if len(data) < 12:
        return None
    v = (data[0] >> 6) & 0x3
    if v != 2:
        return None
    pt = data[1] & 0x7F
    seq = int.from_bytes(data[2:4], "big")
    ts = int.from_bytes(data[4:8], "big")
    payload = data[12:]
    return pt, seq, ts, payload


def _pack_rtp(payload: bytes, *, seq: int, ts: int, ssrc: int, pt: int) -> bytes:
    header = bytearray(12)
    header[0] = 0x80
    header[1] = pt & 0x7F
    struct.pack_into("!H", header, 2, seq & 0xFFFF)
    struct.pack_into("!I", header, 4, ts & 0xFFFFFFFF)
    struct.pack_into("!I", header, 8, ssrc & 0xFFFFFFFF)
    return bytes(header) + payload


class IssabelRTPTransport(BaseTransport):
    """UDP RTP bidirectional audio (no LiveKit/WebSocket)."""

    def __init__(
        self,
        session: IssabelSipCallSession,
        params: TransportParams,
        *,
        name: Optional[str] = None,
    ):
        super().__init__(name=name)
        self._session = session
        self._input = IssabelRTPInputTransport(self, session, params, name=f"{name or 'issabel'}::input")
        self._output = IssabelRTPOutputTransport(self, session, params, name=f"{name or 'issabel'}::output")
        self._register_event_handler("on_client_connected")
        self._register_event_handler("on_client_disconnected")
        self._hangup_lock = asyncio.Lock()
        self._hangup_done = False

    def input(self) -> BaseInputTransport:
        return self._input

    def output(self) -> BaseOutputTransport:
        return self._output

    async def hangup(self) -> None:
        """Send SIP BYE and close RTP (idempotent)."""
        async with self._hangup_lock:
            if self._hangup_done:
                return
            self._hangup_done = True
        try:
            issabel_send_bye(self._session)
        except Exception as exc:
            logger.warning(f"Issabel BYE failed: {exc}")
        try:
            self._session.rtp_sock.close()
        except Exception:
            pass

    async def cleanup(self):
        await self.hangup()


class IssabelRTPInputTransport(BaseInputTransport):
    def __init__(
        self,
        transport: IssabelRTPTransport,
        session: IssabelSipCallSession,
        params: TransportParams,
        **kwargs,
    ):
        super().__init__(params, **kwargs)
        self._transport = transport
        self._session = session
        self._params = params
        self._recv_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._in_ratecv_state = None
        self._rtp_packets_in = 0
        self._rtp_payload_bytes_in = 0
        self._last_rtp_at: Optional[float] = None
        self._last_rtp_stats_log_at: float = 0.0
        self._last_rtp_idle_warn_at: float = 0.0
        self._log_rtp_stats = config.bool_setting("ISSABEL_LOG_RTP_STATS", True)
        self._idle_hangup_secs = max(5.0, _read_float_env("ISSABEL_RTP_IDLE_HANGUP_SECS", 20.0))
        self._idle_hangup_triggered = False

    async def start(self, frame: StartFrame):
        await super().start(frame)
        if self._initialized:
            return
        self._initialized = True
        await self._transport._call_event_handler("on_client_connected", self)
        await self.push_frame(ClientConnectedFrame())
        await self.set_transport_ready(frame)
        self._recv_task = self.create_task(self._recv_loop())

    async def _recv_loop(self):
        sock = self._session.rtp_sock
        pipeline_rate = self._params.audio_in_sample_rate or 16000
        sock.settimeout(1.0)
        while True:
            try:
                data = await asyncio.to_thread(sock.recvfrom, 2048)
            except TimeoutError:
                if self._log_rtp_stats and self._last_rtp_at is not None:
                    now = time.monotonic()
                    idle_secs = now - self._last_rtp_at
                    if idle_secs > 1.5 and (now - self._last_rtp_idle_warn_at) >= 2.0:
                        logger.warning(
                            f"Issabel RTP input idle after first packet: idle_ms={idle_secs * 1000.0:.0f}, "
                            f"packets={self._rtp_packets_in}, payload_bytes={self._rtp_payload_bytes_in}"
                        )
                        self._last_rtp_idle_warn_at = now
                    if idle_secs >= self._idle_hangup_secs and not self._idle_hangup_triggered:
                        self._idle_hangup_triggered = True
                        logger.warning(
                            f"Issabel RTP idle timeout reached ({idle_secs:.1f}s >= {self._idle_hangup_secs:.1f}s). "
                            "Ending telephony session."
                        )
                        await self.push_frame(EndFrame())
                        await self._transport.hangup()
                        break
                continue
            except OSError:
                break
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.debug(f"Issabel RTP recv error: {exc}")
                break
            pkt, _addr = data
            unpacked = _unpack_rtp_header(pkt)
            if not unpacked:
                continue
            pt, seq, ts, payload = unpacked
            if not payload:
                continue
            now = time.monotonic()
            if self._log_rtp_stats:
                if self._last_rtp_at is not None:
                    gap_ms = (now - self._last_rtp_at) * 1000.0
                    if gap_ms > 1500:
                        logger.warning(
                            f"Issabel RTP input gap detected: gap_ms={gap_ms:.0f}, "
                            f"packets={self._rtp_packets_in}, payload_bytes={self._rtp_payload_bytes_in}"
                        )
                self._last_rtp_at = now
                self._rtp_packets_in += 1
                self._rtp_payload_bytes_in += len(payload)
                if self._rtp_packets_in == 1:
                    self._last_rtp_stats_log_at = now
                elif (
                    self._rtp_packets_in % 50 == 0
                    or (now - self._last_rtp_stats_log_at) >= 2.0
                ):
                    self._last_rtp_stats_log_at = now
            try:
                if pt == 0:
                    pcm8 = audioop.ulaw2lin(payload, 2)
                elif pt == 8:
                    pcm8 = audioop.alaw2lin(payload, 2)
                else:
                    continue
            except Exception:
                continue
            if pipeline_rate == 8000:
                pcm8_up = pcm8
            else:
                pcm8_up, self._in_ratecv_state = audioop.ratecv(
                    pcm8, 2, 1, 8000, pipeline_rate, self._in_ratecv_state
                )

            # Apply gain to incoming telephony audio (often very quiet).
            # 2.0x gain is usually safe without clipping.
            try:
                gain = config.float_setting("TELEPHONY_AUDIO_IN_GAIN", 1.3)
                if gain != 1.0:
                    pcm8_up = audioop.mul(pcm8_up, 2, gain)
            except Exception:
                pass

            await self.push_audio_frame(
                InputAudioRawFrame(
                    audio=pcm8_up,
                    sample_rate=pipeline_rate,
                    num_channels=1,
                )
            )

    async def _stop_recv_task(self) -> None:
        if self._recv_task:
            await self.cancel_task(self._recv_task)
            self._recv_task = None

    async def stop(self, frame: EndFrame):
        await super().stop(frame)
        await self._stop_recv_task()
        await self._transport._call_event_handler("on_client_disconnected", self)
        await self._transport.hangup()

    async def cancel(self, frame: CancelFrame):
        await super().cancel(frame)
        await self._stop_recv_task()
        await self._transport.hangup()


class IssabelRTPOutputTransport(BaseOutputTransport):
    def __init__(
        self,
        transport: IssabelRTPTransport,
        session: IssabelSipCallSession,
        params: TransportParams,
        **kwargs,
    ):
        super().__init__(params, **kwargs)
        self._session = session
        self._initialized = False
        self._out_ratecv_state = None
        self._rtp_seq = random.randint(0, 0xFFFF)
        self._rtp_ts = random.randint(0, 0xFFFFFFFF)
        self._rtp_ssrc = random.randint(0, 0xFFFFFFFF)
        self._pending_pcm8 = bytearray()
        self._send_pt = 8 if session.use_pcma else 0
        self._partial_flush_task: Optional[asyncio.Task] = None
        self._partial_flush_ms = max(20, _read_int_env("ISSABEL_RTP_PARTIAL_FLUSH_MS", 60))

    async def start(self, frame: StartFrame):
        await super().start(frame)
        if self._initialized:
            return
        self._initialized = True
        await self.set_transport_ready(frame)

    async def stop(self, frame: EndFrame):
        await self._cancel_partial_flush_task()
        await self._flush_pending_audio()
        await super().stop(frame)

    async def cancel(self, frame: CancelFrame):
        await self._cancel_partial_flush_task()
        await super().cancel(frame)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            await self._cancel_partial_flush_task()
            self._pending_pcm8.clear()
        elif isinstance(frame, (BotStoppedSpeakingFrame, TTSStoppedFrame, EndFrame, CancelFrame)):
            await self._cancel_partial_flush_task()
            await self._flush_pending_audio()

    async def _send_pcm_packet(self, chunk: bytes) -> bool:
        sock = self._session.rtp_sock
        dest = (self._session.remote_rtp_host, self._session.remote_rtp_port)
        samples_per_packet = 160
        if self._send_pt == 8:
            payload = audioop.lin2alaw(chunk, 2)
        else:
            payload = audioop.lin2ulaw(chunk, 2)
        pkt = _pack_rtp(
            payload,
            seq=self._rtp_seq,
            ts=self._rtp_ts,
            ssrc=self._rtp_ssrc,
            pt=self._send_pt,
        )
        self._rtp_seq = (self._rtp_seq + 1) & 0xFFFF
        self._rtp_ts = (self._rtp_ts + samples_per_packet) & 0xFFFFFFFF
        try:
            sock.sendto(pkt, dest)
        except OSError as exc:
            if getattr(exc, "winerror", None) == 10038:
                return False
            logger.warning(f"Issabel RTP send failed: {exc}")
            return False
        await asyncio.sleep(0.02)
        return True

    async def _flush_pending_audio(self) -> bool:
        if not self._pending_pcm8:
            return True
        bytes_per_packet = 160 * 2
        if len(self._pending_pcm8) < bytes_per_packet:
            padded = bytes(self._pending_pcm8) + b"\x00" * (bytes_per_packet - len(self._pending_pcm8))
            self._pending_pcm8.clear()
            return await self._send_pcm_packet(padded)

        while len(self._pending_pcm8) >= bytes_per_packet:
            chunk = bytes(self._pending_pcm8[:bytes_per_packet])
            del self._pending_pcm8[:bytes_per_packet]
            if not await self._send_pcm_packet(chunk):
                return False
        if self._pending_pcm8:
            padded = bytes(self._pending_pcm8) + b"\x00" * (bytes_per_packet - len(self._pending_pcm8))
            self._pending_pcm8.clear()
            return await self._send_pcm_packet(padded)
        return True

    async def _cancel_partial_flush_task(self) -> None:
        task = self._partial_flush_task
        self._partial_flush_task = None
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _partial_flush_after_delay(self) -> None:
        try:
            await asyncio.sleep(self._partial_flush_ms / 1000.0)
            await self._flush_pending_audio()
        except asyncio.CancelledError:
            raise
        finally:
            if self._partial_flush_task is asyncio.current_task():
                self._partial_flush_task = None

    def _schedule_partial_flush(self) -> None:
        task = self._partial_flush_task
        if task and not task.done():
            task.cancel()
        self._partial_flush_task = self.create_task(self._partial_flush_after_delay())

    async def write_audio_frame(self, frame: OutputAudioRawFrame) -> bool:
        pcm = frame.audio
        if not pcm:
            return True
        if frame.sample_rate != 8000:
            pcm, self._out_ratecv_state = audioop.ratecv(
                pcm,
                2,
                1,
                frame.sample_rate,
                8000,
                self._out_ratecv_state,
            )
        self._pending_pcm8.extend(pcm)
        samples_per_packet = 160
        bytes_per_packet = samples_per_packet * 2
        while len(self._pending_pcm8) >= bytes_per_packet:
            chunk = bytes(self._pending_pcm8[:bytes_per_packet])
            del self._pending_pcm8[:bytes_per_packet]
            if not await self._send_pcm_packet(chunk):
                return False
        if self._pending_pcm8:
            self._schedule_partial_flush()
        else:
            await self._cancel_partial_flush_task()
        return True
