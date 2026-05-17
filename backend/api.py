"""
Unified API entrypoint — production-ready FastAPI application.

Start with:
    uvicorn api:app --reload                  # development
    uvicorn api:app --host 0.0.0.0 --port 8000  # production
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import config

from middlewares.auth_context import AuthContextMiddleware
from routes.health import router as health_router
from routes.auth import router as auth_router
from routes.call_history import router as call_history_router
from routes.campaigns import router as campaigns_router
from routes.dashboard import router as dashboard_router
from routes.dialer import router as dialer_router
from routes.agent_calls import router as agent_calls_router
from services.app_service import lifespan


# ---------------------------------------------------------------------------
# CORS — tighten allowed origins in production via ALLOWED_ORIGINS env var
# ---------------------------------------------------------------------------
_raw_origins = config.setting("ALLOWED_ORIGINS", "")
_default_dev_origins = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
]

if not _raw_origins or _raw_origins.strip() == "*":
    # `allow_credentials=True` cannot be combined with wildcard origins.
    _allowed_origins = list(_default_dev_origins)
else:
    parsed = [o.strip() for o in _raw_origins.split(",") if o.strip()]
    # Keep explicit env origins, but always include local Expo/Web defaults.
    _allowed_origins = list(dict.fromkeys([*parsed, *_default_dev_origins]))


app = FastAPI(
    title="Voice Callback API",
    description=(
        "Agentic AI voice callback platform — outbound call orchestration, "
        "campaign management, real-time transcription, and conversation intelligence."
    ),
    version="0.4.2",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
app.add_middleware(AuthContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers — order matters for route collision resolution
# ---------------------------------------------------------------------------
light_api_mode = config.bool_setting("LIGHT_API_MODE", False)

app.include_router(health_router)          # GET /api/health, GET /health
app.include_router(auth_router)            # POST /api/auth/login, /refresh, GET /me
app.include_router(call_history_router)   # GET /api/calls/history
app.include_router(campaigns_router)      # CRUD /api/campaigns
app.include_router(dashboard_router)      # /v1/dashboard/agent/*
app.include_router(dialer_router)         # /v1/dialer/*
app.include_router(agent_calls_router)    # POST /v1/agent-calls (human softphone)

if light_api_mode:
    # Lightweight mode avoids importing heavy real-time voice dependencies (Pipecat stack).
    # Keeps auth + campaigns + call history + dialer user flow online.
    pass
else:
    from routes.admin import router as admin_router
    from routes.conversations import router as conversations_router
    from routes.exotel import router as exotel_router
    from routes.outbound_calls import router as outbound_calls_router
    from routes.runtime import router as runtime_router
    from routes.voice_preview import router as voice_preview_router

    app.include_router(outbound_calls_router) # POST /api/calls/outbound, GET /api/calls/{id}/status
    app.include_router(conversations_router)  # GET /api/conversations/{call_id}
    app.include_router(runtime_router)        # GET/POST /api/runtime/*
    app.include_router(voice_preview_router)  # POST /api/voices/sample
    app.include_router(admin_router)          # /admin/* (List users, update user outbound config)
    app.include_router(exotel_router)         # WS /exotel/voice, webhooks


# ---------------------------------------------------------------------------
# Direct process startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api:app",
        host=config.setting("API_HOST", "0.0.0.0"),
        port=config.int_setting("API_PORT", 8000),
        log_level=config.setting("LOG_LEVEL", "info"),
        reload=config.setting("ENV", "production") == "development",
    )
