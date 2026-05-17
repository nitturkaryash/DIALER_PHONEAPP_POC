"""Human-agent softphone routes (LiveKit + SIP, no bot)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from models.agent_calls import (
    HumanAgentCallRequest,
    HumanAgentCallResponse,
    HumanAgentCallStatus,
    HumanAgentDispositionRequest,
    HumanAgentDispositionResponse,
)
from utils.jwt_auth import current_user

router = APIRouter(prefix="/v1/agent-calls", tags=["agent-calls"])


def _service():
    from services import agent_call_service

    return agent_call_service


@router.post("", response_model=HumanAgentCallResponse)
async def create_human_agent_call(
    payload: HumanAgentCallRequest,
    user: dict = Depends(current_user),
):
    return await _service().create_human_agent_call(payload, user.get("id", ""))


@router.get("/{call_id}/status", response_model=HumanAgentCallStatus)
async def get_human_agent_call_status(
    call_id: str,
    user: dict = Depends(current_user),
):
    return await _service().get_human_agent_call_status(call_id, user.get("id", ""))


@router.post("/{call_id}/hangup")
async def hangup_human_agent_call(
    call_id: str,
    user: dict = Depends(current_user),
):
    return await _service().hangup_human_agent_call(call_id, user.get("id", ""))


@router.post("/{call_id}/disposition", response_model=HumanAgentDispositionResponse)
async def save_human_agent_disposition(
    call_id: str,
    payload: HumanAgentDispositionRequest,
    user: dict = Depends(current_user),
):
    return await _service().save_human_agent_disposition(
        call_id,
        user.get("id", ""),
        payload,
    )


@router.post("/{call_id}/agent-joined")
async def agent_joined(
    call_id: str,
    user: dict = Depends(current_user),
):
    await _service().mark_agent_joined(call_id, user.get("id", ""))
    return {"success": True}
