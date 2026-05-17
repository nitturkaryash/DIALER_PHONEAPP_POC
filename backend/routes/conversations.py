"""Thin router for conversation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from models.collected_params import CollectedParamsSubmission
from services.collected_params_service import get_collected_params_by_call_id
from services.conversation_service import get_conversation, list_recent_events_for_user
from utils.jwt_auth import current_user


router = APIRouter(prefix="/api", tags=["conversations"])


@router.get("/conversations/{call_id}")
async def get_call_conversation(call_id: str, user: dict = Depends(current_user)):
    events = await get_conversation(call_id=call_id, user_id=user.get("id", ""))
    raw = await get_collected_params_by_call_id(call_id=call_id, user_id=user.get("id", ""))
    booking = CollectedParamsSubmission.model_validate(raw).model_dump() if raw else None
    return {"ok": True, "events": events, "booking": booking}


@router.get("/users/{user_id}/conversations")
async def get_user_conversations(user_id: str, user: dict = Depends(current_user)):
    if user_id != user.get("id", ""):
        return {"ok": False, "events": [], "detail": "Forbidden"}

    events = await list_recent_events_for_user(user_id=user_id)
    return {"ok": True, "events": events}
