"""LLM context window management helpers."""

from loguru import logger
from pipecat.frames.frames import BotStoppedSpeakingFrame, Frame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class SlidingContextWindowProcessor(FrameProcessor):
    """Keep the system message plus the latest N user/assistant turn pairs."""

    def __init__(self, context: LLMContext, *, max_turns: int = 3):
        super().__init__(name="SlidingContextWindowProcessor")
        self._context = context
        self._max_history = max(1, max_turns) * 2

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, BotStoppedSpeakingFrame):
            messages = self._context.messages
            if len(messages) > 1:
                system_message = messages[0]
                history = messages[1:]
                if len(history) > self._max_history:
                    trimmed_history = history[-self._max_history :]
                    messages.clear()
                    messages.append(system_message)
                    messages.extend(trimmed_history)
                    logger.info(
                        "SlidingContextWindow trimmed history to "
                        f"{len(trimmed_history)}/{self._max_history} messages."
                    )

        await self.push_frame(frame, direction)
