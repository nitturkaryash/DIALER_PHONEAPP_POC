from __future__ import annotations

from fastapi import APIRouter, Depends

from models.auth import LoginRequest, RefreshTokenRequest, TokenResponse
from services.auth_service import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    exchange_refresh_token,
)
from utils.jwt_auth import current_user


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _public_user(user: dict) -> dict:
    user_id = user.get("id", "")
    return {
        "id": user_id,
        "user_id": user_id,
        "email": user["email"],
        "role": user.get("role", "user"),
        "created_at": user.get("created_at"),
    }


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    user = await authenticate_user(request.email, request.password)
    access_token, expires_in = create_access_token(user)
    refresh_token = await create_refresh_token(user)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
        "user": _public_user(user),
    }


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshTokenRequest):
    payload = await exchange_refresh_token(request.refresh_token)
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload["refresh_token"],
        "expires_in": payload["expires_in"],
        "user": _public_user(payload["user"]),
    }


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return {"ok": True, "user": _public_user(user)}
