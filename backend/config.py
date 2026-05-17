from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
DEFAULT_SYSTEM_PROMPT_FILE = ROOT / "prompts" / "system.txt"
RUNTIME_FLAG_ENV_KEY = "RUNTIME_FLAG"

# Central env management lives here.
# How to use it:
# - Keep these env vars in `.env` because they do not have safe defaults here:
#   Secrets / credentials: DEEPGRAM_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY,
#     GROQ_API_KEY, SARVAM_API_KEY, CARTESIA_API_KEY, LIVEKIT_API_KEY,
#     LIVEKIT_API_SECRET, TELNYX_API_KEY, EXOTEL_API_KEY, EXOTEL_API_TOKEN,
#     EXOTEL_BASIC_USER, EXOTEL_BASIC_TOKEN, ISSABEL_SIP_PASSWORD, MONGO_URI,
#     JWT_SECRET, AUTH_DEFAULT_ADMIN_PASSWORD, AWS_ACCESS_KEY_ID,
#     AWS_SECRET_ACCESS_KEY
#   Optional env-only overrides: RUNTIME_FLAG, OUTBOUND_PROVIDER,
#     DEEPGRAM_BASE_URL, GEMINI_STT_MODEL, GEMINI_STT_LANGUAGE_HINT,
#     SARVAM_FALLBACK_LANG, GOOGLE_SHEET_ID, EXOTEL_APP_ID
# - Add new defaults to DEFAULTS.
# - Add fallback env names to ALIASES when older names still need to work.
# - In app code, use `config.setting(...)`, `config.int_setting(...)`, etc.
# - Avoid direct `os.getenv(...)` in service files so behavior stays consistent.
DEFAULTS: dict[str, str] = {
    "STT_PROVIDER": "deepgram",
    "REALTIME_AUDIO_PROVIDER": "google-live",
    "GEMINI_LIVE_FALLBACK_ENABLED": "1",
    "GEMINI_LIVE_MODEL": "gemini-3.1-flash-live-preview",
    "GEMINI_LIVE_VOICE": "Charon",
    "GEMINI_LIVE_LANGUAGE_CODE": "en-IN",
    "GEMINI_LIVE_INPUT_SAMPLE_RATE": "16000",
    "GEMINI_LIVE_OUTPUT_SAMPLE_RATE": "24000",
    "GEMINI_LIVE_MAX_OUTPUT_TOKENS": "500",
    "GEMINI_LIVE_SUPPRESS_INPUT_WHILE_BOT_MS": "600",
    "GEMINI_LIVE_RELEASE_AFTER_TURN_COMPLETE_MS": "900",
    "GEMINI_LIVE_ACTIVITY_HANDLING": "NO_INTERRUPTION",
    "GEMINI_LIVE_TURN_COVERAGE": "TURN_INCLUDES_ONLY_ACTIVITY",
    "GEMINI_LIVE_START_SENSITIVITY": "START_SENSITIVITY_LOW",
    "GEMINI_LIVE_END_SENSITIVITY": "END_SENSITIVITY_LOW",
    "GEMINI_LIVE_PREFIX_PADDING_MS": "80",
    "GEMINI_LIVE_SILENCE_DURATION_MS": "1400",
    "ISSABEL_RTP_PARTIAL_FLUSH_MS": "60",
    "DEEPGRAM_LANGUAGE": "en-IN",
    "DEEPGRAM_SAMPLE_RATE": "16000",
    "DEEPGRAM_TELEPHONY_ENDPOINTING": "80",
    "DEEPGRAM_MODEL": "nova-3",
    "TELEPHONY_TRANSCRIPT_DEDUPE_WINDOW_SECS": "2.0",
    "GEMINI_MODEL": "gemini-2.5-flash",
    "GOOGLE_CALENDAR_ID": "primary",
    "GOOGLE_APPLICATION_CREDENTIALS": "credentials/jarvis-api-service-account.json",
    "TIMEZONE": "Asia/Calcutta",
    "CALLBACK_DURATION_MIN": "15",
    "BUSINESS_HOURS_START": "0",
    "BUSINESS_HOURS_END": "24",
    "SYSTEM_PROMPT_FILE": "prompts/system.txt",
    "GOOGLE_SHEET_TAB": "Sheet1",
    "USE_SCRIPTED_AGENT": "0",
    "SARVAM_LANG": "en-IN",
    "SARVAM_SPEAKER": "shubh",
    "SARVAM_MODEL": "bulbul:v3",
    "LIVEKIT_URL": "wss://cp-j79z4c12.livekit.cloud",
    "TELNYX_OUTBOUND_NUMBER": "+18722548701",
    "TELNYX_SIP_CONNECTION_ID": "2921985702897911643",
    "WEBHOOK_URL": "https://brecken-strigose-damagingly.ngrok-free.dev",
    "TELNYX_CALL_CONTROL_APP_ID": "2922181126812337922",
    "LIVEKIT_SIP_TRUNK_ID": "ST_Ee2WbWtoPX8A",
    "LIVEKIT_SIP_OUTBOUND_NUMBER": "+18722548701",
    "EXOTEL_SID": "qulaiya1",
    "EXOTEL_CALLER_ID": "09513886363",
    "EXOTEL_FLOW_URL": "http://my.exotel.com/exoml/start/1215591",
    "EXOTEL_API_BASE_URL": "https://api.exotel.com",
    "ISSABEL_PIPELINE_SAMPLE_RATE": "16000",
    "EXOTEL_PIPELINE_SAMPLE_RATE": "8000",
    "EXOTEL_AUDIO_10MS_CHUNKS": "5",
    "ISSABEL_SIP_HOST": "172.16.1.240",
    "ISSABEL_SIP_PORT": "5060",
    "ISSABEL_SIP_USER": "8003",
    "ISSABEL_SIP_LOGIN": "8003",
    "ISSABEL_SIP_DOMAIN": "172.16.1.240",
    "ISSABEL_SIP_DIAL_PREFIX": "3680",
    "MONGO_DB_NAME": "voice_assistant",
    "JWT_ISSUER": "voice-assistant-api",
    "JWT_AUDIENCE": "voice-assistant-clients",
    "JWT_ACCESS_TTL_MINUTES": "60",
    "JWT_REFRESH_TTL_DAYS": "14",
    "AUTH_DEFAULT_ADMIN_EMAIL": "admin@example.com",
    "AUTH_PASSWORD_SALT": "voice-assistant-salt",
    "AWS_REGION": "eu-north-1",
    "AWS_HISTORY_REGION": "ap-south-1",
    "AWS_S3_HISTORY_BUCKET": "call-pulse-call-history",
    "AWS_S3_BUCKET": "callpulse-audio-bucket",
}

