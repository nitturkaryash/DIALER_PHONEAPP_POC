from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable, Mapping
from typing import Any, Optional

from google import genai
from google.genai import types as genai_types
from loguru import logger
from config import config

try:
    import audioop
except Exception:  # pragma: no cover
    from utils import audioop_shim as audioop

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    OutputAudioRawFrame,
    StartFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.llm_service import FunctionCallParams


def _env_bool(name: str, default: bool = False) -> bool:
    return config.bool_setting(name, default)


def _env_int(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _env_str(name: str, default: str) -> str:
    return config.setting(name, default)


def _env_enum(enum_cls, name: str, default_name: str):
    raw = _env_str(name, default_name).upper()
    return getattr(enum_cls, raw, getattr(enum_cls, default_name))


def _pipecat_metrics_enabled() -> bool:
    return _env_bool("PIPECAT_ENABLE_METRICS", False)


def _gemini_live_behavior_suffix(speed: str = "normal", tone: str = "") -> str:
    speed_instruction = {
        "slow": "SPEAK VERY SLOWLY: Use a slow, measured pace. Pause briefly between sentences. Do not rush. Target: 75-100 words per minute.",
        "fast": "SPEAK QUICKLY: Use a fast, concise pace. Get to the point quickly. Target: 160-180 words per minute.",
    }.get(speed, "SPEAK AT NORMAL PACE: Use a natural, moderate speed similar to a phone support call. Target: 120-140 words per minute.")

    tone_instruction = ""
    if tone:
        tone_instruction = f"TONE: Adopt a {tone.lower()} speaking style - speak accordingly throughout the entire conversation.\n"

    return (
        f"\n\nVOICE STYLE (CRITICAL - FOLLOW EXACTLY):\n"
        f"- {speed_instruction}\n"
        f"- {tone_instruction}\n"
        f"- Speak clearly and naturally.\n"
        f"- Keep replies SHORT and DIRECT - 1-3 sentences max.\n"
        f"- Do NOT stop mid-sentence. Complete every thought fully.\n"
        f"- Do NOT use filler words (um, uh, like, you know).\n"
        f"- When caller speaks, STOP immediately and listen.\n"
        f"- End call only after saying goodbye and receiving a farewell.\n"
    )


def _resample_pcm16(audio_bytes: bytes, *, input_rate: int, output_rate: int) -> bytes:
    if not audio_bytes or input_rate == output_rate:
        return audio_bytes
    converted, _ = audioop.ratecv(audio_bytes, 2, 1, input_rate, output_rate, None)
    return converted


def _resolve_transcription_languages() -> list[str]:
    raw = config.setting("GEMINI_LIVE_TRANSCRIPTION_LANGUAGES")
    if raw:
        values = [item.strip() for item in raw.split(",") if item.strip()]
        if values:
            return values
    return []


def _language_label(language_code: str) -> str:
    if language_code == "hi-IN":
        return "Hindi"
    if language_code == "kn-IN":
        return "Kannada"
    return "English"


async def _call_observer(callback: Optional[Callable[..., Any]], *args) -> None:
    if not callback:
        return
    result = callback(*args)
    if inspect.isawaitable(result):
        await result


def _is_normal_close_error(exc: Exception) -> bool:
    message = str(exc)
    return (
        "sent 1000 (OK); then received 1000 (OK)" in message
        or "received 1000 (OK)" in message
        or "1000 None" in message
    )


class GeminiLiveBridgeProcessor(FrameProcessor):
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        system_instruction: str,
        voice_name: Optional[str] = None,
        preferred_language: Optional[str] = None,
        tts_prompt_template: Optional[str] = None,
        tts_speed: Optional[str] = None,
        tts_tone: Optional[str] = None,
        barge_in: bool = False,
        on_first_bot_audio: Optional[Callable[[], Any]] = None,
        on_first_user_audio: Optional[Callable[[], Any]] = None,
        on_assistant_audio_chunk: Optional[Callable[[bytes, int, int], Any]] = None,
        on_assistant_audio_turn_complete: Optional[Callable[[], Any]] = None,
        on_user_transcript: Optional[Callable[[str], Any]] = None,
        on_assistant_text: Optional[Callable[[str], Any]] = None,
        on_session_end: Optional[Callable[[str], Any]] = None,
        on_session_error: Optional[Callable[[str], Any]] = None,
    ):
        super().__init__()
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._system_instruction = system_instruction
        self._voice_name = (voice_name or "").strip() or None
        self._preferred_language = (preferred_language or "").strip() or (config.setting("SARVAM_LANG", "en-IN") or "en-IN")
        self._tts_prompt_template = (tts_prompt_template or "").strip() or None
        self._tts_speed = (tts_speed or "normal").strip().lower()
        self._tts_tone = (tts_tone or "").strip() or None
        self._barge_in = barge_in
        self._on_first_bot_audio = on_first_bot_audio
        self._on_first_user_audio = on_first_user_audio
        self._on_assistant_audio_chunk = on_assistant_audio_chunk
        self._on_assistant_audio_turn_complete = on_assistant_audio_turn_complete
        self._on_user_transcript = on_user_transcript
        self._on_assistant_text = on_assistant_text
        self._on_session_end = on_session_end
        self._on_session_error = on_session_error
        self._session_cm = None
        self._session = None
        self._receive_task: asyncio.Task | None = None
        self._connect_lock = asyncio.Lock()
        self._stopped = False
        self._gemini_input_rate = _env_int("GEMINI_LIVE_INPUT_SAMPLE_RATE", 16000)
        self._gemini_output_rate = _env_int("GEMINI_LIVE_OUTPUT_SAMPLE_RATE", 24000)
        self._transport_output_rate = self._gemini_output_rate
        self._transport_output_channels = 1
        self._seen_first_user_audio = False
        self._seen_first_bot_audio = False
        self._last_user_transcript = ""
        self._last_assistant_transcript = ""
        self._last_bot_audio_at = 0.0
        self._input_suppress_while_bot_ms = _env_int("GEMINI_LIVE_SUPPRESS_INPUT_WHILE_BOT_MS", 250)
        self._bot_turn_open = False
        self._bot_turn_complete = True
        self._release_after_turn_complete_ms = _env_int("GEMINI_LIVE_RELEASE_AFTER_TURN_COMPLETE_MS", 900)
        self._pending_end_call_reason: str | None = None
        self._pending_turn_complete_end_reason: str | None = None
        self._pending_close_after_audio_task: asyncio.Task | None = None
        self._close_after_bot_audio_silence_ms = _env_int("GEMINI_LIVE_CLOSE_AFTER_BOT_SILENCE_MS", 350)
        self._close_after_bot_audio_start_timeout_ms = _env_int("GEMINI_LIVE_CLOSE_AUDIO_START_TIMEOUT_MS", 5000)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            self._transport_output_rate = frame.audio_out_sample_rate or self._gemini_output_rate
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, InputAudioRawFrame):
            await self._handle_input_audio(frame)
            return

        if isinstance(frame, TTSSpeakFrame):
            await self._send_tts_prompt(frame.text)
            return

        if isinstance(frame, (EndFrame, CancelFrame)):
            await self._close(reason="session_end")
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)

    async def _connect(self) -> None:
        if self._session is not None:
            return
        if self._stopped:
            return

        async with self._connect_lock:
            if self._session is not None or self._stopped:
                return

            voice_name = self._voice_name or config.setting("GEMINI_LIVE_VOICE", "Aoede") or "Aoede"
            language_code = (self._preferred_language or config.setting("GEMINI_LIVE_LANGUAGE_CODE") or "en-IN").strip() or None
            transcription_languages = _resolve_transcription_languages()
            activity_handling = (
                genai_types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS
                if getattr(self, "_barge_in", False)
                else _env_enum(genai_types.ActivityHandling, "GEMINI_LIVE_ACTIVITY_HANDLING", "NO_INTERRUPTION")
            )
            turn_coverage = _env_enum(
                genai_types.TurnCoverage,
                "GEMINI_LIVE_TURN_COVERAGE",
                "TURN_INCLUDES_ONLY_ACTIVITY",
            )
            if getattr(self, "_barge_in", False):
                start_sensitivity = genai_types.StartSensitivity.START_SENSITIVITY_HIGH
                end_sensitivity = genai_types.EndSensitivity.END_SENSITIVITY_HIGH
            else:
                start_sensitivity = _env_enum(
                    genai_types.StartSensitivity,
                    "GEMINI_LIVE_START_SENSITIVITY",
                    "START_SENSITIVITY_LOW",
                )
                end_sensitivity = _env_enum(
                    genai_types.EndSensitivity,
                    "GEMINI_LIVE_END_SENSITIVITY",
                    "END_SENSITIVITY_LOW",
                )
            connect_config = genai_types.LiveConnectConfig(
                responseModalities=["AUDIO"],
                systemInstruction=f"{self._system_instruction.rstrip()}{_gemini_live_behavior_suffix(self._tts_speed, self._tts_tone)}",
                maxOutputTokens=_env_int("GEMINI_LIVE_MAX_OUTPUT_TOKENS", 96),
                tools=[self._build_tool_schema()],
                speechConfig=genai_types.SpeechConfig(
                    voiceConfig=genai_types.VoiceConfig(
                        prebuiltVoiceConfig=genai_types.PrebuiltVoiceConfig(voiceName=voice_name)
                    ),
                    languageCode=language_code,
                ),
                inputAudioTranscription=(
                    genai_types.AudioTranscriptionConfig(languageCodes=transcription_languages or None)
                    if _env_bool("GEMINI_LIVE_ENABLE_INPUT_TRANSCRIPTION", True)
                    else None
                ),
                outputAudioTranscription=(
                    genai_types.AudioTranscriptionConfig(languageCodes=transcription_languages or None)
                    if _env_bool("GEMINI_LIVE_ENABLE_OUTPUT_TRANSCRIPTION", True)
                    else None
                ),
                realtimeInputConfig=genai_types.RealtimeInputConfig(
                    automatic_activity_detection=genai_types.AutomaticActivityDetection(
                        disabled=False,
                        start_of_speech_sensitivity=start_sensitivity,
                        end_of_speech_sensitivity=end_sensitivity,
                        prefix_padding_ms=_env_int("GEMINI_LIVE_PREFIX_PADDING_MS", 80),
                        silence_duration_ms=_env_int("GEMINI_LIVE_SILENCE_DURATION_MS", 900),
                    ),
                    activity_handling=activity_handling,
                    turn_coverage=turn_coverage,
                ),
            )
            self._session_cm = self._client.aio.live.connect(model=self._model, config=connect_config)
            self._session = await self._session_cm.__aenter__()
            self._receive_task = asyncio.create_task(self._receive_loop(), name="gemini-live-receive")

    async def _handle_input_audio(self, frame: InputAudioRawFrame) -> None:
        if self._stopped:
            return
        if self._session is None:
            await self._connect()
        if self._stopped or self._session is None:
            return
        if self._bot_is_speaking() and not getattr(self, "_barge_in", False):
            return
        if not self._seen_first_user_audio:
            self._seen_first_user_audio = True
            await _call_observer(self._on_first_user_audio)
        payload = _resample_pcm16(
            frame.audio,
            input_rate=frame.sample_rate,
            output_rate=self._gemini_input_rate,
        )
        if not payload:
            return
        await self._send_realtime_input(
            audio=genai_types.Blob(
                data=payload,
                mime_type=f"audio/pcm;rate={self._gemini_input_rate}",
            )
        )

    def _bot_is_speaking(self) -> bool:
        if self._bot_turn_open:
            return True
        if not self._last_bot_audio_at:
            return False
        elapsed_ms = (time.monotonic() - self._last_bot_audio_at) * 1000
        if not self._bot_turn_complete:
            return elapsed_ms < self._input_suppress_while_bot_ms
        return elapsed_ms < self._release_after_turn_complete_ms

    async def _send_tts_prompt(self, text: str) -> None:
        clean = (text or "").strip()
        if not clean:
            return
        if self._stopped:
            return
        if self._session is None:
            await self._connect()
        if self._stopped or self._session is None:
            return
        if self._tts_prompt_template:
            template = self._tts_prompt_template
            prompt = template.replace("{text}", clean) if "{text}" in template else f"{template}\n{clean}"
        else:
            default_template = (
                "Say the following to the caller immediately in a clear phone-call style, preserving the meaning and key wording. "
                "If it is already written as spoken text, say it directly:\n{text}"
            )
            prompt = default_template.replace("{text}", clean) if "{text}" in default_template else f"{default_template}\n{clean}"
        await self._send_realtime_input(text=prompt)

    async def request_model_reply(self, instruction: str) -> None:
        clean = (instruction or "").strip()
        if not clean:
            return
        if self._stopped:
            return
        if self._session is None:
            await self._connect()
        if self._stopped or self._session is None:
            return
        await self._send_realtime_input(text=clean)

    async def _send_realtime_input(self, **kwargs) -> bool:
        if self._stopped or self._session is None:
            return False
        try:
            await self._session.send_realtime_input(**kwargs)
            return True
        except Exception as exc:
            if self._stopped or _is_normal_close_error(exc):
                return False
            raise

    async def _send_tool_response(self, *, function_responses: list[genai_types.FunctionResponse]) -> bool:
        if self._stopped or self._session is None:
            return False
        try:
            await self._session.send_tool_response(function_responses=function_responses)
            return True
        except Exception as exc:
            if self._stopped or _is_normal_close_error(exc):
                return False
            raise

    async def _receive_loop(self) -> None:
        try:
            while not self._stopped and self._session is not None:
                async for message in self._session.receive():
                    await self._handle_server_message(message)
                    if self._stopped:
                        return
        except Exception as exc:
            if self._stopped:
                return
            if _is_normal_close_error(exc):
                return
            logger.error(f"Gemini Live receive loop failed: {exc}")
            await _call_observer(self._on_session_error, str(exc))
            await self.push_frame(ErrorFrame(str(exc)))
            await self.push_frame(EndFrame(reason="gemini_live_error"))

    async def _handle_server_message(self, message: Any) -> None:
        if getattr(message, "go_away", None):
            reason = getattr(message.go_away, "time_left", None) or "gemini_live_go_away"
            await _call_observer(self._on_session_end, str(reason))
            self._stopped = True
            await self.push_frame(EndFrame(reason="gemini_live_go_away"))
            return

        if getattr(message, "tool_call", None):
            await self._handle_tool_call(message.tool_call)

        server_content = getattr(message, "server_content", None)
        if not server_content:
            return

        interrupted_val = getattr(server_content, "interrupted", None)
        turn_complete_val = getattr(server_content, "turn_complete", None)

        if interrupted_val is True:
            self._bot_turn_open = False
            self._bot_turn_complete = True
            await _call_observer(self._on_assistant_audio_turn_complete)
            await self.push_frame(InterruptionFrame(), direction=FrameDirection.DOWNSTREAM)
            return
        if turn_complete_val is True:
            self._bot_turn_open = False
            self._bot_turn_complete = True
            await _call_observer(self._on_assistant_audio_turn_complete)
            if self._pending_turn_complete_end_reason:
                reason = self._pending_turn_complete_end_reason
                self._pending_turn_complete_end_reason = None
                await self._close(reason=reason)
                await self.push_frame(EndFrame(reason=reason))
                return

        await self._maybe_emit_transcript(
            transcript=getattr(server_content, "input_transcription", None),
            actor="user",
        )
        await self._maybe_emit_transcript(
            transcript=getattr(server_content, "output_transcription", None),
            actor="assistant",
        )

        model_turn = getattr(server_content, "model_turn", None)
        if model_turn:
            for part in getattr(model_turn, "parts", []) or []:
                await self._handle_model_part(part)

    async def _handle_model_part(self, part: Any) -> None:
        inline_data = getattr(part, "inline_data", None)
        if inline_data is not None:
            mime_type = str(getattr(inline_data, "mime_type", "") or "").lower()
            if mime_type.startswith("audio/pcm"):
                raw = getattr(inline_data, "data", None) or b""
                if not isinstance(raw, (bytes, bytearray)):
                    return
                audio_bytes = _resample_pcm16(
                    bytes(raw),
                    input_rate=self._gemini_output_rate,
                    output_rate=self._transport_output_rate,
                )
                if not audio_bytes:
                    return
                if not self._seen_first_bot_audio:
                    self._seen_first_bot_audio = True
                    await _call_observer(self._on_first_bot_audio)
                await _call_observer(
                    self._on_assistant_audio_chunk,
                    bytes(raw),
                    self._gemini_output_rate,
                    self._transport_output_channels,
                )
                self._last_bot_audio_at = time.monotonic()
                self._bot_turn_open = True
                self._bot_turn_complete = False
                await self.push_frame(
                    OutputAudioRawFrame(
                        audio=audio_bytes,
                        sample_rate=self._transport_output_rate,
                        num_channels=self._transport_output_channels,
                    )
                )
                return

        text = str(getattr(part, "text", "") or "").strip()
        if text:
            await self._emit_assistant_text(text)

    async def _maybe_emit_transcript(self, *, transcript: Any, actor: str) -> None:
        if transcript is None:
            return
        text = str(getattr(transcript, "text", "") or "").strip()
        finished = bool(getattr(transcript, "finished", False))
        if not text or not finished:
            return
        if actor == "user":
            if text == self._last_user_transcript:
                return
            self._last_user_transcript = text
            await _call_observer(self._on_user_transcript, text)
            return
        if text == self._last_assistant_transcript:
            return
        self._last_assistant_transcript = text
        await _call_observer(self._on_assistant_text, text)

    async def _emit_assistant_text(self, text: str) -> None:
        if text == self._last_assistant_transcript:
            return
        self._last_assistant_transcript = text
        await _call_observer(self._on_assistant_text, text)

    def _schedule_close_after_audio(self, reason: str) -> None:
        task = self._pending_close_after_audio_task
        if task and not task.done():
            return

        async def _close_when_audio_finishes() -> None:
            start_deadline = time.monotonic() + max(0.5, self._close_after_bot_audio_start_timeout_ms / 1000.0)
            starting_audio_at = self._last_bot_audio_at

            # Wait for the closing audio to actually start.
            while not self._stopped and time.monotonic() < start_deadline:
                if self._last_bot_audio_at > starting_audio_at:
                    break
                await asyncio.sleep(0.05)

            # If no closing audio starts, let turn_complete/tool closure handle it.
            if self._last_bot_audio_at <= starting_audio_at:
                return

            silence_secs = max(0.15, self._close_after_bot_audio_silence_ms / 1000.0)
            while not self._stopped:
                if self._last_bot_audio_at and (time.monotonic() - self._last_bot_audio_at) >= silence_secs:
                    self._pending_turn_complete_end_reason = None
                    await self._close(reason=reason)
                    await self.push_frame(EndFrame(reason=reason))
                    return
                await asyncio.sleep(0.05)

        self._pending_close_after_audio_task = asyncio.create_task(
            _close_when_audio_finishes(),
            name="gemini-live-close-after-audio",
        )

    def _build_tool_schema(self) -> genai_types.Tool:
        return genai_types.Tool(
            function_declarations=[
                genai_types.FunctionDeclaration(
                    name="handle_extracted_parameters",
                    description="Validate and save the caller details collected during the call.",
                    parametersJsonSchema={
                        "type": "object",
                        "properties": {
                            "answers_json": {
                                "type": "string",
                                "description": "A plain JSON object encoded as a string, with double quotes only and no markdown. Example: {\"caller_name\":\"Ravi\",\"phone\":\"9876543210\"}",
                            }
                        },
                        "required": ["answers_json"],
                    },
                ),
                genai_types.FunctionDeclaration(
                    name="search_company_knowledge",
                    description="Search company knowledge snippets for factual questions.",
                    parametersJsonSchema={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "top_k": {"type": "integer", "minimum": 1, "maximum": 8},
                        },
                        "required": ["query"],
                    },
                ),
                genai_types.FunctionDeclaration(
                    name="set_tts_language",
                    description="Switch the response language for the current call.",
                    parametersJsonSchema={
                        "type": "object",
                        "properties": {
                            "language_code": {
                                "type": "string",
                                "enum": ["hi-IN", "en-IN", "kn-IN"],
                            }
                        },
                        "required": ["language_code"],
                    },
                ),
                genai_types.FunctionDeclaration(
                    name="end_call",
                    description="Disconnect the current phone call after the assistant has finished its closing line.",
                    parametersJsonSchema={
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Short reason for ending the call, such as farewell or task_completed.",
                            }
                        },
                    },
                ),
            ]
        )

    async def _handle_tool_call(self, tool_call: Any) -> None:
        function_calls = getattr(tool_call, "function_calls", None) or []
        if not function_calls:
            return

        responses: list[genai_types.FunctionResponse] = []
        for function_call in function_calls:
            name = str(getattr(function_call, "name", "") or "").strip()
            call_id = str(getattr(function_call, "id", "") or "").strip()
            arguments = getattr(function_call, "args", None)
            if not isinstance(arguments, Mapping):
                arguments = {}
            result = await self._execute_tool(name=name, call_id=call_id, arguments=dict(arguments))
            responses.append(
                genai_types.FunctionResponse(
                    id=call_id or None,
                    name=name,
                    response=result,
                )
            )
        sent = await self._send_tool_response(function_responses=responses)
        if not sent:
            return
        if self._pending_end_call_reason:
            reason = self._pending_end_call_reason
            self._pending_end_call_reason = None
            self._pending_turn_complete_end_reason = reason
            self._schedule_close_after_audio(reason)

    async def _execute_tool(self, *, name: str, call_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "set_tts_language":
            language_code = str(arguments.get("language_code") or "").strip()
            if language_code not in {"hi-IN", "en-IN", "kn-IN"}:
                return {"ok": False, "error": "Unsupported language_code. Use hi-IN, en-IN, or kn-IN."}
            self._preferred_language = language_code
            try:
                await self._send_realtime_input(
                    text=f"Language switch notice: reply only in {_language_label(language_code)} from now on."
                )
            except Exception as exc:
                logger.warning(f"Gemini Live language switch notice failed: {exc}")
            return {
                "ok": True,
                "language": language_code,
                "language_label": _language_label(language_code),
            }
        if name == "end_call":
            reason = str(arguments.get("reason") or "farewell").strip() or "farewell"
            self._pending_end_call_reason = reason
            return {"ok": True, "reason": reason}

        from services.callback_bot_service import handle_extracted_parameters, search_company_knowledge

        result_holder: dict[str, Any] = {}

        async def _result_callback(result: Any) -> None:
            if isinstance(result, dict):
                result_holder.update(result)
            else:
                result_holder["result"] = result

        params = FunctionCallParams(
            function_name=name,
            tool_call_id=call_id,
            arguments=arguments,
            llm=None,  # type: ignore[arg-type]
            context=None,  # type: ignore[arg-type]
            result_callback=_result_callback,
        )

        if name == "handle_extracted_parameters":
            await handle_extracted_parameters(params, answers_json=str(arguments.get("answers_json") or ""))
            return result_holder or {"ok": True}
        if name == "search_company_knowledge":
            top_k = arguments.get("top_k", 4)
            try:
                top_k = int(top_k)
            except Exception:
                top_k = 4
            await search_company_knowledge(
                params,
                query=str(arguments.get("query") or ""),
                top_k=top_k,
            )
            return result_holder or {"ok": True}

        return {"ok": False, "error": f"Unsupported tool: {name}"}

    async def _close(self, *, reason: str) -> None:
        was_stopped = self._stopped
        self._stopped = True
        task = self._pending_close_after_audio_task
        if task and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._pending_close_after_audio_task = None
        if self._receive_task and self._receive_task is not asyncio.current_task():
            self._receive_task.cancel()
            await asyncio.gather(self._receive_task, return_exceptions=True)
        self._receive_task = None
        if self._session_cm is not None:
            try:
                await self._session_cm.__aexit__(None, None, None)
            except Exception as exc:
                logger.warning(f"Gemini Live session close failed: {exc}")
        self._session = None
        self._session_cm = None
        if not was_stopped:
            await _call_observer(self._on_session_end, reason)
