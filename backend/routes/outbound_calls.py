"""Thin router for outbound call endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from models.outbound_calls import CallStatus, OutboundCallRequest
from services import outbound_call_service
from utils.jwt_auth import current_user


router = APIRouter(tags=["calls"])


def _request_value(request: OutboundCallRequest, *names: str):
    extras = getattr(request, "model_extra", None) or {}
    for name in names:
        value = getattr(request, name, None)
        if value is not None:
            return value
        if name in extras and extras[name] is not None:
            return extras[name]
    return None


def _clean_string(value) -> str:
    return str(value or "").strip()


def _language_code(value) -> str:
    clean = _clean_string(value)
    lowered = clean.lower().replace("_", "-")
    if lowered in {"en-in", "english", "english-india", "english (india)"}:
        return "en-IN"
    if lowered in {"hi-in", "hindi", "hindi-india", "hindi (india)"}:
        return "hi-IN"
    if lowered in {"kn-in", "kannada", "kannada-india", "kannada (india)"}:
        return "kn-IN"
    return clean


def _normalize_direct_call_bot_config(request: OutboundCallRequest) -> dict:
    context = dict(request.verification_context or {})
    nested = context.get("bot_config")
    bot_config = dict(nested) if isinstance(nested, dict) else {}
    top_level = _request_value(request, "bot_config", "botConfig")
    if isinstance(top_level, dict):
        bot_config.update(top_level)

    string_fields = {
        "initial_greeting": ("initial_greeting", "opening_greeting", "initialGreeting", "openingGreeting"),
        "bot_system_prompt": ("bot_system_prompt", "system_prompt", "botSystemPrompt", "systemPrompt"),
        "tts_prompt_template": (
            "tts_prompt_template",
            "style_instructions",
            "ttsPromptTemplate",
            "styleInstructions",
        ),
        "tts_speed": ("tts_speed", "ttsSpeed"),
        "tts_tone": ("tts_tone", "ttsTone"),
        "voice_agent": ("voice_agent", "voice", "voiceAgent"),
        "outbound_knowledge_token": (
            "outbound_knowledge_token",
            "knowledge_token",
            "outboundKnowledgeToken",
            "knowledgeToken",
        ),
        "bot_knowledge": ("bot_knowledge", "botKnowledge"),
    }
    for target, aliases in string_fields.items():
        value = _request_value(request, *aliases)
        clean = _clean_string(value)
        if clean:
            bot_config[target] = clean

    barge_in_value = _request_value(request, "barge_in", "bargeIn")
    if barge_in_value is not None:
        bot_config["barge_in"] = bool(barge_in_value)

    language = _language_code(_request_value(request, "tts_language", "language", "ttsLanguage"))
    if language:
        bot_config["tts_language"] = language

    collect_fields = _request_value(request, "collect_fields", "collectFields")
    if isinstance(collect_fields, list):
        bot_config["collect_fields"] = collect_fields

    if bot_config:
        context["bot_config"] = bot_config
    request.verification_context = context
    return context


@router.post("/api/calls/outbound", response_model=dict)
async def initiate_outbound_call(
    request: OutboundCallRequest,
    user: dict = Depends(current_user),
):
    # Always inject the authenticated user_id to prevent client-side injection.
    context = _normalize_direct_call_bot_config(request)
    context["user_id"] = user.get("id", "")
    request.verification_context = context
    return await outbound_call_service.initiate_outbound_call(request)


@router.post("/api/calls/outbound/knowledge/pdf", response_model=dict)
async def extract_outbound_pdf_knowledge(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    content = await file.read()
    return await outbound_call_service.extract_outbound_pdf_knowledge(
        filename=file.filename or "knowledge.pdf",
        pdf_bytes=content,
        content_type=file.content_type,
    )


@router.get("/api/calls/{call_id}/status", response_model=CallStatus)
async def check_call_status(
    call_id: str,
    user: dict = Depends(current_user),
):
    status = await outbound_call_service.check_call_status_for_user(call_id, user.get("id", ""))
    if not status:
        raise HTTPException(status_code=404, detail="Call not found")
    return status


@router.post("/webhooks/livekit/call-status")
async def livekit_call_status_webhook(data: dict):
    """Internal LiveKit webhook with no auth."""
    return await outbound_call_service.handle_livekit_call_status_webhook(data)