ALIASES: dict[str, tuple[str, ...]] = {
    "EXOTEL_API_KEY": ("EXOTEL_BASIC_USER",),
    "EXOTEL_API_TOKEN": ("EXOTEL_BASIC_TOKEN",),
    "USE_SCRIPTED_AGENT": ("USE_SCRIPTED", "SCRIPTED_MODE"),
}

def _read_env_pairs(env_file: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not env_file.exists():
        return data

    for raw_line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def _resolve_root_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def normalize_runtime_flag(value: str | None) -> str | None:
    if value is None:
        return None
    clean = str(value).strip().lower().replace("_", "-").replace(" ", "-")
    if not clean:
        return None
    if clean == "legacy":
        return "legacy"
    if clean in {"google-live", "gemini-live"}:
        return "google-live"
    return None


def runtime_flag_to_provider(flag: str) -> str:
    return "google_live" if flag == "google-live" else "legacy"


def _to_bool(value: str, default: bool) -> bool:
    clean = str(value or "").strip().lower()
    if not clean:
        return default
    if clean in {"1", "true", "yes", "on"}:
        return True
    if clean in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass
class AppConfig:
    env_file: Path = ENV_FILE
    _env_data: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    def reload(self) -> "AppConfig":
        load_dotenv(self.env_file, override=True)
        self._env_data = _read_env_pairs(self.env_file)
        return self

    def _ensure_loaded(self) -> None:
        if not self._env_data:
            self.reload()

    def _raw(self, key: str) -> str | None:
        self._ensure_loaded()

        value = os.getenv(key)
        if value is not None:
            return value.strip()

        for alias in ALIASES.get(key, ()):
            alias_value = os.getenv(alias)
            if alias_value is not None:
                return alias_value.strip()

        file_value = self._env_data.get(key)
        if file_value is not None:
            return file_value.strip()

        for alias in ALIASES.get(key, ()):
            alias_file_value = self._env_data.get(alias)
            if alias_file_value is not None:
                return alias_file_value.strip()

        return None

    def setting(self, key: str, default: str = "") -> str:
        value = self._raw(key)
        if value is not None and value != "":
            return value
        return DEFAULTS.get(key, default).strip()

    def optional_setting(self, key: str) -> str | None:
        return self._raw(key)

    def bool_setting(self, key: str, default: bool = False) -> bool:
        return _to_bool(self.setting(key), default)

    def int_setting(self, key: str, default: int) -> int:
        try:
            return int(self.setting(key, str(default)))
        except Exception:
            return default

    def float_setting(self, key: str, default: float) -> float:
        try:
            return float(self.setting(key, str(default)))
        except Exception:
            return default

    def list_setting(self, key: str, default: str = "", separator: str = ",") -> list[str]:
        value = self.setting(key, default)
        if not value:
            return []
        return [item.strip() for item in value.split(separator) if item.strip()]

    def path_setting(self, key: str, default: str = "") -> Path | None:
        value = self.setting(key, default)
        return _resolve_root_path(value) if value else None

    @property
    def runtime_flag(self) -> str:
        candidate = normalize_runtime_flag(self.optional_setting(RUNTIME_FLAG_ENV_KEY))
        if candidate:
            return candidate
        candidate = normalize_runtime_flag(self.optional_setting("REALTIME_AUDIO_PROVIDER"))
        return candidate or "legacy"

    @property
    def realtime_audio_provider(self) -> str:
        return runtime_flag_to_provider(self.runtime_flag)

    @property
    def outbound_provider(self) -> str:
        return self.setting("OUTBOUND_PROVIDER", "auto").lower()

    @property
    def timezone(self) -> str:
        return self.setting("TIMEZONE", "Asia/Calcutta")

    @property
    def system_prompt_path(self) -> Path:
        return self.path_setting("SYSTEM_PROMPT_FILE") or DEFAULT_SYSTEM_PROMPT_FILE


config = AppConfig()


__all__ = [
    "ALIASES",
    "DEFAULTS",
    "DEFAULT_SYSTEM_PROMPT_FILE",
    "ENV_FILE",
    "ROOT",
    "RUNTIME_FLAG_ENV_KEY",
    "AppConfig",
    "config",
    "normalize_runtime_flag",
    "runtime_flag_to_provider",
]
