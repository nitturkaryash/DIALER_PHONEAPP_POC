"""Voice Callback Booker MVP (Pipecat).

Website voice (WebRTC) agent that collects: name, phone, email, preferred time
and books a callback appointment on Google Calendar.

Based on Pipecat Quickstart runner pattern.
"""

import asyncio
import ast
import inspect
import io
import json
import re
import time
import wave
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, AsyncGenerator, Callable, Optional

import pytz
from loguru import logger
from google import genai
from google.genai import types as genai_types
from config import config, normalize_runtime_flag, runtime_flag_to_provider

from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.vad_analyzer import VADState
from pipecat.frames.frames import (
    Frame,
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    LLMRunFrame,
    TextFrame,
    TTSSpeakFrame,
    TranscriptionFrame,
    Language,
    ErrorFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.runner.types import LiveKitRunnerArguments, RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions as DeepgramLiveOptions
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import TransportParams
from pipecat.turns.user_start import TranscriptionUserTurnStartStrategy, VADUserTurnStartStrategy
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.utils.time import time_now_iso8601

from services.audio_capture_processor import InputAudioCaptureProcessor
from services.context_management_service import SlidingContextWindowProcessor

try:
    from pipecat.runner.types import WebSocketRunnerArguments  # type: ignore
except Exception:  # pragma: no cover
    WebSocketRunnerArguments = None  # type: ignore

try:
    from models.issabel import IssabelRunnerArguments
except Exception:  # pragma: no cover
    IssabelRunnerArguments = None  # type: ignore

# VAD model (optional). Silero requires PyTorch; if unavailable, we run without VAD.
try:
    from pipecat.audio.vad.silero import SileroVADAnalyzer  # type: ignore
except Exception:  # pragma: no cover
    SileroVADAnalyzer = None  # type: ignore


def _tz():
    return pytz.timezone(config.setting("TIMEZONE", "Asia/Calcutta"))


def _now_local():
    return datetime.now(tz=_tz())


_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

_WEEKDAYS = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}


_NUM_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
}


_COMPACT_SPEECH_WORDS = {
    "a",
    "address",
    "alright",
    "am",
    "and",
    "are",
    "at",
    "back",
    "book",
    "booked",
    "booking",
    "briefly",
    "by",
    "call",
    "callback",
    "can",
    "correct",
    "could",
    "day",
    "details",
    "email",
    "elgi",
    "evening",
    "facing",
    "first",
    "for",
    "from",
    "get",
    "give",
    "great",
    "have",
    "hello",
    "help",
    "hi",
    "i",
    "im",
    "i'm",
    "in",
    "issue",
    "is",
    "it",
    "like",
    "me",
    "meet",
    "my",
    "name",
    "need",
    "needs",
    "nice",
    "number",
    "of",
    "okay",
    "on",
    "our",
    "phone",
    "please",
    "pm",
    "provide",
    "ravi",
    "receive",
    "service",
    "share",
    "so",
    "speak",
    "speaking",
    "support",
    "tell",
    "that",
    "the",
    "them",
    "then",
    "this",
    "time",
    "to",
    "tomorrow",
    "today",
    "we",
    "well",
    "well",
    "what",
    "whats",
    "what's",
    "when",
    "who",
    "with",
    "would",
    "you",
    "your",
}


def _words_to_int(tokens: list[str]) -> int | None:
    """Convert simple spoken numbers to int.

    Supports: "twenty nine", "twenty ninth" (after stripping suffix), "ten", "thirty".
    """

    if not tokens:
        return None

    total = 0
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in _NUM_WORDS:
            val = _NUM_WORDS[t]
            # combine tens + ones
            if val in (20, 30, 40, 50, 60) and i + 1 < len(tokens) and tokens[i + 1] in _NUM_WORDS and _NUM_WORDS[tokens[i + 1]] < 10:
                total += val + _NUM_WORDS[tokens[i + 1]]
                i += 2
                continue
            total += val
            i += 1
            continue
        # digit tokens (e.g., "2026" or "29")
        if t.isdigit():
            return int(t)
        return None

    return total


def _is_vague_urgency_preferred_start(norm: str) -> bool:
    """True when the caller did not give a parseable clock time (ASAP / earliest / etc.)."""

    if not norm:
        return False
    if "not urgent" in norm or "not asap" in norm:
        return False
    phrases = (
        "as soon as possible",
        "as soon as you can",
        "asap",
        "soonest",
        "earliest convenience",
        "at your earliest convenience",
        "at the earliest",
        "earliest you can",
        "immediately",
        "right away",
        "right now",
        "first available",
        "whenever works",
        "whatever works",
        "whenever is fine",
        "anytime",
        "any time",
        "no preference",
        "doesnt matter",
        "does not matter",
        "dont care",
        "do not care",
        "soon as possible",  # common STT drop of "as"
    )
    for p in phrases:
        if p in norm:
            return True
    if norm in {"now", "asap", "soonest", "earliest"}:
        return True
    return False


def _next_asap_slot(*, duration_min: int | None = None) -> datetime:
    """Next concrete IST slot after now, aligned to 15 minutes, inside business hours."""

    duration = int(duration_min or config.setting("CALLBACK_DURATION_MIN", "15"))
    now = _now_local()
    dur = timedelta(minutes=duration)
    step = timedelta(minutes=15)
    for d in range(15):
        day0 = (now + timedelta(days=d)).replace(hour=0, minute=0, second=0, microsecond=0)
        ws, we = _business_hours_window(day0)
        if d == 0 and now > ws:
            minute = ((now.minute // 15) + 1) * 15
            t = now.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=minute)
            if t <= now:
                t += step
        else:
            t = ws
        while t + dur <= we:
            if t > now or d > 0:
                return t
            t += step
    return now + timedelta(hours=1)


def _parse_natural_datetime(
    text: str,
    *,
    default_year: int = 2026,
    duration_min: int | None = None,
    require_time: bool = True,
) -> datetime:
    """Parse natural language date/time in IST.

    Examples:
    - "28th feb 10 30 am"
    - "march 1 10 am"
    - "tomorrow 3 pm"
    - "today 22:30"
    - "february twenty ninth ten thirty am" (year defaulted)
    - "as soon as possible" / "ASAP" (next slot in business hours)

    Raises ValueError if not parseable or invalid date.
    """

    s = (text or "").strip().lower()
    s = re.sub(r"[,]+", " ", s)
    s = re.sub(r"\s+", " ", s)

    urgent_norm = re.sub(r"[^a-z0-9\s]", "", s)
    urgent_norm = re.sub(r"\s+", " ", urgent_norm).strip()
    if _is_vague_urgency_preferred_start(urgent_norm):
        return _next_asap_slot(duration_min=duration_min)

    now = _now_local()

    # Relative day
    day_base = None
    if "today" in s:
        day_base = now
    elif "tomorrow" in s:
        day_base = now + timedelta(days=1)

    # Normalize ordinal suffixes: 29th -> 29
    s = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", s)

    tokens = s.split()

    # Extract AM/PM
    ampm = None
    if "am" in tokens:
        ampm = "am"
        tokens = [t for t in tokens if t != "am"]
    if "pm" in tokens:
        ampm = "pm"
        tokens = [t for t in tokens if t != "pm"]

    # Extract month
    month = None
    month_idx = None
    for i, t in enumerate(tokens):
        if t in _MONTHS:
            month = _MONTHS[t]
            month_idx = i
            break

    year = None
    # If the user said a 4-digit year, use it
    for t in tokens:
        if re.fullmatch(r"(19|20)\d{2}", t):
            year = int(t)
            break

    if year is None:
        # If the user said "twenty twenty six" etc.
        joined = " ".join(tokens)
        if "twenty twenty six" in joined:
            year = 2026
        elif "twenty twenty five" in joined:
            year = 2025
        elif "twenty twenty four" in joined:
            year = 2024

    if year is None:
        year = default_year

    # Date
    weekday = None
    for t in tokens:
        if t in _WEEKDAYS:
            weekday = _WEEKDAYS[t]
            break

    if day_base is not None:
        y, m, d = day_base.year, day_base.month, day_base.day
    elif weekday is not None:
        # "Friday 4 PM" means the next occurrence of Friday.
        day_offset = (weekday - now.weekday()) % 7
        day_base = (now + timedelta(days=day_offset)).replace(hour=0, minute=0, second=0, microsecond=0)
        y, m, d = day_base.year, day_base.month, day_base.day
    else:
        if month is None:
            raise ValueError("No month found")
        # Day comes near month token (either before or after)
        day = None
        # Try token after month
        if month_idx is not None and month_idx + 1 < len(tokens):
            t = tokens[month_idx + 1]
            if t.isdigit():
                day = int(t)
            else:
                # maybe "twenty ninth" -> strip suffix then words
                t2 = re.sub(r"(st|nd|rd|th)$", "", t)
                day = _words_to_int([t2])
                if day is None and month_idx + 2 < len(tokens):
                    # "twenty nine"
                    day = _words_to_int([t2, tokens[month_idx + 2]])

        # Try token before month
        if day is None and month_idx is not None and month_idx - 1 >= 0:
            t = tokens[month_idx - 1]
            if t.isdigit():
                day = int(t)
            else:
                t2 = re.sub(r"(st|nd|rd|th)$", "", t)
                day = _words_to_int([t2])
                if day is None and month_idx - 2 >= 0:
                    day = _words_to_int([tokens[month_idx - 2], t2])

        if day is None:
            raise ValueError("No day found")

        y, m, d = year, month, day

    # Time
    hour = None
    minute = 0

    # Patterns like 22:30
    m_time = re.search(r"\b(\d{1,2}):(\d{2})\b", s)
    if m_time:
        hour = int(m_time.group(1))
        minute = int(m_time.group(2))
    else:
        # Look for sequences like "ten thirty" or "10 30" or "10"
        # We'll scan tokens for the first numeric/word number as hour
        for i, t in enumerate(tokens):
            t_clean = re.sub(r"(st|nd|rd|th)$", "", t)
            cand = int(t_clean) if t_clean.isdigit() else _words_to_int([t_clean])
            if cand is None:
                continue
            if 0 <= cand <= 24:
                hour = cand
                # minute candidate next
                if i + 1 < len(tokens):
                    t2 = re.sub(r"(st|nd|rd|th)$", "", tokens[i + 1])
                    cand2 = int(t2) if t2.isdigit() else _words_to_int([t2])
                    if cand2 is not None and 0 <= cand2 <= 59:
                        minute = cand2
                break

    if hour is None and not require_time:
        hour = 0
        minute = 0

    if hour is None:
        raise ValueError("No time found")

    # AM/PM handling
    if ampm == "pm" and 1 <= hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0

    dt = datetime(y, m, d, hour, minute)
    localized = _tz().localize(dt)
    if weekday is not None and localized <= now:
        localized = localized + timedelta(days=7)
    return localized


def _parse_rfc3339(dt: str) -> datetime:
    """Parse ISO datetime; assume local timezone if missing."""
    if dt.endswith("Z"):
        return datetime.fromisoformat(dt.replace("Z", "+00:00")).astimezone(_tz())
    try:
        parsed = datetime.fromisoformat(dt)
    except ValueError:
        m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$", dt.strip())
        if not m:
            raise
        parsed = datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}")

    if parsed.tzinfo is None:
        parsed = _tz().localize(parsed)
    else:
        parsed = parsed.astimezone(_tz())
    return parsed


