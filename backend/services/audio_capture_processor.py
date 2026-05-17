from __future__ import annotations

import inspect
from typing import Any, Callable

from pipecat.frames.frames import InputAudioRawFrame, OutputAudioRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


AudioChunkObserver = Callable[[bytes, int, int], Any]


async def _call_observer(callback: AudioChunkObserver | None, *args) -> None:
    if callback is None:
        return

    result = callback(*args)
    if inspect.isawaitable(result):
        await result


class _AudioCaptureProcessor(FrameProcessor):
    _frame_type = None

    def __init__(self, *, name: str, on_audio_chunk: AudioChunkObserver | None = None):
        super().__init__(name=name)
        self._on_audio_chunk = on_audio_chunk

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if self._frame_type is not None and isinstance(frame, self._frame_type) and getattr(frame, "audio", None):
            await _call_observer(
                self._on_audio_chunk,
                bytes(frame.audio),
                int(getattr(frame, "sample_rate", 0) or 0),
                int(getattr(frame, "num_channels", 1) or 1),
            )

        await self.push_frame(frame, direction)


class InputAudioCaptureProcessor(_AudioCaptureProcessor):
    _frame_type = InputAudioRawFrame

    def __init__(self, on_audio_chunk: AudioChunkObserver | None = None):
        super().__init__(name="InputAudioCaptureProcessor", on_audio_chunk=on_audio_chunk)


class OutputAudioCaptureProcessor(_AudioCaptureProcessor):
    _frame_type = OutputAudioRawFrame

    def __init__(self, on_audio_chunk: AudioChunkObserver | None = None):
        super().__init__(name="OutputAudioCaptureProcessor", on_audio_chunk=on_audio_chunk)
