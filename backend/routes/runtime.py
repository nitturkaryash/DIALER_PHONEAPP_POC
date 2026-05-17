"""Thin router for runtime configuration endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import runtime_service
from utils.jwt_auth import current_user


router = APIRouter(tags=["runtime"])


class PromptUpdateRequest(BaseModel):
    content: str


@router.get("/api/runtime/status")
async def runtime_status():
    return runtime_service.runtime_payload()


@router.get("/api/runtime/prompt")
async def get_runtime_prompt(_user: dict = Depends(current_user)):
    return runtime_service.read_system_prompt()


@router.post("/api/runtime/prompt")
async def update_runtime_prompt(
    body: PromptUpdateRequest,
    _user: dict = Depends(current_user),
):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Prompt content cannot be empty.")
    return runtime_service.write_system_prompt(body.content)