def _business_hours_window(day: datetime):
    """Return the window of allowed booking times for the given day.

    For 24/7 operation, set BUSINESS_HOURS_START=0 and BUSINESS_HOURS_END=24.
    Note: hour=24 isn't valid on datetime, so end=24 maps to next day at 00:00.
    """

    start_h = config.int_setting("BUSINESS_HOURS_START", 0)
    end_h = config.int_setting("BUSINESS_HOURS_END", 24)

    start = day.replace(hour=start_h, minute=0, second=0, microsecond=0)

    if end_h == 24:
        end = (day + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        end = day.replace(hour=end_h, minute=0, second=0, microsecond=0)

    return start, end


_GLOBAL_TTS: SarvamTTSService | None = None


def _pdf_knowledge_ready(bot_config: Optional[dict]) -> bool:
    bc = bot_config or {}
    source = str(bc.get("knowledge_source") or "text").strip().lower()
    status = str(bc.get("knowledge_status") or "none").strip().lower()
    return source == "pdf_embedding" and status == "ready"


async def set_tts_language(params: FunctionCallParams, language_code: str):
    """Switch Sarvam TTS language during the call.

    Args:
        language_code: e.g. "hi-IN", "en-IN", or "kn-IN".
    """

    global _GLOBAL_TTS
    if _GLOBAL_TTS is None:
        await params.result_callback({"ok": False, "error": "TTS not initialized"})
        return

    code = (language_code or "").strip()
    if code not in {"hi-IN", "en-IN", "kn-IN"}:
        await params.result_callback({"ok": False, "error": "Unsupported language_code. Use hi-IN, en-IN, or kn-IN."})
        return

    # Update Sarvam config using the proper settings API.
    # _settings is a SarvamTTSSettings dataclass — never index it like a dict.
    # The correct field name is `language`, not `target_language_code`.
    # _update_settings() applies the delta and automatically re-sends the WS config.
    try:
        from pipecat.services.sarvam.tts import SarvamTTSSettings
        delta = SarvamTTSSettings(language=code)
        await _GLOBAL_TTS._update_settings(delta)  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning(f"set_tts_language failed: {exc}")
        await params.result_callback({"ok": False, "error": str(exc)})
        return

    try:
        from services.collected_params_context import get_collected_params_context

        ctx = get_collected_params_context() or {}
        bot_config = ctx.get("bot_config") if isinstance(ctx.get("bot_config"), dict) else {}
        if isinstance(bot_config, dict):
            bot_config["tts_language"] = code
            ctx["bot_config"] = bot_config

        llm_context = getattr(params, "context", None)
        if llm_context is not None:
            get_messages = getattr(llm_context, "get_messages", None)
            set_messages = getattr(llm_context, "set_messages", None)
            if callable(get_messages) and callable(set_messages):
                messages = list(get_messages() or [])
                updated_system_message = _compose_full_system_message(bot_config)
                system_message = {"role": "system", "content": updated_system_message}
                if messages and isinstance(messages[0], dict) and messages[0].get("role") == "system":
                    messages[0] = system_message
                else:
                    messages.insert(0, system_message)
                set_messages(messages)
    except Exception as exc:
        logger.warning(f"set_tts_language context refresh failed: {exc}")

    await params.result_callback({"ok": True, "language": code})


async def search_company_knowledge(
    params: FunctionCallParams,
    query: str = "",
    top_k: int = 4,
):
    """Retrieve top matching knowledge snippets for the current campaign or outbound session."""
    from services.collected_params_context import get_collected_params_context
    from services.knowledge_retrieval_service import (
        format_chunks_for_tool,
        search_knowledge_chunks,
        search_temporary_knowledge,
    )

    ctx = get_collected_params_context() or {}
    campaign_id = str(ctx.get("campaign_id") or "").strip()
    bot_config = ctx.get("bot_config") if isinstance(ctx.get("bot_config"), dict) else {}
    outbound_knowledge_token = str((bot_config or {}).get("outbound_knowledge_token") or "").strip()

    knowledge_ready = _pdf_knowledge_ready(bot_config)
    knowledge_source = str((bot_config or {}).get("knowledge_source") or "text").strip().lower()
    knowledge_status = str((bot_config or {}).get("knowledge_status") or "none").strip().lower()

    # Use DB as source-of-truth because per-call bot_config can be stale.
    # Example: PDF ingestion reaches "ready" after call metadata was already created.
    if not knowledge_ready and campaign_id:
        try:
            from db.mongo import get_db

            db = get_db()
            campaign_row = await db.campaigns.find_one(
                {"id": campaign_id},
                {"knowledge_source": 1, "knowledge_status": 1},
            )
            if isinstance(campaign_row, dict):
                knowledge_source = str(campaign_row.get("knowledge_source") or knowledge_source).strip().lower()
                knowledge_status = str(campaign_row.get("knowledge_status") or knowledge_status).strip().lower()
                knowledge_ready = (knowledge_source == "pdf_embedding" and knowledge_status == "ready")
        except Exception as exc:
            logger.warning(f"search_company_knowledge: failed to read campaign knowledge state ({campaign_id=}): {exc}")

    if not knowledge_ready:
        await params.result_callback(
            {
                "ok": False,
                "error": (
                    "Knowledge search is unavailable for this call right now "
                    f"(source={knowledge_source}, status={knowledge_status})."
                ),
            }
        )
        return

    clean_query = (query or "").strip()
    if not clean_query:
        await params.result_callback({"ok": False, "error": "query is required."})
        return

    try:
        k = max(1, min(8, int(top_k)))
    except Exception:
        k = 4

    timeout_secs = max(1.0, config.float_setting("KNOWLEDGE_SEARCH_TIMEOUT_SECS", 4.0))
    try:
        if outbound_knowledge_token:
            chunks = await asyncio.wait_for(
                search_temporary_knowledge(outbound_knowledge_token, clean_query, top_k=k),
                timeout=timeout_secs,
            )
        elif campaign_id:
            chunks = await asyncio.wait_for(
                search_knowledge_chunks(campaign_id, clean_query, top_k=k),
                timeout=timeout_secs,
            )
        else:
            chunks = []
    except Exception as exc:
        await params.result_callback({"ok": False, "error": f"Knowledge lookup failed: {exc}"})
        return

    if not chunks:
        await params.result_callback(
            {"ok": True, "count": 0, "snippets": "", "note": "No matching knowledge found."}
        )
        return

    await params.result_callback(
        {
            "ok": True,
            "count": len(chunks),
            "campaign_id": campaign_id or None,
            "snippets": format_chunks_for_tool(chunks),
        }
    )


def _tool_usage_rules_block() -> str:
    return (
        "Tool and conversation rules:\n"
        "- Speak in short, natural sentences; one question at a time.\n"
        "- Do not repeat the same question twice in a row unless the caller asks you to repeat.\n"
        "- NEVER echo the caller's last sentence verbatim.\n"
        "- Collect every configured field from the caller before calling `handle_extracted_parameters`.\n"
        "- When the caller asks about company policies, product facts, pricing, terms, or FAQs, call `search_company_knowledge` first and answer from its snippets.\n"
        "- `answers_json` must be a plain JSON object string only, with double-quoted keys and values. Do not wrap it in markdown, backticks, commentary, or prose.\n"
        "- Keys in `answers_json` must be exactly the field `key` values from the campaign; values should be strings (use digits for integers). If the campaign defines a datetime field, put the caller's date/time text in that field's value - do not use a separate tool argument for time.\n"
        "- For birthday, DOB, anniversary, or other historical date fields, capture the full date exactly as the caller says it, including the year when available. Do not invent or append a time unless the caller actually said one.\n"
        "- Example: {\"caller_name\":\"Ravi Kumar\",\"phone\":\"9876543210\",\"preferred_time\":\"tomorrow 3 pm\"}\n"
        "- If any required field is still missing or unclear, ask a follow-up question instead of guessing or calling the tool early.\n"
        "- If the user asks to switch languages (Hindi/English/Kannada), call `set_tts_language` with 'hi-IN', 'en-IN', or 'kn-IN'.\n"
        "- After `handle_extracted_parameters` succeeds, confirm what was saved, then ask if they would like to end the call; only end after they clearly agree to disconnect.\n\n"
    )


def _compose_field_list_section(bot_config: Optional[dict]) -> str:
    from services.collected_params_context import get_collected_params_context

    ctx = get_collected_params_context() or {}
    fields = _effective_collect_fields((bot_config or {}).get("collect_fields") or [], ctx)
    if not fields:
        return ""
    lines = ["You must collect these fields (use the field key in answers_json):"]
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        label = str(f.get("label") or key).strip()
        typ = str(f.get("type") or "text").strip()
        req = "required" if f.get("required", True) else "optional"
        if key:
            note = ""
            if typ == "datetime":
                if _is_schedule_datetime_field(f):
                    note = " Ask for the exact callback date and time."
                else:
                    note = " Ask for the full date exactly as spoken; include the year if the caller says it."
            lines.append(f"- [{key}] ({typ}, {req}): ask the caller for: {label}.{note}".rstrip("."))
    return "\n".join(lines) + "\n\n"


def _compose_effective_persona(bot_config: Optional[dict]) -> str:
    override = ((bot_config or {}).get("bot_system_prompt") or "").strip()
    if override:
        return override
    from services.system_prompt import load_system_prompt_text

    text = load_system_prompt_text().strip()
    if text:
        return text
    return _load_system_prompt_fallback()


def _load_system_prompt_fallback() -> str:
    return (
        "You are a voice agent for QualiaBits / CallPulse.\n"
        "Help the caller concisely and book or record their callback when appropriate.\n"
    )


def _language_instruction(bot_config: Optional[dict]) -> str:
    code = _campaign_tts_language(bot_config)
    if code == "hi-IN":
        return "Language rule: speak to the caller in Hindi unless they ask to switch languages.\n\n"
    if code == "kn-IN":
        return "Language rule: speak to the caller in Kannada unless they ask to switch languages.\n\n"
    if code == "en-IN":
        return "Language rule: speak to the caller in English unless they ask to switch languages.\n\n"
    return ""


def _language_instruction_for_code(language_code: str | None) -> str:
    code = (language_code or "").strip()
    if code == "hi-IN":
        return "Language rule: speak to the caller in Hindi unless they ask to switch languages.\n\n"
    if code == "kn-IN":
        return "Language rule: speak to the caller in Kannada unless they ask to switch languages.\n\n"
    if code == "en-IN":
        return "Language rule: speak to the caller in English unless they ask to switch languages.\n\n"
    return ""


def _compose_full_system_message(bot_config: Optional[dict]) -> str:
    knowledge = ((bot_config or {}).get("bot_knowledge") or "").strip()
    pdf_knowledge_ready = _pdf_knowledge_ready(bot_config)
    parts = [
        _tool_usage_rules_block(),
        _language_instruction(bot_config),
        _compose_effective_persona(bot_config),
        "\n",
        _compose_field_list_section(bot_config),
    ]
    if pdf_knowledge_ready:
        parts.append(
            "Knowledge mode: uploaded PDF knowledge is indexed via embeddings. "
            "Use `search_company_knowledge` for factual questions and do not invent missing facts.\n\n"
        )
    elif knowledge:
        parts.append("Reference knowledge (use when relevant, do not read verbatim as a list unless asked):\n")
        parts.append(knowledge[:12000])
        parts.append("\n\n")
    return "".join(parts).strip()


def _participant_flat_meta(pm: dict) -> dict:
    vc = pm.get("verification_context")
    if isinstance(vc, str):
        try:
            vc = json.loads(vc)
        except Exception:
            vc = {}
    if not isinstance(vc, dict):
        vc = {}
    out = {k: v for k, v in pm.items() if k != "verification_context"}
    out.update(vc)
    return out


def _apply_collected_params_context_from_flat_meta(meta: dict) -> None:
    from services.collected_params_context import set_collected_params_context

    flat = _participant_flat_meta(meta) if isinstance(meta, dict) else {}
    bc = flat.get("bot_config") or {}
    set_collected_params_context(
        {
            "user_id": flat.get("user_id"),
            "campaign_id": flat.get("campaign_id"),
            "campaign_contact_id": flat.get("campaign_contact_id"),
            "call_id": flat.get("call_id"),
            "customer_name": flat.get("customer_name"),
            "bot_config": bc if isinstance(bc, dict) else {},
        }
    )


def _validate_collected_value(field_type: str, raw: Any) -> Optional[str]:
    s = "" if raw is None else str(raw).strip()
    ft = (field_type or "text").lower()
    if ft == "text":
        return None if s else "value must be non-empty"
    if ft == "email":
        if not re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", s, re.I):
            return "invalid email"
        return None
    if ft == "phone":
        digits = re.sub(r"\D+", "", s)
        if len(digits) < 7:
            return "phone needs at least 7 digits"
        return None
    if ft == "integer":
        try:
            int(s.replace(",", "").strip())
        except Exception:
            return "integer required"
        return None
    if ft == "datetime":
        if not s:
            return "datetime string required"
        return None
    return None


def _normalize_field_identifier(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _field_matches_customer_name(field: dict[str, Any]) -> bool:
    key = _normalize_field_identifier(field.get("key"))
    label = _normalize_field_identifier(field.get("label"))
    candidates = {
        "name",
        "fullname",
        "customername",
        "callername",
        "username",
        "clientname",
        "contactname",
    }
    return key in candidates or label in candidates


def _prefilled_collect_answers(fields: list[dict], ctx: dict[str, Any] | None) -> dict[str, str]:
    prefilled: dict[str, str] = {}
    context = ctx or {}
    customer_name = str(context.get("customer_name") or "").strip()
    if not customer_name:
        return prefilled

    for field in fields:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key") or "").strip()
        if not key or not _field_matches_customer_name(field):
            continue
        prefilled[key] = customer_name
    return prefilled


def _effective_collect_fields(fields: list[dict], ctx: dict[str, Any] | None) -> list[dict]:
    prefilled = _prefilled_collect_answers(fields, ctx)
    if not prefilled:
        return fields
    return [
        field
        for field in fields
        if isinstance(field, dict) and str(field.get("key") or "").strip() not in prefilled
    ]


def _datetime_field_descriptor(field: dict) -> str:
    key = str(field.get("key") or "").strip().lower().replace("_", " ")
    label = str(field.get("label") or "").strip().lower()
    return f"{key} {label}".strip()


def _is_schedule_datetime_field(field: dict) -> bool:
    descriptor = _datetime_field_descriptor(field)
    schedule_markers = (
        "callback",
        "call during",
        "call time",
        "preferred time",
        "preferred slot",
        "schedule",
        "appointment",
        "meeting",
        "visit",
        "slot",
        "when to call",
        "time to call",
    )
    return any(marker in descriptor for marker in schedule_markers)


def _normalize_answer_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _extract_json_object_candidate(text: str) -> str:
    start = text.find("{")
    if start < 0:
        return text
    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]
    return text[start:]


def _parse_answers_payload(raw_answers: Any, fields: list[dict]) -> dict[str, Any]:
    if isinstance(raw_answers, dict):
        parsed = raw_answers
    else:
        text = str(raw_answers or "").strip()
        if not text:
            return {}
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
            text = re.sub(r"\s*```$", "", text)
        candidate = _extract_json_object_candidate(text).strip()
        parse_errors: list[str] = []
        parsed = None
        for parser in (
            lambda s: json.loads(s),
            lambda s: ast.literal_eval(s),
        ):
            try:
                parsed = parser(candidate)
                break
            except Exception as exc:
                parse_errors.append(str(exc))
        if not isinstance(parsed, dict):
            raise ValueError(parse_errors[-1] if parse_errors else "answers_json must decode to an object.")

    normalized_map: dict[str, str] = {}
    allowed_keys: list[str] = []
    for field in fields:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key") or "").strip()
        label = str(field.get("label") or "").strip()
        if not key:
            continue
        allowed_keys.append(key)
        normalized_map[_normalize_answer_key(key)] = key
        if label:
            normalized_map[_normalize_answer_key(label)] = key

    normalized_answers: dict[str, Any] = {}
    unknown_keys: list[str] = []
    for raw_key, raw_value in parsed.items():
        canonical_key = normalized_map.get(_normalize_answer_key(raw_key))
        if not canonical_key:
            unknown_keys.append(str(raw_key or "").strip())
            continue
        normalized_answers[canonical_key] = raw_value
    if unknown_keys:
        raise ValueError(
            "Unknown field(s): "
            + ", ".join(sorted(k for k in unknown_keys if k))
            + f". Allowed keys: {', '.join(sorted(allowed_keys))}"
        )
    return normalized_answers


def _normalize_answers_for_storage(fields: list[dict], answers: dict[str, Any]) -> dict[str, str]:
    stored: dict[str, str] = {}
    for field in fields:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key") or "").strip()
        if not key or key not in answers:
            continue
        value = answers.get(key)
        if value is None:
            continue
        stored[key] = str(value).strip()
    return stored


async def handle_extracted_parameters(
    params: FunctionCallParams,
    answers_json: str = "",
):
    """Validate collected answers and persist to MongoDB."""
    from services.call_failure_service import mark_call_failed
    from services.collected_params_context import get_collected_params_context
    from services.collected_params_service import persist_collected_parameters

    ctx = get_collected_params_context() or {}
    bot_config = ctx.get("bot_config") or {}
    fields = bot_config.get("collect_fields") or []

    if not fields:
        await params.result_callback(
            {
                "ok": False,
                "error": "Field collection is not configured for this call (missing collect_fields).",
            }
        )
        return

    try:
        answers = _parse_answers_payload(answers_json, fields)
    except Exception as exc:
        await params.result_callback(
            {"ok": False, "error": f"answers_json must be a JSON object string. Parse failed: {exc}"}
        )
        return
    answers = _normalize_answers_for_storage(fields, answers)
    prefilled_answers = _prefilled_collect_answers(fields, ctx)
    for key, value in prefilled_answers.items():
        answers.setdefault(key, value)

    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key:
            continue
        required = bool(f.get("required", True))
        typ = str(f.get("type") or "text").strip()
        if required:
            if key not in answers or str(answers.get(key)).strip() == "":
                await params.result_callback(
                    {"ok": False, "error": f"Missing required field: {key}"}
                )
                return
        if key in answers and str(answers.get(key)).strip() != "":
            err = _validate_collected_value(typ, answers.get(key))
            if err:
                await params.result_callback(
                    {"ok": False, "error": f"Invalid value for {key}: {err}"}
                )
                return

    duration_default = config.int_setting("CALLBACK_DURATION_MIN", 15)
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key or str(f.get("type") or "text").strip().lower() != "datetime":
            continue
        is_schedule_field = _is_schedule_datetime_field(f)
        raw = answers.get(key)
        if raw is None or str(raw).strip() == "":
            continue
        text = str(raw).strip()
        try:
            try:
                start = _parse_rfc3339(text)
            except Exception:
                start = _parse_natural_datetime(
                    text,
                    default_year=(2026 if is_schedule_field else _now_local().year),
                    duration_min=duration_default,
                    require_time=is_schedule_field,
                )
        except Exception:
            examples = (
                "'today 10:30 PM', 'tomorrow 3 PM', or ISO-8601."
                if is_schedule_field
                else "'7 January 2001', '7 Jan', '2001-01-07', or '7 January 2001 10:30 AM'."
            )
            await params.result_callback(
                {
                    "ok": False,
                    "error": f"Could not understand date/time for field {key}. Examples: {examples}",
                }
            )
            return
        if not is_schedule_field:
            if start.year < 1900 or start.year > _now_local().year + 1:
                await params.result_callback(
                    {
                        "ok": False,
                        "error": f"The date for {key} ({start.date()}) seems wrong. Please confirm with the caller.",
                    }
                )
                return
            continue

        now = _now_local()
        if start.year < now.year - 1 or start.year > now.year + 1:
            await params.result_callback(
                {
                    "ok": False,
                    "error": f"The date for {key} ({start.date()}) seems wrong. Please confirm with the caller.",
                }
            )
            return
        end = start + timedelta(minutes=duration_default)
        window_start, window_end = _business_hours_window(start)
        if not (window_start <= start and end <= window_end):
            await params.result_callback(
                {
                    "ok": False,
                    "error": f"Requested time for {key} is outside business hours.",
                }
            )
            return

    db_ok, db_err = await persist_collected_parameters(
        user_id=str(ctx.get("user_id") or "") or None,
        campaign_id=str(ctx.get("campaign_id") or "") or None,
        campaign_contact_id=str(ctx.get("campaign_contact_id") or "") or None,
        call_id=str(ctx.get("call_id") or "") or None,
        answers=answers,
    )

    if not db_ok:
        await mark_call_failed(
            str(ctx.get("call_id") or "") or None,
            end_reason="collected_params_save_failed",
            error_message=db_err,
        )
        await params.result_callback(
            {
                "ok": False,
                "error": db_err or "Could not save collected data to the database.",
                "dbLogged": False,
            }
        )
        return

    await params.result_callback(
        {
            "ok": True,
            "calendarBooked": False,
            "dbLogged": True,
            "eventId": None,
            "htmlLink": None,
        }
    )


def _sarvam_language_value(raw_code: str | None) -> Language | None:
    val = (raw_code or "").strip().lower().replace("_", "-").replace(" ", "")
    if not val:
        return None
    if val.startswith("hi") or "hindi" in val:
        return Language.HI
    if val.startswith("en") or "english" in val:
        return Language.EN
    if val.startswith("kn") or val.startswith("ka") or "kannada" in val or "kanada" in val:
        return Language.KN
    if val.startswith("ta") or "tamil" in val:
        return Language.TA
    if val.startswith("te") or "telugu" in val:
        return Language.TE
    if val.startswith("bn") or "bengali" in val or "bangla" in val:
        return Language.BN
    if val.startswith("mr") or "marathi" in val:
        return Language.MR
    if val.startswith("gu") or "gujarati" in val:
        return Language.GU
    if val.startswith("ml") or "malayalam" in val:
        return Language.ML
    if val.startswith("pa") or "punjabi" in val:
        return Language.PA
    if val.startswith("od") or val.startswith("or") or "odia" in val or "oriya" in val:
        return Language.OR
    if val.startswith("as") or "assamese" in val:
        return Language.AS
    return None


def _sarvam_language_from_env() -> Language:
    """Map SARVAM_LANG to Pipecat Language enum.

    Supports all major Indian languages:
    - Hindi (hi, hi-IN)
    - English (en, en-IN, english)
    - Kannada (kn, kn-IN, kannada)
    - Tamil (ta, ta-IN, tamil)
    - Telugu (te, te-IN, telugu)
    - Bengali (bn, bn-IN, bengali, bangla)
    - Marathi (mr, mr-IN, marathi)
    - Gujarati (gu, gu-IN, gujarati)
    - Malayalam (ml, ml-IN, malayalam)
    - Punjabi (pa, pa-IN, punjabi)
    - Odia (od, od-IN, odia, oriya)
    - Assamese (as, as-IN, assamese)

    Uses SARVAM_FALLBACK_LANG when SARVAM_LANG is missing/unknown.
    Defaults to English for broadest compatibility.
    """

    code = config.setting("SARVAM_LANG")
    lang = _sarvam_language_value(code)
    if lang is not None:
        return lang

    fallback = config.setting("SARVAM_FALLBACK_LANG", "en-IN")
    lang = _sarvam_language_value(fallback)
    if lang is not None:
        return lang

    # last-resort default to English for broad compatibility
    return Language.EN


def _initial_tts_language(runner_args: RunnerArguments) -> Language:
    meta = getattr(runner_args, "body", None) or {}
    if not isinstance(meta, dict):
        meta = {}
    bot_config = meta.get("bot_config") if isinstance(meta.get("bot_config"), dict) else {}
    override = _sarvam_language_value(bot_config.get("tts_language"))
    if override is not None:
        return override
    return _sarvam_language_from_env()


def _is_livekit_session(runner_args: RunnerArguments) -> bool:
    return isinstance(runner_args, LiveKitRunnerArguments)


def _is_websocket_session(runner_args: RunnerArguments) -> bool:
    return WebSocketRunnerArguments is not None and isinstance(runner_args, WebSocketRunnerArguments)


def _is_issabel_session(runner_args: RunnerArguments) -> bool:
    return IssabelRunnerArguments is not None and isinstance(runner_args, IssabelRunnerArguments)


def _is_narrowband_telephony(runner_args: RunnerArguments) -> bool:
    """Exotel WebSocket or Issabel RTP: telephony audio, not browser/LiveKit defaults."""
    return _is_websocket_session(runner_args) or _is_issabel_session(runner_args)


class BotSessionObserver:
    def __init__(
        self,
        *,
        on_participant_joined: Optional[Callable[[str, dict], Any]] = None,
        on_first_bot_audio: Optional[Callable[[], Any]] = None,
        on_first_user_audio: Optional[Callable[[], Any]] = None,
        on_user_audio_chunk: Optional[Callable[[bytes, int, int], Any]] = None,
        on_assistant_audio_chunk: Optional[Callable[[bytes, int, int], Any]] = None,
        on_assistant_audio_turn_complete: Optional[Callable[[], Any]] = None,
        on_session_end: Optional[Callable[[str], Any]] = None,
        on_session_error: Optional[Callable[[str], Any]] = None,
        on_user_transcript: Optional[Callable[[str], Any]] = None,
        on_assistant_text: Optional[Callable[[str], Any]] = None,
    ):
        self.on_participant_joined = on_participant_joined
        self.on_first_bot_audio = on_first_bot_audio
        self.on_first_user_audio = on_first_user_audio
        self.on_user_audio_chunk = on_user_audio_chunk
        self.on_assistant_audio_chunk = on_assistant_audio_chunk
        self.on_assistant_audio_turn_complete = on_assistant_audio_turn_complete
        self.on_session_end = on_session_end
        self.on_session_error = on_session_error
        self.on_user_transcript = on_user_transcript
        self.on_assistant_text = on_assistant_text


async def _call_observer(callback: Optional[Callable[..., Any]], *args):
    if not callback:
        return

    result = callback(*args)
    if inspect.isawaitable(result):
        await result


@dataclass
class FarewellTerminationState:
    requested: bool = False
    matched_text: str = ""
    end_dispatched: bool = False


_FAREWELL_CLOSING_TEXT = "Goodbye. Take care."
_FAREWELL_REGEX = re.compile(
    r"\b("
    r"good\s*bye|goodbye|bye\s*bye|bye|ok(?:ay)?\s+bye|"
    r"see\s+you|see\s+ya|talk\s+to\s+you\s+later|catch\s+you\s+later|take\s+care|"
    r"(?:that\s+is|thats?)\s+(?:all|it)|"
    r"all\s+set|all\s+good|"
    r"we(?:re| are)\s+done|"
    r"no\s+thanks?|no\s+thank\s+you|"
    r"not\s+now|not\s+needed|nothing\s+else"
    r")\b",
    re.I,
)


def _normalize_intent_text(text: str) -> str:
    cleaned = (text or "").lower()
    cleaned = re.sub(r"[^a-z0-9\s']", " ", cleaned)
    cleaned = cleaned.replace("'", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _looks_like_farewell(text: str) -> bool:
    normalized = _normalize_intent_text(text)
    if not normalized:
        return False

    # Keep the detector focused on short closing utterances.
    if len(normalized.split()) > 8:
        return False

    return bool(_FAREWELL_REGEX.search(normalized))


class FirstUserAudioProcessor(FrameProcessor):
    def __init__(self, on_first_user_audio: Optional[Callable[[], Any]] = None):
        super().__init__(name="FirstUserAudioProcessor")
        self._on_first_user_audio = on_first_user_audio
        self._seen_user_audio = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (
            not self._seen_user_audio
            and isinstance(frame, TranscriptionFrame)
            and (frame.text or "").strip()
        ):
            self._seen_user_audio = True
            await _call_observer(self._on_first_user_audio)
        await self.push_frame(frame, direction)


class FirstBotAudioProcessor(FrameProcessor):
    def __init__(self, on_first_bot_audio: Optional[Callable[[], Any]] = None):
        super().__init__(name="FirstBotAudioProcessor")
        self._on_first_bot_audio = on_first_bot_audio
        self._seen_bot_audio = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if not self._seen_bot_audio and isinstance(frame, BotStartedSpeakingFrame):
            self._seen_bot_audio = True
            await _call_observer(self._on_first_bot_audio)
        await self.push_frame(frame, direction)


class FarewellIntentProcessor(FrameProcessor):
    def __init__(self, state: FarewellTerminationState):
        super().__init__(name="FarewellIntentProcessor")
        self._state = state

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame)) and (
            self._state.requested or self._state.end_dispatched
        ):
            return

        if isinstance(frame, TranscriptionFrame):
            text = (frame.text or "").strip()
            if text and not self._state.requested and _looks_like_farewell(text):
                self._state.requested = True
                self._state.matched_text = text
                logger.info(f"Detected farewell intent: {text!r}")
                await self.push_frame(InterruptionFrame(), direction)
                await self.push_frame(TTSSpeakFrame(_FAREWELL_CLOSING_TEXT), direction)
                return

        await self.push_frame(frame, direction)


