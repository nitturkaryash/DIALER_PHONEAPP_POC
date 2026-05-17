"""Health payload helpers for API and outbound status."""

from __future__ import annotations

from datetime import datetime, timezone

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_api_health() -> dict:
    """Primary health check for the FastAPI service."""
    return {
        "ok": True,
        "service": "voice-assistant-api",
        "status": "healthy",
        "timestamp": _utcnow(),
    }


def get_outbound_health() -> dict:
    """Health check for the outbound calling provider."""
    from services import outbound_call_service

    payload = outbound_call_service.get_health_payload()
    return {
        "ok": True,
        "provider": payload.get("provider", outbound_call_service.current_outbound_provider()),
        "warm_pool_ready": payload.get("warm_pool_ready", 0),
        "warm_pool_in_use": payload.get("warm_pool_in_use", 0),
        "timestamp": _utcnow(),
    }
