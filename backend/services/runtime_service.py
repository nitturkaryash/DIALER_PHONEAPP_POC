from __future__ import annotations

from datetime import datetime, timezone

from config import config
from services import outbound_call_service


def read_system_prompt():
    config.reload()
    path = config.system_prompt_path
    if path.exists():
        content = path.read_text(encoding="utf-8")
    else:
        content = ""
    return {
        "ok": True,
        "path": str(path),
        "content": content,
        "exists": path.exists(),
        "note": "New browser sessions use this prompt immediately. Restart or recycle warm SIP workers for outbound prompt changes to apply right away.",
    }


def write_system_prompt(content: str):
    config.reload()
    path = config.system_prompt_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {
        "ok": True,
        "path": str(path),
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "note": "Prompt saved. Start a new browser session to use it. Restart or recycle warm SIP workers if you want outbound calls to pick it up immediately.",
    }


def runtime_payload():
    config.reload()
    sip_payload = outbound_call_service.get_health_payload()

    groq_key = config.setting("GROQ_API_KEY")
    gemini_key = config.setting("GEMINI_API_KEY")
    openai_key = config.setting("OPENAI_API_KEY")
    llm_provider = "groq" if groq_key else ("gemini" if gemini_key else ("openai" if openai_key else "none"))
    runtime_flag = config.runtime_flag
    realtime_audio_provider = config.realtime_audio_provider
    llm_model = (
        config.setting("GROQ_MODEL", "llama-3.3-70b-versatile")
        if llm_provider == "groq"
        else (
            config.setting("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
            if llm_provider == "gemini"
            else (config.setting("OPENAI_MODEL", "gpt-4.1-mini") if llm_provider == "openai" else "not configured")
        )
    )

    warnings = []
    if runtime_flag != "google-live" and not config.setting("SARVAM_API_KEY"):
        warnings.append("SARVAM_API_KEY is missing.")
    if runtime_flag != "google-live" and not config.setting("DEEPGRAM_API_KEY"):
        warnings.append("DEEPGRAM_API_KEY is missing.")
    if llm_provider == "none":
        warnings.append("No LLM key is configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.")
    if runtime_flag == "google-live" and not gemini_key:
        warnings.append("RUNTIME_FLAG=google-live requires GEMINI_API_KEY.")

    exotel_sid = config.setting("EXOTEL_SID")
    exotel_api_key = config.setting("EXOTEL_API_KEY") or config.setting("EXOTEL_BASIC_USER")
    exotel_api_token = config.setting("EXOTEL_API_TOKEN") or config.setting("EXOTEL_BASIC_TOKEN")
    exotel_caller_id = config.setting("EXOTEL_CALLER_ID")
    exotel_flow_url = config.setting("EXOTEL_FLOW_URL")
    exotel_app_id = config.setting("EXOTEL_APP_ID")
    exotel_configured = bool(
        exotel_sid and exotel_api_key and exotel_api_token and exotel_caller_id and (exotel_flow_url or exotel_app_id)
    )
    outbound_provider_preference = config.outbound_provider
    active_outbound_provider = outbound_call_service.current_outbound_provider()

    return {
        "ok": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "bot": {
            "reachable": True,
            "statusCode": 200,
            "detail": "Pipecat bot runtime is embedded in the api:app process.",
            "transport": "embedded",
            "offerPath": None,
            "baseUrl": None,
        },
        "sip": {
            "reachable": True,
            "statusCode": 200,
            "detail": "Outbound calling is handled in the api:app process.",
            "healthPath": "/health",
            "callsPath": "/api/calls/outbound",
            "baseUrl": None,
            "warmPoolSize": sip_payload.get("warm_pool_size", 0),
            "warmPoolReady": sip_payload.get("warm_pool_ready", 0),
            "warmPoolInUse": sip_payload.get("warm_pool_in_use", 0),
            "warmPoolLastReplenishAt": sip_payload.get("warm_pool_last_replenish_at"),
        },
        "warm_pool_size": sip_payload.get("warm_pool_size", 0),
        "warm_pool_ready": sip_payload.get("warm_pool_ready", 0),
        "warm_pool_in_use": sip_payload.get("warm_pool_in_use", 0),
        "warm_pool_last_replenish_at": sip_payload.get("warm_pool_last_replenish_at"),
        "agent": {
            "mode": "llm",
            "runtimeFlag": runtime_flag,
            "realtimeAudioProvider": runtime_flag,
            "realtimeBackend": realtime_audio_provider,
            "realtimeModel": (
                config.setting("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
                if runtime_flag == "google-live"
                else "legacy"
            ),
            "llmProvider": llm_provider,
            "llmModel": llm_model,
            "systemPromptPath": str(config.system_prompt_path),
            "sttProvider": "google-live" if runtime_flag == "google-live" else "deepgram",
            "sttModel": (
                config.setting("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
                if runtime_flag == "google-live"
                else config.setting("DEEPGRAM_MODEL", "nova-3-general")
            ),
            "ttsProvider": "google-live" if runtime_flag == "google-live" else "sarvam",
            "ttsModel": (
                config.setting("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
                if runtime_flag == "google-live"
                else config.setting("SARVAM_MODEL", "bulbul:v3")
            ),
            "ttsVoice": (
                config.setting("GEMINI_LIVE_VOICE", "Aoede")
                if runtime_flag == "google-live"
                else config.setting("SARVAM_SPEAKER", "shubh")
            ),
            "language": config.setting("SARVAM_LANG", "en-IN"),
            "timezone": config.setting("TIMEZONE", "Asia/Calcutta"),
            "businessHoursStart": config.setting("BUSINESS_HOURS_START", "0"),
            "businessHoursEnd": config.setting("BUSINESS_HOURS_END", "24"),
            "callbackDurationMin": config.setting("CALLBACK_DURATION_MIN", "15"),
        },
        "integrations": {
            "calendarConfigured": bool(config.setting("GOOGLE_CALENDAR_ID")),
            "livekitConfigured": bool(config.setting("LIVEKIT_URL")),
            "telnyxConfigured": bool(config.setting("TELNYX_API_KEY")),
            "sipTrunkConfigured": bool(config.setting("LIVEKIT_SIP_TRUNK_ID")),
            "googleLiveConfigured": bool(gemini_key),
            "exotelConfigured": exotel_configured,
            "outboundProviderPreference": outbound_provider_preference,
            "activeOutboundProvider": active_outbound_provider,
        },
        "warnings": warnings,
    }


_read_system_prompt = read_system_prompt
_runtime_payload = runtime_payload
_write_system_prompt = write_system_prompt