class FarewellEndProcessor(FrameProcessor):
    def __init__(
        self,
        state: FarewellTerminationState,
        on_session_end: Optional[Callable[[str], Any]] = None,
    ):
        super().__init__(name="FarewellEndProcessor")
        self._state = state
        self._on_session_end = on_session_end

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, BotStoppedSpeakingFrame) and self._state.requested and not self._state.end_dispatched:
            self._state.end_dispatched = True
            await self.push_frame(frame, direction)
            await _call_observer(self._on_session_end, self._state.matched_text or "farewell")
            await self.push_frame(EndFrame(), direction)
            return

        await self.push_frame(frame, direction)


class LLMErrorTerminationProcessor(FrameProcessor):
    """Terminate session quickly when upstream LLM emits an ErrorFrame."""

    def __init__(self, on_session_error: Optional[Callable[[str], Any]] = None):
        super().__init__(name="LLMErrorTerminationProcessor")
        self._on_session_error = on_session_error
        self._error_handled = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, ErrorFrame) and not self._error_handled:
            self._error_handled = True
            message = str(getattr(frame, "error", "llm_error"))
            logger.error(f"LLMErrorTerminationProcessor: terminating session due to error: {message}")
            await _call_observer(self._on_session_error, message)
            await self.push_frame(frame, direction)
            await self.push_frame(EndFrame(), direction)
            return

        await self.push_frame(frame, direction)


