from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class UserPublic(BaseModel):
    """Safe public representation of a user (no password_hash)."""
    id: str
    user_id: str
    email: EmailStr
    role: str = "user"
    created_at: Optional[datetime] = None


class LoginRequest(BaseModel):
    """Credentials for login."""
    email: EmailStr
    password: str


class RefreshTokenRequest(BaseModel):
    """Token rotation request."""
    refresh_token: str


class TokenResponse(BaseModel):
    """Successful authentication response."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserPublic
