"""Thin router for health endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from services.health_service import get_api_health, get_outbound_health


router = APIRouter(tags=["health"])


@router.get("/api/health")
async def api_health():
    return get_api_health()


@router.get("/health")
async def outbound_health():
    return get_outbound_health()
