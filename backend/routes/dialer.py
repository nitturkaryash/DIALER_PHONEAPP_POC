from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db.mongo import get_db
from utils.jwt_auth import current_user


router = APIRouter(prefix="/v1/dialer", tags=["dialer"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime | None) -> datetime | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _serialize_campaign(doc: dict) -> dict:
    return {
        "id": doc.get("id") or str(doc.get("_id", "")),
        "name": doc.get("name", "Untitled Campaign"),
        "status": doc.get("status", "draft"),
        "lead_count": int(doc.get("total_contacts") or 0),
    }


def _serialize_lead(doc: dict) -> dict:
    payload = doc.get("csv_payload") if isinstance(doc.get("csv_payload"), dict) else {}
    name = payload.get("customer_name") or payload.get("name") or f"Lead {doc.get('sequence_no', '')}".strip()
    phone = doc.get("phone_e164") or payload.get("phone") or payload.get("phone_number") or ""
    email = payload.get("email")
    return {
        "id": str(doc.get("_id", "")),
        "name": str(name or "Lead"),
        "phone": str(phone or ""),
        "status": str(doc.get("state") or "pending"),
        "email": str(email) if email else None,
    }


class CreateCallRequest(BaseModel):
    lead_id: str
    process_id: str


class UpdateCallStatusRequest(BaseModel):
    status: Literal["answered", "ended"]


class SaveDispositionRequest(BaseModel):
    outcome: str
    notes: str | None = None
    callback_time: datetime | None = None


@router.get("/campaigns")
async def get_campaigns(user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    cursor = db.campaigns.find({"user_id": user_id}).sort("created_at", -1)
    campaigns: list[dict] = []
    async for doc in cursor:
        item = _serialize_campaign(doc)
        if item["lead_count"] <= 0:
            item["lead_count"] = await db.campaign_contacts.count_documents({"campaign_id": item["id"]})
        campaigns.append(item)
    return campaigns


@router.get("/campaigns/{process_id}/leads")
async def get_campaign_leads(
    process_id: str,
    status: str = Query(default="pending"),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    db = get_db()
    user_id = user.get("id", "")
    query: dict = {"campaign_id": process_id, "user_id": user_id}
    if status:
        query["state"] = status
    cursor = db.campaign_contacts.find(query).sort("sequence_no", 1).skip(skip).limit(limit)
    leads: list[dict] = []
    async for doc in cursor:
        leads.append(_serialize_lead(doc))
    return leads


@router.post("/calls")
async def create_call_session(payload: CreateCallRequest, user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    if not ObjectId.is_valid(payload.lead_id):
        raise HTTPException(status_code=400, detail="Invalid lead_id")

    lead = await db.campaign_contacts.find_one(
        {
            "_id": ObjectId(payload.lead_id),
            "campaign_id": payload.process_id,
            "user_id": user_id,
        }
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    call_id = str(uuid4())
    now = _utcnow()
    lead_data = _serialize_lead(lead)
    await db.call_sessions.insert_one(
        {
            "id": call_id,
            "call_id": call_id,
            "campaign_id": payload.process_id,
            "campaign_contact_id": payload.lead_id,
            "user_id": user_id,
            "status": "originated",
            "outcome": None,
            "notes": None,
            "callback_time": None,
            "phone_number": lead_data["phone"],
            "customer_name": lead_data["name"],
            "created_at": now,
            "answered_at": None,
            "ended_at": None,
            "duration_seconds": None,
        }
    )
    await db.campaign_contacts.update_one({"_id": lead["_id"]}, {"$set": {"state": "calling", "updated_at": now}})
    return {"call_id": call_id, "lead_name": lead_data["name"], "phone": lead_data["phone"]}


@router.patch("/calls/{call_id}/status")
async def update_call_status(call_id: str, payload: UpdateCallStatusRequest, user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    call = await db.call_sessions.find_one({"call_id": call_id, "user_id": user_id})
    if not call:
        raise HTTPException(status_code=404, detail="Call session not found")

    now = _utcnow()
    update_doc: dict = {"status": payload.status}
    if payload.status == "answered":
        update_doc["answered_at"] = now
    elif payload.status == "ended":
        update_doc["ended_at"] = now
        started = _as_utc(call.get("answered_at")) or _as_utc(call.get("created_at"))
        if started is not None:
            update_doc["duration_seconds"] = max(0, int((now - started).total_seconds()))

    await db.call_sessions.update_one({"_id": call["_id"]}, {"$set": update_doc})

    if payload.status == "ended" and call.get("campaign_contact_id") and ObjectId.is_valid(str(call.get("campaign_contact_id"))):
        await db.campaign_contacts.update_one(
            {"_id": ObjectId(str(call.get("campaign_contact_id")))},
            {"$set": {"state": "called", "updated_at": now}},
        )
    return {"success": True}


@router.post("/calls/{call_id}/disposition")
async def save_disposition(call_id: str, payload: SaveDispositionRequest, user: dict = Depends(current_user)):
    db = get_db()
    user_id = user.get("id", "")
    call = await db.call_sessions.find_one({"call_id": call_id, "user_id": user_id})
    if not call:
        raise HTTPException(status_code=404, detail="Call session not found")

    now = _utcnow()
    outcome_state = str(payload.outcome or "completed").strip().lower().replace(" ", "-")
    await db.call_sessions.update_one(
        {"_id": call["_id"]},
        {
            "$set": {
                "outcome": payload.outcome,
                "notes": payload.notes,
                "callback_time": payload.callback_time,
                "status": "ended",
                "ended_at": call.get("ended_at") or now,
            }
        },
    )

    contact_id = call.get("campaign_contact_id")
    if contact_id and ObjectId.is_valid(str(contact_id)):
        await db.campaign_contacts.update_one(
            {"_id": ObjectId(str(contact_id))},
            {"$set": {"state": outcome_state, "updated_at": now}},
        )
    return {"success": True}