def _sanitize_tts_text(text: str) -> str:
    # Minimal cleanup - just remove markdown and normalize spaces
    cleaned = (text or "").strip()
    if not cleaned:
        return ""

    # Remove markdown code blocks
    cleaned = re.sub(r"```.*?```", " ", cleaned, flags=re.S)
    cleaned = cleaned.replace("`", "")

    # Convert markdown links to just text
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)

    # Remove URLs
    cleaned = re.sub(r"https?://\S+", " ", cleaned)

    # Normalize spaces only
    cleaned = re.sub(r"\s+", " ", cleaned)

    return cleaned.strip()


class TTSTextSanitizer(FrameProcessor):
    def __init__(self):
        super().__init__(name="TTSTextSanitizer")

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TextFrame):
            cleaned = _sanitize_tts_text(frame.text)
            if not cleaned:
                return
            frame = TextFrame(cleaned)
        await self.push_frame(frame, direction)


class STTTranscriptLogger(FrameProcessor):
    def __init__(self, *, log_interim: bool = False):
        super().__init__(name="STTTranscriptLogger")
        self._log_interim = log_interim

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            text = (frame.text or "").strip()
            if text:
                logger.info(
                    f"STT final transcript: text={text!r}, finalized={frame.finalized}, language={frame.language}"
                )
        elif self._log_interim and isinstance(frame, InterimTranscriptionFrame):
            text = (frame.text or "").strip()
            if text:
                logger.debug(f"STT interim transcript: text={text!r}, language={frame.language}")

        await self.push_frame(frame, direction)


class ConversationPersistenceProcessor(FrameProcessor):
    """Processor that handles persistence.
    If context is provided (LLM mode), it bulk-saves everything at the end for zero latency.
    If no context is provided (Scripted mode), it saves in real-time.
    """

    def __init__(
        self,
        context: Optional[LLMContext] = None,
        *,
        on_user_transcript: Optional[Callable[[str], Any]] = None,
        on_assistant_text: Optional[Callable[[str], Any]] = None,
    ):
        super().__init__(name="ConversationPersistenceProcessor")
        self._context = context
        self._on_user_transcript = on_user_transcript
        self._on_assistant_text = on_assistant_text

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if self._context:
            # BATCH MODE (LLM) - Save everything at the end
            if isinstance(frame, (EndFrame, ErrorFrame)):
                logger.info("Call ended (LLM). Grouping and persisting full history.")

                # Extract and merge turns
                clean_history: list[dict[str, str]] = []
                for msg in self._context.messages[1:]:
                    if isinstance(msg, dict):
                        role = msg.get("role", "unknown")
                        raw_content = msg.get("content")
                    else:
                        role = getattr(msg, "role", "unknown")
                        raw_content = getattr(msg, "content", None)

                    # Handle different content types in Pipecat context (Gemini uses lists)
                    if isinstance(raw_content, list):
                        content_parts = []
                        for p in raw_content:
                            if isinstance(p, dict):
                                content_parts.append(p.get("text", ""))
                            else:
                                content_parts.append(getattr(p, "text", ""))
                        content = " ".join(content_parts).strip()
                    else:
                        content = (raw_content or "").strip()

                    if not content or str(role) not in {"user", "assistant", "model"}:
                        continue

                    # Normalize roles (Gemini uses "model")
                    mapped_role = "assistant" if role in {"assistant", "model"} else "user"

                    if clean_history and clean_history[-1]["role"] == mapped_role:
                        # Deduplicate exact repeats (e.g. repeated greetings)
                        if clean_history[-1]["content"] == content:
                            continue
                        # Merge consecutive turns from same actor
                        clean_history[-1]["content"] += f" {content}"
                    else:
                        clean_history.append({"role": mapped_role, "content": content})

                # Persist merged history
                for entry in clean_history:
                    if entry["role"] == "user":
                        await _call_observer(self._on_user_transcript, entry["content"])
                    else:
                        await _call_observer(self._on_assistant_text, entry["content"])
        else:
            # REAL-TIME MODE (Scripted) - Save as we go
            if isinstance(frame, TranscriptionFrame):
                text = (frame.text or "").strip()
                if text: await _call_observer(self._on_user_transcript, text)
            elif isinstance(frame, TextFrame):
                text = (frame.text or "").strip()
                if text: await _call_observer(self._on_assistant_text, text)

        await self.push_frame(frame, direction)


