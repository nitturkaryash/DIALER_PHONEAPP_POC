"""Exotel websocket, webhook, and debug routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, WebSocket

from services import exotel_gateway_service
from utils.jwt_auth import current_user


router = APIRouter()


@router.websocket("/exotel/voice")
async def exotel_voice(websocket: WebSocket):
    await exotel_gateway_service.handle_exotel_websocket(websocket)


@router.get("/exotel/health")
async def exotel_health():
    return exotel_gateway_service.get_health_payload()


@router.post("/exotel-webhook")
async def exotel_webhook(request: Request):
    payload = dict(await request.form())
    return await exotel_gateway_service.record_webhook_payload(payload)


@router.get("/exotel/debug")
async def exotel_debug(_user: dict = Depends(current_user)):
    return exotel_gateway_service.get_debug_payload()
