"""Thin router for call history endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from services.call_history_service import list_call_history,get_call_details
from utils.jwt_auth import current_user


router = APIRouter(prefix="/api/calls", tags=["calls"])


@router.get("/history")
async def call_history(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=200),
    search: str = Query(""),
    status: str = Query(""),
    campaign_id: str = Query(""),
    date_from: str = Query(""),
    date_to: str = Query(""),
    user: dict = Depends(current_user),
):
    history_data = await list_call_history(
        user_id=user.get("id", ""),
        page=page,
        limit=limit,
        search=search,
        status=status,
        campaign_id=campaign_id,
        date_from=date_from,
        date_to=date_to,
    )

    return {
        "ok": True,
        **history_data,
    }

@router.get("/history/{call_id}")
async def get_call_details_route(
    call_id: str,
    user: dict = Depends(current_user),
):
    call_data = await get_call_details(
        user_id=user.get("id", ""),
        call_id=call_id,
    )

    return {
        "ok": True,
        "call": call_data,
    }