class TelephonyTranscriptGuard(FrameProcessor):
    """Drop empty/duplicate telephony transcripts to avoid repeated user turns."""

    def __init__(self, *, dedupe_window_secs: float = 2.0):
        super().__init__(name="TelephonyTranscriptGuard")
        self._dedupe_window_secs = max(0.25, dedupe_window_secs)
        self._last_text: str = ""
        self._last_at: float = 0.0

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            text = (frame.text or "").strip()
            if not text:
                return

            now = time.monotonic()
            lowered = text.lower()
            if lowered == self._last_text and (now - self._last_at) <= self._dedupe_window_secs:
                logger.debug(f"Telephony transcript guard: dropping duplicate transcript {text!r}")
                return

            self._last_text = lowered
            self._last_at = now

        await self.push_frame(frame, direction)


class DeepgramTelephonySTTService(DeepgramSTTService):
    def __init__(self, *args, log_label: str = "telephony", **kwargs):
        super().__init__(*args, **kwargs)
        self._log_label = log_label
        self._logged_connect_kwargs = False
        self._logged_first_audio = False
        self._audio_chunk_count = 0
        self._audio_byte_count = 0
        self._warned_empty_final_after_audio = False

    def _build_connect_kwargs(self) -> dict:
        kwargs = super()._build_connect_kwargs()
        if not self._logged_connect_kwargs:
            logger.info(
                f"Deepgram {self._log_label} connect kwargs: "
                f"model={kwargs.get('model')}, language={kwargs.get('language')}, "
                f"encoding={kwargs.get('encoding')}, channels={kwargs.get('channels')}, "
                f"sample_rate={kwargs.get('sample_rate')}, endpointing={kwargs.get('endpointing')}"
            )
            self._logged_connect_kwargs = True
        return kwargs

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        self._audio_chunk_count += 1
        self._audio_byte_count += len(audio)
        if not self._logged_first_audio:
            logger.info(
                f"Deepgram {self._log_label}: first audio payload bytes={len(audio)}, sample_rate={self.sample_rate}"
            )
            self._logged_first_audio = True
        async for frame in super().run_stt(audio):
            yield frame

    async def _on_message(self, message):
        if type(message).__name__.endswith("Results"):
            channel = getattr(message, "channel", None)
            alternatives = getattr(channel, "alternatives", None) or []
            transcript = ""
            if alternatives:
                transcript = (getattr(alternatives[0], "transcript", "") or "").strip()
            is_final = bool(getattr(message, "is_final", None))
            speech_final = bool(getattr(message, "speech_final", None))
            if transcript:
                logger.debug(
                    f"Deepgram {self._log_label} result: "
                    f"type={type(message).__name__}, is_final={is_final}, "
                    f"speech_final={speech_final}, transcript={transcript!r}"
                )
            if transcript:
                self._warned_empty_final_after_audio = False
            elif (
                self._audio_chunk_count > 0
                and (is_final or speech_final)
                and not self._warned_empty_final_after_audio
            ):
                logger.warning(
                    f"Deepgram {self._log_label}: received audio "
                    f"(chunks={self._audio_chunk_count}, bytes={self._audio_byte_count}) "
                    "but produced an empty final transcript."
                )
                self._warned_empty_final_after_audio = True
        await super()._on_message(message)


class GeminiTelephonySTTProcessor(FrameProcessor):
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        language_hint: str,
        pre_roll_ms: int = 300,
        min_speech_ms: int = 220,
        max_segment_secs: float = 12.0,
        max_pending_segments: int = 1,
    ):
        super().__init__(name="GeminiTelephonySTTProcessor")

        if not SileroVADAnalyzer:
            raise RuntimeError("Gemini telephony STT requires Silero VAD support.")

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._language_hint = language_hint
        self._vad = SileroVADAnalyzer()
        self._pre_roll_ms = max(0, pre_roll_ms)
        self._min_speech_ms = max(100, min_speech_ms)
        self._max_segment_secs = max(2.0, max_segment_secs)
        self._max_pending_segments = max(1, max_pending_segments)

        self._sample_rate: Optional[int] = None
        self._num_channels = 1
        self._pre_roll_bytes = 0
        self._min_segment_bytes = 0
        self._max_segment_bytes = 0

        self._capturing = False
        self._speech_buffer = bytearray()
        self._pre_roll_buffer = bytearray()
        self._last_vad_state = VADState.QUIET
        self._pending_tasks: set[asyncio.Task] = set()
        self._segment_index = 0

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame):
            await self._handle_audio(frame)
        elif isinstance(frame, (EndFrame, CancelFrame)):
            await self._cancel_pending_tasks()

        await self.push_frame(frame, direction)

    async def _handle_audio(self, frame: InputAudioRawFrame):
        self._ensure_audio_config(frame)
        self._append_with_limit(self._pre_roll_buffer, frame.audio, self._pre_roll_bytes)

        vad_state = await self._vad.analyze_audio(frame.audio)
        started_capture = False

        if not self._capturing and vad_state in (VADState.STARTING, VADState.SPEAKING):
            self._capturing = True
            self._speech_buffer = bytearray(self._pre_roll_buffer)
            started_capture = True
            logger.debug("Gemini telephony STT: started capturing speech segment")

        if self._capturing and not started_capture:
            self._speech_buffer.extend(frame.audio)

        if self._capturing and len(self._speech_buffer) >= self._max_segment_bytes:
            logger.info("Gemini telephony STT: max segment size reached; transcribing partial audio")
            await self._submit_segment()
        elif self._capturing and vad_state == VADState.QUIET and self._last_vad_state != VADState.QUIET:
            await self._submit_segment()

        self._last_vad_state = vad_state

    def _ensure_audio_config(self, frame: InputAudioRawFrame):
        if self._sample_rate == frame.sample_rate and self._num_channels == frame.num_channels:
            return

        self._sample_rate = frame.sample_rate
        self._num_channels = frame.num_channels
        self._vad.set_sample_rate(frame.sample_rate)

        bytes_per_second = frame.sample_rate * frame.num_channels * 2
        self._pre_roll_bytes = int(bytes_per_second * (self._pre_roll_ms / 1000.0))
        self._min_segment_bytes = int(bytes_per_second * (self._min_speech_ms / 1000.0))
        self._max_segment_bytes = int(bytes_per_second * self._max_segment_secs)

    @staticmethod
    def _append_with_limit(buffer: bytearray, chunk: bytes, limit: int):
        if limit <= 0:
            return
        buffer.extend(chunk)
        if len(buffer) > limit:
            del buffer[:-limit]

    async def _submit_segment(self):
        segment = bytes(self._speech_buffer)
        self._speech_buffer.clear()
        self._capturing = False
        self._last_vad_state = VADState.QUIET

        if len(segment) < self._min_segment_bytes:
            logger.debug(
                f"Gemini telephony STT: dropped short speech segment ({len(segment)} bytes < {self._min_segment_bytes})"
            )
            return

        if len(self._pending_tasks) >= self._max_pending_segments:
            logger.debug(
                "Gemini telephony STT: throttling segment submission because previous "
                "transcriptions are still in-flight."
            )
            return

        self._segment_index += 1
        task = asyncio.create_task(
            self._transcribe_segment(segment, self._segment_index),
            name=f"gemini-stt-{self._segment_index}",
        )
        self._pending_tasks.add(task)
        task.add_done_callback(self._pending_tasks.discard)

    async def _transcribe_segment(self, pcm_audio: bytes, segment_index: int):
        if not self._sample_rate:
            return

        try:
            wav_audio = self._pcm_to_wav(
                pcm_audio,
                sample_rate=self._sample_rate,
                num_channels=self._num_channels,
            )
            prompt = (
                "Transcribe this caller audio from a phone call. "
                "Return only the spoken words. "
                "Do not add speaker labels, explanations, or extra formatting. "
                f"Language hint: {self._language_hint}. "
                "If the audio is silence or not understandable, return an empty string."
            )
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[
                    prompt,
                    genai_types.Part.from_bytes(data=wav_audio, mime_type="audio/wav"),
                ],
                config=genai_types.GenerateContentConfig(
                    temperature=0,
                    max_output_tokens=128,
                    response_mime_type="text/plain",
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                ),
            )
            transcript = self._normalize_transcript(getattr(response, "text", ""))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Gemini telephony STT failed for segment {segment_index}: {exc}")
            return

        if not transcript:
            logger.info(f"Gemini telephony STT produced no transcript for segment {segment_index}")
            return

        logger.info(f"Gemini final transcript: text={transcript!r}")
        await self.push_frame(
            TranscriptionFrame(
                transcript,
                "",
                time_now_iso8601(),
                finalized=True,
            ),
            FrameDirection.DOWNSTREAM,
        )

    @staticmethod
    def _normalize_transcript(text: str) -> str:
        cleaned = (text or "").strip()
        cleaned = re.sub(r"^\s*[\"'`]+|[\"'`]+\s*$", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        lowered = cleaned.lower()
        if lowered in {"", "silence", "[silence]", "inaudible", "[inaudible]", "(inaudible)"}:
            return ""
        return cleaned

    @staticmethod
    def _pcm_to_wav(pcm_audio: bytes, *, sample_rate: int, num_channels: int) -> bytes:
        with io.BytesIO() as wav_buffer:
            with wave.open(wav_buffer, "wb") as wav_file:
                wav_file.setnchannels(num_channels)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm_audio)
            return wav_buffer.getvalue()

    async def _cancel_pending_tasks(self):
        if not self._pending_tasks:
            return
        for task in list(self._pending_tasks):
            task.cancel()
        await asyncio.gather(*list(self._pending_tasks), return_exceptions=True)
        self._pending_tasks.clear()




def _select_stt_provider(runner_args: RunnerArguments) -> str:
    provider = config.setting("STT_PROVIDER").lower()
    if provider in {"deepgram", "gemini"}:
        return provider

    if _is_narrowband_telephony(runner_args):
        if config.setting("DEEPGRAM_API_KEY"):
            logger.info(
                "Using Deepgram STT for telephony session (default for reliability). "
                "Set STT_PROVIDER=gemini to force Gemini telephony STT."
            )
            return "deepgram"
        if config.setting("GEMINI_API_KEY"):
            logger.warning(
                "DEEPGRAM_API_KEY is not set for this telephony session. "
                "Falling back to Gemini telephony STT."
            )
            return "gemini"

    return "deepgram"


