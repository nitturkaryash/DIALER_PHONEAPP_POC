from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from fastapi import HTTPException, status

from config import config
from db.mongo import get_db


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_email(email: str) -> str:
    return email.lower().strip()


def _read_int_env(name: str, default: int, *, minimum: int) -> int:
    return max(minimum, config.int_setting(name, default))


def _hash_password(password: str) -> str:
    salt = config.setting("AUTH_PASSWORD_SALT", "voice-assistant-salt")
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(_hash_password(password), password_hash)


def _jwt_secret() -> str:
    value = config.setting("JWT_SECRET")
    if not value:
        raise RuntimeError("JWT_SECRET is not configured")
    return value


def _jwt_issuer() -> str:
    return config.setting("JWT_ISSUER", "voice-assistant-api")


def _jwt_audience() -> str:
    return config.setting("JWT_AUDIENCE", "voice-assistant-clients")


def _access_ttl_minutes() -> int:
    return _read_int_env("JWT_ACCESS_TTL_MINUTES", 60, minimum=5)


def _refresh_ttl_days() -> int:
    return _read_int_env("JWT_REFRESH_TTL_DAYS", 14, minimum=1)


def _is_expired(value: Any) -> bool:
    if not isinstance(value, datetime):
        return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value <= _utcnow()


def create_access_token(user: dict[str, Any]) -> tuple[str, int]:
    now = _utcnow()
    ttl_minutes = _access_ttl_minutes()
    exp = now + timedelta(minutes=ttl_minutes)
    payload = {
        "iss": _jwt_issuer(),
        "aud": _jwt_audience(),
        "sub": str(user["id"]),
        "role": user.get("role", "user"),
        "userType": "user",
        "jti": str(uuid4()),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "email": user.get("email", ""),
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm="HS256")
    return token, ttl_minutes * 60


async def create_refresh_token(user: dict[str, Any]) -> str:
    db = get_db()
    token = secrets.token_urlsafe(48)
    now = _utcnow()
    await db.refresh_tokens.insert_one(
        {
            "token": token,
            "user_id": str(user["id"]),
            "created_at": now,
            "expires_at": now + timedelta(days=_refresh_ttl_days()),
        }
    )
    return token


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            _jwt_secret(),
            algorithms=["HS256"],
            issuer=_jwt_issuer(),
            audience=_jwt_audience(),
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}") from exc


async def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    db = get_db()
    return await db.users.find_one({"id": user_id})


async def get_user_by_email(email: str) -> dict[str, Any] | None:
    db = get_db()
    return await db.users.find_one({"email": _normalize_email(email)})


async def authenticate_user(email: str, password: str) -> dict[str, Any]:
    user = await get_user_by_email(email)
    if not user or not _verify_password(password, user.get("password_hash", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user.get("id"):
        user["id"] = str(uuid4())
        await get_db().users.update_one({"_id": user["_id"]}, {"$set": {"id": user["id"]}})
    return user


async def _create_user(email: str, password: str, role: str = "user") -> dict[str, Any]:
    db = get_db()
    now = _utcnow()
    payload = {
        "id": str(uuid4()),
        "email": _normalize_email(email),
        "password_hash": _hash_password(password),
        "role": role,
        "created_at": now,
    }
    await db.users.insert_one(payload)

    await db.user_outbound_config.update_one(
        {"user_id": payload["id"]},
        {"$setOnInsert": {
            "user_id": payload["id"],
            "exotel_sid": None,
            "exotel_api_key": None,
            "exotel_api_token": None,
            "exotel_caller_id": None,
            "exotel_flow_url": None,
            "issabel_host": None,
            "issabel_port": None,
            "issabel_user": None,
            "issabel_login": None,
            "issabel_domain": None,
            "issabel_password": None,
            "issabel_dial_prefix": None,
            "created_at": now,
        }},
        upsert=True,
    )
    return payload


async def ensure_seed_user() -> None:
    """Create the default login from env if configured and missing."""
    email = _normalize_email(config.setting("AUTH_DEFAULT_ADMIN_EMAIL"))
    password = config.setting("AUTH_DEFAULT_ADMIN_PASSWORD")
    if not email or not password:
        return

    existing = await get_user_by_email(email)
    if existing:
        return

    await _create_user(email=email, password=password, role="admin")


async def exchange_refresh_token(refresh_token: str) -> dict[str, Any]:
    db = get_db()
    token_doc = await db.refresh_tokens.find_one({"token": refresh_token})
    if not token_doc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if _is_expired(token_doc.get("expires_at")):
        await db.refresh_tokens.delete_one({"_id": token_doc["_id"]})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

    user = await get_user_by_id(token_doc["user_id"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    await db.refresh_tokens.delete_one({"_id": token_doc["_id"]})
    access_token, expires_in = create_access_token(user)
    new_refresh = await create_refresh_token(user)
    return {
        "access_token": access_token,
        "refresh_token": new_refresh,
        "expires_in": expires_in,
        "user": user,
    }
