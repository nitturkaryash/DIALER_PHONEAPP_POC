from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from typing import List, Literal, Optional

from db.mongo import get_db
from models.user_outbound_config import UserOutboundConfig
from services.auth_service import _create_user, get_user_by_email
from utils.jwt_auth import admin_required

router = APIRouter(prefix="/api/admin", tags=["admin"])

class UserListResponse(BaseModel):
    id: str
    email: str
    role: str

class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["user", "admin"] = "user"

@router.get("/users", response_model=List[UserListResponse])
async def list_users(_admin: dict = Depends(admin_required)):
    db = get_db()
    users = await db.users.find({}, {"password_hash": 0}).to_list(length=1000)
    return [
        {"id": u["id"], "email": u["email"], "role": u.get("role", "user")}
        for u in users
    ]

@router.post("/users", response_model=UserListResponse, status_code=201)
async def create_user(request: CreateUserRequest, _admin: dict = Depends(admin_required)):
    existing = await get_user_by_email(request.email)
    if existing:
        raise HTTPException(status_code=409, detail="A user with this email already exists.")
    user = await _create_user(email=request.email, password=request.password, role=request.role)
    return {"id": user["id"], "email": user["email"], "role": user.get("role", "user")}

@router.get("/user-config/{user_id}", response_model=UserOutboundConfig)
async def get_user_config(user_id: str, _admin: dict = Depends(admin_required)):
    db = get_db()
    config = await db.user_outbound_config.find_one({"user_id": user_id})
    if not config:
        return UserOutboundConfig(user_id=user_id)
    return config

@router.post("/user-config", response_model=UserOutboundConfig)
async def update_user_config(config: UserOutboundConfig, _admin: dict = Depends(admin_required)):
    db = get_db()
    await db.user_outbound_config.update_one(
        {"user_id": config.user_id},
        {"$set": config.dict(exclude_unset=True)},
        upsert=True
    )
    return config