def _build_user_aggregator_params(
    runner_args: RunnerArguments,
    *,
    stt_provider: str,
) -> LLMUserAggregatorParams:
    vad = SileroVADAnalyzer() if SileroVADAnalyzer else None
    if _is_narrowband_telephony(runner_args):
        turn_mode = _telephony_turn_mode()
        if turn_mode == "pipecat":
            logger.info("Telephony session detected; using Pipecat default user turn handling.")
            return LLMUserAggregatorParams(vad_analyzer=vad)

    if _is_narrowband_telephony(runner_args) and stt_provider == "gemini":
        logger.info("WebSocket telephony session detected; using transcription-driven Gemini turn handling.")
        return LLMUserAggregatorParams(
            vad_analyzer=None,
            user_turn_strategies=UserTurnStrategies(
                start=[TranscriptionUserTurnStartStrategy(use_interim=False)],
                stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=0.35)],
            ),
        )

    # Exotel / Issabel: narrowband telephony audio.
    # The default Smart Turn analyzer is a poor fit here and can leave turns
    # hanging until the controller-level timeout fires. Keep local VAD so
    # Deepgram receives stop signals and can finalize transcripts, but replace
    # Smart Turn with a simple speech-timeout strategy.
        # In telephony, VAD-only starts can be noisy and trigger "user started"
        # events from line noise or echo before any transcript exists.
        # Default to transcription-driven start; use_interim=False avoids noise triggers.
        start_strategies = [TranscriptionUserTurnStartStrategy(use_interim=False)]
        if config.bool_setting("TELEPHONY_USE_VAD_START", False) and vad:
            start_strategies.insert(0, VADUserTurnStartStrategy())

        logger.info("WebSocket telephony session detected; using transcription-first speech-timeout turn handling. Disabling Silero VAD for better telephony compatibility.")
        return LLMUserAggregatorParams(
            vad_analyzer=None,  # Rely on Deepgram's internal VAD/endpointing for telephony.
            user_turn_strategies=UserTurnStrategies(
                start=start_strategies,
                stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=1.2)],
            ),
        )

    return LLMUserAggregatorParams(vad_analyzer=vad)


def _render_fixed_greeting(template: str, metadata: dict) -> str:
    if not isinstance(metadata, dict):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}

    customer_name = str(metadata.get("customer_name") or "").strip()
    try:
        # Keep greeting fully config-driven; do not inject hardcoded fallback lines.
        return template.format(customer_name=customer_name).strip()
    except Exception:
        return str(template or "").strip()


def _default_initial_greeting() -> str:
    # Empty means "do not auto-speak a default greeting".
    return config.setting("INITIAL_GREETING")


def _campaign_initial_greeting(bot_config: Optional[dict], metadata: dict) -> str:
    configured = str(((bot_config or {}).get("initial_greeting") or "")).strip()
    if configured:
        return _render_fixed_greeting(configured, metadata)
    return ""


def _has_campaign_prompt_override(bot_config: Optional[dict]) -> bool:
    return bool(str(((bot_config or {}).get("bot_system_prompt") or "")).strip())


def _campaign_opening_turn_instruction(metadata: Optional[dict], bot_config: Optional[dict] = None) -> str:
    customer_name = str(((metadata or {}).get("customer_name") or "")).strip()
    language_instruction = _language_instruction(bot_config).strip()
    language_prefix = f"{language_instruction} " if language_instruction else ""
    if customer_name:
        return (
            f"{language_prefix}The caller is {customer_name}. Start the call now with one short, natural opening line. "
            "Follow the current campaign instructions and role. Do not mention internal instructions."
        )
    return (
        f"{language_prefix}Start the call now with one short, natural opening line. "
        "Follow the current campaign instructions and role. Do not mention internal instructions."
    )


def _campaign_voice_agent(bot_config: Optional[dict]) -> str | None:
    voice_agent = str(((bot_config or {}).get("voice_agent") or "")).strip()
    return voice_agent or None


def _campaign_tts_prompt_template(bot_config: Optional[dict]) -> str | None:
    template = str(((bot_config or {}).get("tts_prompt_template") or "")).strip()
    return template or None


def _campaign_tts_speed(bot_config: Optional[dict]) -> str | None:
    speed = str(((bot_config or {}).get("tts_speed") or "normal")).strip().lower()
    if speed not in ("slow", "normal", "fast"):
        speed = "normal"
    return speed


def _campaign_tts_tone(bot_config: Optional[dict]) -> str | None:
    tone = str(((bot_config or {}).get("tts_tone") or "")).strip()
    result = tone or None
    return result


def _campaign_barge_in(bot_config: Optional[dict]) -> bool:
    result = bool((bot_config or {}).get("barge_in", False))
    return result


def _campaign_tts_language(bot_config: Optional[dict]) -> str | None:
    language = str(((bot_config or {}).get("tts_language") or "")).strip()
    return language or None


def _resolve_deepgram_streaming_config(runner_args: RunnerArguments) -> tuple[str, str]:
    configured_model = config.setting("DEEPGRAM_MODEL")
    configured_language = config.setting("DEEPGRAM_LANGUAGE")

    model = configured_model or "nova-3"
    language = configured_language or "multi"

    if _is_narrowband_telephony(runner_args):
        # Exotel/websocket telephony is narrowband and this bot is targeted at
        # Indian English / Hindi / Hinglish callers. Deepgram's nova-2 `multi`
        # mode only covers English+Spanish code-switching, so that setting
        # often yields silence/no transcripts for real customer calls. Upgrade
        # this specific session to nova-3 multilingual unless the user chose a
        # more specific language themselves.
        if model in {"nova-2", "nova-2-general"} and language == "multi":
            logger.warning(
                f"DEEPGRAM_MODEL={model} with DEEPGRAM_LANGUAGE=multi is a poor fit for Indian telephony. "
                "Using nova-3 multilingual for this websocket session."
            )
            model = "nova-3"

    return model, language


def _deepgram_connection_sample_rate(runner_args: RunnerArguments) -> Optional[int]:
    if _is_narrowband_telephony(runner_args):
        # Even though telephony is 8k, STT models often perform better at 16k.
        # We ensure the transport resamples 8k -> 16k correctly.
        return _env_int("ISSABEL_PIPELINE_SAMPLE_RATE", 16000)
    if _is_websocket_session(runner_args):
        return _env_int("EXOTEL_PIPELINE_SAMPLE_RATE", 8000)
    return _env_int("DEEPGRAM_SAMPLE_RATE", None)


def _env_int(name: str, default: int | None = None) -> int | None:
    if default is None:
        value = config.setting(name)
        if not value:
            return None
        try:
            return int(value)
        except Exception:
            return None
    return config.int_setting(name, default)


def _env_float(name: str, default: float | None = None) -> float | None:
    if default is None:
        value = config.setting(name)
        if not value:
            return None
        try:
            return float(value)
        except Exception:
            return None
    return config.float_setting(name, default)


def _env_bool(name: str, default: bool | None = None) -> bool | None:
    if default is None:
        value = config.setting(name)
        if not value:
            return None
        return value.strip().lower() in ("1", "true", "yes", "y", "on")
    return config.bool_setting(name, default)


def _pipecat_metrics_enabled() -> bool:
    return bool(_env_bool("PIPECAT_ENABLE_METRICS", False))


def _resolve_realtime_audio_provider(runner_args: RunnerArguments) -> str:
    meta = getattr(runner_args, "body", None) or {}
    if not isinstance(meta, dict):
        meta = {}

    bot_config = meta.get("bot_config") if isinstance(meta.get("bot_config"), dict) else {}
    candidate = normalize_runtime_flag(
        str(bot_config.get("runtime_flag") or bot_config.get("realtime_audio_provider") or "")
    )
    if candidate:
        return runtime_flag_to_provider(candidate)

    return config.realtime_audio_provider


def _telephony_turn_mode() -> str:
    value = config.setting("TELEPHONY_TURN_MODE", "legacy").lower()
    if value in {"default", "pipecat-default"}:
        return "pipecat"
    if value in {"legacy", "custom"}:
        return "legacy"
    return value or "pipecat"


def _clamp_int_env(name: str, value: int | None, *, minimum: int, maximum: int) -> int | None:
    if value is None:
        return None

    clamped = max(minimum, min(maximum, value))
    if clamped != value:
        logger.warning(
            f"{name}={value} is outside Sarvam's supported range ({minimum}-{maximum}). "
            f"Using {clamped} instead."
        )
    return clamped


def _normalize_sarvam_sample_rate(value: int | None) -> int | None:
    if value is None:
        return None

    supported = {8000, 16000, 22050, 24000}
    if value in supported:
        return value

    allowed = ", ".join(str(rate) for rate in sorted(supported))
    logger.warning(
        f"SARVAM_SAMPLE_RATE={value} is unsupported. Expected one of {allowed}. "
        "Falling back to Sarvam's model default sample rate."
    )
    return None


async def run_bot(
    transport,
    runner_args: RunnerArguments,
    *,
    session_observer: Optional[BotSessionObserver] = None,
    fixed_initial_greeting: Optional[str] = None,
):
    realtime_audio_provider = _resolve_realtime_audio_provider(runner_args)
    if realtime_audio_provider == "google_live":
        logger.info("Using Google Live audio-to-audio runtime.")
        await _run_gemini_live_bot_with_audio_capture(
            transport,
            runner_args,
            session_observer=session_observer,
            fixed_initial_greeting=fixed_initial_greeting,
        )
        return

    stt_provider = _select_stt_provider(runner_args)

    if stt_provider == "gemini":
        gemini_key = config.setting("GEMINI_API_KEY")
        if not gemini_key:
            raise RuntimeError("STT_PROVIDER=gemini requires GEMINI_API_KEY.")

        gemini_stt_model = config.setting("GEMINI_STT_MODEL", "gemini-3.1-flash-lite-preview")
        gemini_language_hint = (
            config.setting("GEMINI_STT_LANGUAGE_HINT", "Indian English, Hindi, or mixed Hinglish")
        ).strip()
        gemini_min_speech_ms = max(100, min(1200, _env_int("GEMINI_TELEPHONY_MIN_SPEECH_MS", 220) or 220))
        gemini_max_pending_segments = max(
            1, min(4, _env_int("GEMINI_TELEPHONY_MAX_PENDING_SEGMENTS", 1) or 1)
        )
        stt = GeminiTelephonySTTProcessor(
            api_key=gemini_key,
            model=gemini_stt_model,
            language_hint=gemini_language_hint,
            min_speech_ms=gemini_min_speech_ms,
            max_pending_segments=gemini_max_pending_segments,
        )
        logger.info(f"Using Gemini STT model: {gemini_stt_model}")
    else:
        deepgram_model, deepgram_language = _resolve_deepgram_streaming_config(runner_args)
        deepgram_sample_rate = _deepgram_connection_sample_rate(runner_args)
        # Default endpointing increased to 500ms for better conversational flow in Indian accents.
        deepgram_endpointing = 500
        if _is_narrowband_telephony(runner_args):
            deepgram_endpointing = _env_int("DEEPGRAM_TELEPHONY_ENDPOINTING", 500) or 500
        # Deepgram STT with multilingual support for Indian languages
        stt = DeepgramTelephonySTTService(
            api_key=config.setting("DEEPGRAM_API_KEY"),
            base_url=config.setting("DEEPGRAM_BASE_URL"),
            encoding="linear16",
            channels=1,
            sample_rate=deepgram_sample_rate,
            log_label=(
                "issabel"
                if _is_issabel_session(runner_args)
                else ("websocket" if _is_websocket_session(runner_args) else "default")
            ),
            live_options=DeepgramLiveOptions(
                model=deepgram_model,
                language=deepgram_language,
                interim_results=True,
                smart_format=True,
                endpointing=deepgram_endpointing,
                profanity_filter=False,
                numerals=True,  # Convert numbers to numeric form
            ),
        )
        logger.info(
            f"Using Deepgram STT config: model={deepgram_model}, language={deepgram_language}, "
            f"sample_rate={deepgram_sample_rate or 'pipeline-default'}, endpointing={deepgram_endpointing}"
        )

    # TTS: Sarvam only (Cartesia removed)
    sarvam_key = config.setting("SARVAM_API_KEY")
    if not sarvam_key:
        raise RuntimeError("Missing SARVAM_API_KEY. Set it in your .env")

    sarvam_model = config.setting("SARVAM_MODEL", "bulbul:v2")
    sarvam_voice = config.setting("SARVAM_SPEAKER", "shubh")
    sarvam_sample_rate = _normalize_sarvam_sample_rate(_env_int("SARVAM_SAMPLE_RATE", None))
    sarvam_params_kwargs = {"language": _initial_tts_language(runner_args)}
    # Slightly larger buffering reduces clipped or choppy telephony speech.
    v = _env_bool("SARVAM_ENABLE_PREPROCESSING", True)
    if v is not None:
        sarvam_params_kwargs["enable_preprocessing"] = v
    v = _clamp_int_env("SARVAM_MIN_BUFFER_SIZE", _env_int("SARVAM_MIN_BUFFER_SIZE", 80), minimum=30, maximum=200)
    if v is not None:
        sarvam_params_kwargs["min_buffer_size"] = v
    v = _clamp_int_env("SARVAM_MAX_CHUNK_LENGTH", _env_int("SARVAM_MAX_CHUNK_LENGTH", 220), minimum=50, maximum=500)
    if v is not None:
        sarvam_params_kwargs["max_chunk_length"] = v
    v = _env_float("SARVAM_PACE", None)
    if v is not None:
        sarvam_params_kwargs["pace"] = v
    v = _env_float("SARVAM_PITCH", None)
    if v is not None:
        sarvam_params_kwargs["pitch"] = v
    v = _env_float("SARVAM_LOUDNESS", None)
    if v is not None:
        sarvam_params_kwargs["loudness"] = v
    v = _env_float("SARVAM_TEMPERATURE", None)
    if v is not None:
        sarvam_params_kwargs["temperature"] = v

    logger.info(
        "Sarvam TTS config: "
        f"model={sarvam_model}, voice={sarvam_voice}, sample_rate={sarvam_sample_rate or 'provider-default'}, "
        f"language={sarvam_params_kwargs['language']}, "
        f"min_buffer_size={sarvam_params_kwargs.get('min_buffer_size', 'default')}, "
        f"max_chunk_length={sarvam_params_kwargs.get('max_chunk_length', 'default')}"
    )

    tts = SarvamTTSService(
        api_key=sarvam_key,
        voice_id=sarvam_voice,
        model=sarvam_model,
        sample_rate=sarvam_sample_rate,
        settings=SarvamTTSService.Settings(**sarvam_params_kwargs),
    )

    global _GLOBAL_TTS
    _GLOBAL_TTS = tts

    farewell_state = FarewellTerminationState()
    first_user_audio_processor = FirstUserAudioProcessor(
        session_observer.on_first_user_audio if session_observer else None
    )
    first_bot_audio_processor = FirstBotAudioProcessor(
        session_observer.on_first_bot_audio if session_observer else None
    )
    farewell_intent_processor = FarewellIntentProcessor(farewell_state)
    farewell_end_processor = FarewellEndProcessor(
        farewell_state,
        session_observer.on_session_end if session_observer else None,
    )
    llm_error_termination_processor = LLMErrorTerminationProcessor(
        session_observer.on_session_error if session_observer else None,
    )
    # (Persistence and Farewell moved down to after Context creation)
    use_scripted = (
        config.setting("USE_SCRIPTED_AGENT")
        or "0"
    ).strip().lower() in {"1", "true", "yes", "on"}

    if use_scripted:
        logger.info("Using scripted no-LLM agent (no Gemini/OpenAI calls)")
        agent = ScriptedBookingAgent(session_end_state=farewell_state)
        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                first_user_audio_processor,
                farewell_intent_processor,
                agent,
                TTSTextSanitizer(),
                tts,
                farewell_end_processor,
                first_bot_audio_processor,
                transport.output(),
            ]
        )
        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                enable_metrics=_pipecat_metrics_enabled(),
                enable_usage_metrics=_pipecat_metrics_enabled(),
            ),
        )

        if _is_livekit_session(runner_args):

            @transport.event_handler("on_first_participant_joined")
            async def on_first_participant_joined(transport, participant_id):
                logger.info(f"Participant connected (scripted): {participant_id}")
                # Send greeting when participant joins
                greeting = _default_initial_greeting()
                if greeting:
                    await task.queue_frames([
                        TTSSpeakFrame(greeting),
                    ])

            @transport.event_handler("on_participant_disconnected")
            async def on_participant_disconnected(transport, participant_id):
                logger.info(f"Participant disconnected (scripted): {participant_id}")
                if not transport.get_participants():
                    await task.cancel()

        else:

            @transport.event_handler("on_client_connected")
            async def on_client_connected(transport, client):
                logger.info("Client connected (scripted)")
                # Send greeting when client connects
                greeting = _default_initial_greeting()
                if greeting:
                    await task.queue_frames([
                        TTSSpeakFrame(greeting),
                    ])

            @transport.event_handler("on_client_disconnected")
            async def on_client_disconnected(transport, client):
                logger.info("Client disconnected (scripted)")
                await task.cancel()

        runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
        await runner.run(task)
        return

    # LLM agent - Priority: Gemini > Groq > OpenAI
    gemini_key = config.setting("GEMINI_API_KEY")
    gemini_model = config.setting("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
    groq_key = config.setting("GROQ_API_KEY")
    groq_model = config.setting("GROQ_MODEL", "llama-3.3-70b-versatile")

    if gemini_key:
        try:
            from pipecat.services.google.llm import GoogleLLMService
        except Exception as exc:
            logger.warning(
                f"GEMINI_API_KEY is set but Google LLM deps are missing ({exc}). "
                "Falling back to Groq/OpenAI. Install pipecat-ai[google] or google-api-core to enable Gemini."
            )
            gemini_key = ""

    if gemini_key:
        llm = GoogleLLMService(
            api_key=gemini_key,
            model=gemini_model,
            params=GoogleLLMService.InputParams(
                # Slightly higher cap helps avoid clipped or half-finished replies.
                max_tokens=96,
                temperature=0.3,
            ),
        )
        logger.info(f"Using Gemini LLM model: {gemini_model}")
    elif groq_key:
        llm = OpenAILLMService(
            api_key=groq_key,
            model=groq_model,
            base_url=config.setting("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            params=OpenAILLMService.InputParams(
                max_tokens=config.int_setting("LLM_MAX_TOKENS", 192),
                temperature=0.7,
                top_p=0.9,
            ),
        )
        logger.info(f"Using Groq LLM model: {groq_model}")
    else:
        openai_model = config.setting("OPENAI_MODEL", "gpt-4.1-mini")
        llm = OpenAILLMService(
            api_key=config.setting("OPENAI_API_KEY"),
            model=openai_model,
            params=OpenAILLMService.InputParams(
                max_tokens=config.int_setting("LLM_MAX_TOKENS", 192),
                temperature=0.2,
            ),
        )
        logger.info(f"Using OpenAI LLM model: {openai_model}")

    # Tool handlers use this to request a clean call end after a successful booking.
    setattr(llm, "_session_end_state", farewell_state)

    meta0 = getattr(runner_args, "body", None) or {}
    if not isinstance(meta0, dict):
        meta0 = {}
    _apply_collected_params_context_from_flat_meta(meta0)
    initial_bot_config = meta0.get("bot_config") if isinstance(meta0.get("bot_config"), dict) else {}
    logger.info(
        "Google Live prompt source: {}",
        "campaign override" if _has_campaign_prompt_override(initial_bot_config) else "server prompt file",
    )

    tools = ToolsSchema(
        standard_tools=[handle_extracted_parameters, set_tts_language, search_company_knowledge]
    )
    messages = [{"role": "system", "content": _compose_full_system_message(initial_bot_config)}]
    context = LLMContext(messages, tools=tools)

    conversation_persistence_processor = ConversationPersistenceProcessor(
        context=context,
        on_user_transcript=session_observer.on_user_transcript if session_observer else None,
        on_assistant_text=session_observer.on_assistant_text if session_observer else None,
    )

    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=_build_user_aggregator_params(runner_args, stt_provider=stt_provider),
    )

    llm.register_direct_function(handle_extracted_parameters, cancel_on_interruption=False)
    llm.register_direct_function(set_tts_language, cancel_on_interruption=False)
    llm.register_direct_function(search_company_knowledge, cancel_on_interruption=False)

    pipeline_steps = [transport.input(), stt]
    if _is_narrowband_telephony(runner_args):
        pipeline_steps.append(
            STTTranscriptLogger(log_interim=config.bool_setting("LOG_INTERIM_TRANSCRIPTS", False))
        )
        pipeline_steps.append(
            TelephonyTranscriptGuard(
                dedupe_window_secs=_env_float("TELEPHONY_TRANSCRIPT_DEDUPE_WINDOW_SECS", 2.0) or 2.0
            )
        )
    pipeline_steps.append(first_user_audio_processor)
    pipeline_steps.append(conversation_persistence_processor)
    pipeline_steps.append(farewell_intent_processor)
    # FIFO sliding window: keeps last N turn-pairs in LLM context.
    # Starts empty per-call. Configurable via BOT_CONTEXT_WINDOW_TURNS.
    _context_window_turns = max(1, _env_int("BOT_CONTEXT_WINDOW_TURNS", 5) or 5)
    sliding_window = SlidingContextWindowProcessor(context, max_turns=_context_window_turns)
    logger.info(f"SlidingContextWindow: max_turns={_context_window_turns} (max history msgs={_context_window_turns * 2})")

    pipeline_steps.extend(
        [
            user_agg,
            llm,
            llm_error_termination_processor,
            TTSTextSanitizer(),
            tts,
            farewell_end_processor,
            first_bot_audio_processor,
            transport.output(),
            assistant_agg,
            sliding_window,  # trim context AFTER assistant turn is fully added
        ]
    )

    pipeline = Pipeline(pipeline_steps)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=_pipecat_metrics_enabled(),
            enable_usage_metrics=_pipecat_metrics_enabled(),
        ),
    )

    async def _queue_greeting(greeting: str):
        greeting = str(greeting or "").strip()
        if not greeting:
            return
        # Add assistant greeting to context and send it.
        messages.append({"role": "assistant", "content": greeting})
        await task.queue_frames([TTSSpeakFrame(greeting)])

    async def _queue_initial_greeting():
        await _queue_greeting(_default_initial_greeting())

    if _is_livekit_session(runner_args):
        participant_metadata_cache: dict[str, dict] = {}

        async def _fetch_participant_metadata(participant_id: str) -> dict:
            cached = participant_metadata_cache.get(participant_id)
            if cached is not None:
                return cached

            try:
                raw_metadata = await transport.get_participant_metadata(participant_id)
            except Exception as exc:
                logger.warning(f"Failed to read participant metadata for {participant_id}: {exc}")
                raw_metadata = {}

            if not isinstance(raw_metadata, dict):
                try:
                    raw_metadata = json.loads(raw_metadata)
                except Exception:
                    raw_metadata = {}

            participant_metadata = {
                "identity": participant_id,
                "participant_identity": participant_id,
                **raw_metadata,
            }
            participant_metadata_cache[participant_id] = participant_metadata
            return participant_metadata

        async def _handle_livekit_participant(participant_id):
            participant_metadata = {
                "identity": participant_id,
                "participant_identity": participant_id,
            }
            await _call_observer(
                session_observer.on_participant_joined if session_observer else None,
                participant_id,
                participant_metadata,
            )
            participant_metadata = await _fetch_participant_metadata(participant_id)

            await _call_observer(
                session_observer.on_participant_joined if session_observer else None,
                participant_id,
                participant_metadata,
            )
            return participant_metadata

        @transport.event_handler("on_participant_connected")
        async def on_participant_connected(transport, participant_id):
            await _handle_livekit_participant(participant_id)

        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant_id):
            logger.info(f"Participant connected: {participant_id}")
            await _handle_livekit_participant(participant_id)
            pm = participant_metadata_cache.get(participant_id) or {}
            _apply_collected_params_context_from_flat_meta(pm)
            flat = _participant_flat_meta(pm)
            bc = flat.get("bot_config") if isinstance(flat.get("bot_config"), dict) else {}
            if messages:
                messages[0] = {
                    "role": "system",
                    "content": _compose_full_system_message(bc),
                }
            bridge._preferred_language = _campaign_tts_language(bc) or bridge._preferred_language
            campaign_greeting = _campaign_initial_greeting(bc, pm)
            if campaign_greeting:
                await _queue_greeting(campaign_greeting)
            elif fixed_initial_greeting:
                await _queue_greeting(_render_fixed_greeting(fixed_initial_greeting, pm))
            else:
                await _queue_initial_greeting()

        @transport.event_handler("on_participant_disconnected")
        async def on_participant_disconnected(transport, participant_id):
            logger.info(f"Participant disconnected: {participant_id}")
            if not transport.get_participants():
                await task.cancel()

    else:

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected")
            meta = getattr(runner_args, "body", None) or {}
            if not isinstance(meta, dict):
                meta = {}
            _apply_collected_params_context_from_flat_meta(meta)
            bc = meta.get("bot_config") if isinstance(meta.get("bot_config"), dict) else {}
            if messages:
                messages[0] = {"role": "system", "content": _compose_full_system_message(bc)}
            bridge._preferred_language = _campaign_tts_language(bc) or bridge._preferred_language
            has_campaign_prompt_override = bool(str((bc or {}).get("bot_system_prompt") or "").strip())
            campaign_greeting = _campaign_initial_greeting(bc, meta)
            if campaign_greeting:
                await _queue_greeting(campaign_greeting)
            elif has_campaign_prompt_override:
                # For campaign-specific prompt overrides (common in Issabel flows), let the
                # LLM generate the opening line from the campaign prompt instead of using
                # the fixed/static greeting template.
                await task.queue_frames([LLMRunFrame()])
            elif fixed_initial_greeting:
                await _queue_greeting(_render_fixed_greeting(fixed_initial_greeting, meta))
            else:
                await _queue_initial_greeting()

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected")
            await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    try:
        await runner.run(task)
    except Exception as exc:
        await _call_observer(
            session_observer.on_session_error if session_observer else None,
            str(exc),
        )
        raise


async def _run_gemini_live_bot_with_audio_capture(
    transport,
    runner_args: RunnerArguments,
    *,
    session_observer: Optional[BotSessionObserver] = None,
    fixed_initial_greeting: Optional[str] = None,
) -> None:
    from services.gemini_live_service import GeminiLiveBridgeProcessor

    gemini_key = config.setting("GEMINI_API_KEY")
    if not gemini_key:
        raise RuntimeError("RUNTIME_FLAG=google-live requires GEMINI_API_KEY.")

    model = config.setting("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
    meta0 = getattr(runner_args, "body", None) or {}
    if not isinstance(meta0, dict):
        meta0 = {}
    _apply_collected_params_context_from_flat_meta(meta0)
    initial_bot_config = meta0.get("bot_config") if isinstance(meta0.get("bot_config"), dict) else {}

    input_audio_capture = InputAudioCaptureProcessor(
        session_observer.on_user_audio_chunk if session_observer else None
    )
    task: PipelineTask | None = None

    async def _on_gemini_session_end(reason: str) -> None:
        await _call_observer(session_observer.on_session_end if session_observer else None, reason)
        await transport.hangup()
        if task is not None:
            await task.cancel()

    bridge = GeminiLiveBridgeProcessor(
        api_key=gemini_key,
        model=model,
        system_instruction=_compose_full_system_message(initial_bot_config),
        voice_name=_campaign_voice_agent(initial_bot_config),
        preferred_language=_campaign_tts_language(initial_bot_config),
        tts_prompt_template=_campaign_tts_prompt_template(initial_bot_config),
        tts_speed=_campaign_tts_speed(initial_bot_config),
        tts_tone=_campaign_tts_tone(initial_bot_config),
        barge_in=_campaign_barge_in(initial_bot_config),
        on_first_bot_audio=session_observer.on_first_bot_audio if session_observer else None,
        on_first_user_audio=session_observer.on_first_user_audio if session_observer else None,
        on_assistant_audio_chunk=session_observer.on_assistant_audio_chunk if session_observer else None,
        on_assistant_audio_turn_complete=session_observer.on_assistant_audio_turn_complete if session_observer else None,
        on_user_transcript=session_observer.on_user_transcript if session_observer else None,
        on_assistant_text=session_observer.on_assistant_text if session_observer else None,
        on_session_end=_on_gemini_session_end,
        on_session_error=session_observer.on_session_error if session_observer else None,
    )

    pipeline = Pipeline(
        [
            transport.input(),
            input_audio_capture,
            bridge,
            transport.output(),
        ]
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=_pipecat_metrics_enabled(),
            enable_usage_metrics=_pipecat_metrics_enabled(),
        ),
    )

    async def _queue_greeting(greeting: str) -> None:
        greeting = str(greeting or "").strip()
        if not greeting:
            return
        await task.queue_frames([TTSSpeakFrame(greeting)])

    async def _queue_initial_greeting() -> None:
        await _queue_greeting(_default_initial_greeting())

    if isinstance(runner_args, LiveKitRunnerArguments):
        participant_metadata_cache: dict[str, dict] = {}

        async def _fetch_participant_metadata(participant_id: str) -> dict:
            cached = participant_metadata_cache.get(participant_id)
            if cached is not None:
                return cached
            try:
                raw_metadata = await transport.get_participant_metadata(participant_id)
            except Exception as exc:
                logger.warning(f"Failed to read participant metadata for {participant_id}: {exc}")
                raw_metadata = {}
            if not isinstance(raw_metadata, dict):
                try:
                    raw_metadata = json.loads(raw_metadata)
                except Exception:
                    raw_metadata = {}
            participant_metadata = {
                "identity": participant_id,
                "participant_identity": participant_id,
                **raw_metadata,
            }
            participant_metadata_cache[participant_id] = participant_metadata
            return participant_metadata

        async def _handle_livekit_participant(participant_id: str) -> dict:
            participant_metadata = {
                "identity": participant_id,
                "participant_identity": participant_id,
            }
            await _call_observer(
                session_observer.on_participant_joined if session_observer else None,
                participant_id,
                participant_metadata,
            )
            participant_metadata = await _fetch_participant_metadata(participant_id)
            await _call_observer(
                session_observer.on_participant_joined if session_observer else None,
                participant_id,
                participant_metadata,
            )
            return participant_metadata

        @transport.event_handler("on_participant_connected")
        async def on_participant_connected(transport, participant_id):
            await _handle_livekit_participant(participant_id)

        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant_id):
            logger.info(f"Participant connected: {participant_id}")
            pm = await _handle_livekit_participant(participant_id)
            _apply_collected_params_context_from_flat_meta(pm)
            flat = _participant_flat_meta(pm)
            bot_config = flat.get("bot_config") if isinstance(flat.get("bot_config"), dict) else {}
            bridge._system_instruction = _compose_full_system_message(bot_config)
            bridge._voice_name = _campaign_voice_agent(bot_config)
            bridge._tts_prompt_template = _campaign_tts_prompt_template(bot_config)
            bridge._tts_speed = _campaign_tts_speed(bot_config)
            bridge._tts_tone = _campaign_tts_tone(bot_config)
            campaign_greeting = _campaign_initial_greeting(bot_config, pm)
            if campaign_greeting:
                await _queue_greeting(campaign_greeting)
            elif _has_campaign_prompt_override(bot_config):
                logger.info("Google Live opening turn will be generated from campaign prompt override.")
                await bridge.request_model_reply(_campaign_opening_turn_instruction(pm, bot_config))
            elif fixed_initial_greeting:
                await _queue_greeting(_render_fixed_greeting(fixed_initial_greeting, pm))
            else:
                await _queue_initial_greeting()

        @transport.event_handler("on_participant_disconnected")
        async def on_participant_disconnected(transport, participant_id):
            logger.info(f"Participant disconnected: {participant_id}")
            if not transport.get_participants():
                await task.cancel()

    else:

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected")
            campaign_greeting = _campaign_initial_greeting(initial_bot_config, meta0)
            if campaign_greeting:
                await _queue_greeting(campaign_greeting)
            elif _has_campaign_prompt_override(initial_bot_config):
                logger.info("Google Live opening turn will be generated from campaign prompt override.")
                await bridge.request_model_reply(_campaign_opening_turn_instruction(meta0, initial_bot_config))
            elif fixed_initial_greeting:
                await _queue_greeting(_render_fixed_greeting(fixed_initial_greeting, meta0))
            else:
                await _queue_initial_greeting()

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected")
            await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    try:
        await runner.run(task)
    finally:
        await bridge._close(reason="pipeline_end")


async def bot(runner_args: RunnerArguments):
    """Main entry point for pipecat runner."""
    transport_name = getattr(getattr(runner_args, "cli_args", None), "transport", None)
    if transport_name == "exotel":
        # Exotel WebSocket transport (handled externally by a FastAPI WS endpoint).
        if WebSocketRunnerArguments is None or not isinstance(runner_args, WebSocketRunnerArguments):
            raise RuntimeError("Exotel transport requires WebSocketRunnerArguments.")

        from services.exotel_transport_service import create_exotel_transport_from_websocket

        transport = await create_exotel_transport_from_websocket(runner_args.websocket)
        await run_bot(transport, runner_args)
        return

    transport_params = {
        # For local browser voice, use `--transport webrtc`
        "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
        "livekit": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    }

    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
