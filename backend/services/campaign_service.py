"""
services/campaign_service.py
All business logic for campaign CRUD, CSV ingestion, and campaign execution.
Routes stay thin — all DB calls live here.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from bson import ObjectId
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from loguru import logger

from config import config
from db.mongo import get_db
from utils.redis_client import get_redis
from models.campaigns import CampaignBotConfigPatch
from models.campaigns import CampaignCollectField
from models.outbound_calls import OutboundCallRequest
from services.system_prompt import load_system_prompt_text

_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_phone(value: str) -> str:
    digits = re.sub(r"\D+", "", value or "")
    if not digits:
        return ""
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+91{digits}"
    return f"+{digits}"


def _serialize_doc(doc: dict) -> dict:
    """Strip MongoDB _id and ensure 'id' is always present."""
    doc["id"] = doc.get("id") or str(doc.get("_id", ""))
    doc.pop("_id", None)
    return doc


def _campaign_export_filename(name: str, suffix: str = "collected-params") -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(name or "campaign").strip()).strip("-").lower()
    return f"{slug or 'campaign'}-{suffix}.csv"


def _knowledge_upload_dir() -> Path:
    configured = config.setting("KNOWLEDGE_UPLOAD_DIR")
    if configured:
        base = Path(configured)
        if not base.is_absolute():
            base = _ROOT / configured
    else:
        base = _ROOT / ".cache" / "knowledge_uploads"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _env_int(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _normalize_pagination(page: int, limit: int, *, default_limit: int = 20, max_limit: int = 200) -> tuple[int, int, int]:
    safe_page = max(1, int(page or 1))
    safe_limit = max(1, min(int(limit or default_limit), max_limit))
    skip = (safe_page - 1) * safe_limit
    return safe_page, safe_limit, skip


def _normalize_campaign_public(doc: dict) -> dict:
    doc.setdefault("collect_fields", [])
    doc.setdefault("bot_system_prompt", None)
    doc.setdefault("bot_knowledge", None)
    doc.setdefault("initial_greeting", None)
    doc.setdefault("voice_agent", None)
    doc.setdefault("tts_language", None)
    doc.setdefault("tts_prompt_template", None)
    doc.setdefault("tts_speed", None)
    doc.setdefault("tts_tone", None)
    doc.setdefault("barge_in", None)
    doc.setdefault("knowledge_source", "text")
    doc.setdefault("knowledge_status", "none")
    doc.setdefault("knowledge_doc_ids", [])
    doc.setdefault("knowledge_version", 0)
    return doc


def _configured_collect_field_keys(fields: list[dict] | None) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for field in fields or []:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def _ensure_unique_collect_fields(fields: list[CampaignCollectField] | None) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for field in fields or []:
        key = str(field.key or "").strip()
        if not key:
            continue
        if key in seen:
            duplicates.add(key)
            continue
        seen.add(key)
    if duplicates:
        dupes = ", ".join(sorted(duplicates))
        raise HTTPException(status_code=400, detail=f"Duplicate collect_fields keys are not allowed: {dupes}")


def _campaign_prompt_override(campaign: dict, *, default_prompt: str | None = None) -> str:
    override = str(campaign.get("bot_system_prompt") or "").strip()
    if not override:
        return ""
    if default_prompt is None:
        default_prompt = load_system_prompt_text().strip()
    if override == default_prompt:
        return ""
    return override


def _attach_campaign_prompt_metadata(campaign: dict, *, default_prompt: str | None = None) -> dict:
    if default_prompt is None:
        default_prompt = load_system_prompt_text().strip()
    override = _campaign_prompt_override(campaign, default_prompt=default_prompt)
    campaign["bot_system_prompt"] = override or None
    campaign["has_system_prompt_override"] = bool(override)
    campaign["effective_system_prompt"] = override or default_prompt
    return campaign


async def _build_campaign_collected_params_table(
    db: Any,
    logical_id: str,
    *,
    configured_fields: list[dict] | None = None,
) -> dict[str, Any]:
    configured_keys = _configured_collect_field_keys(configured_fields)
    configured_key_set = set(configured_keys)
    calls: list[dict[str, Any]] = []
    async for call in db.call_sessions.find({"campaign_id": logical_id}).sort("created_at", -1).limit(500):
        serialized = _serialize_doc(call)
        calls.append(serialized)

    params_by_call_id: dict[str, dict[str, Any]] = {}
    params_by_contact_id: dict[str, dict[str, Any]] = {}
    answer_keys: set[str] = set()
    answer_keys.update(configured_keys)
    async for row in db.collected_params.find({"campaign_id": logical_id}).sort("created_at", 1):
        serialized = _serialize_doc(row)
        call_id = str(serialized.get("call_id") or "").strip()
        campaign_contact_id = str(serialized.get("campaign_contact_id") or "").strip()
        answers = serialized.get("answers") if isinstance(serialized.get("answers"), dict) else {}
        answer_keys.update(str(key) for key in answers.keys())
        if call_id:
            existing = params_by_call_id.get(call_id)
            if existing:
                merged_answers = dict(existing.get("answers") if isinstance(existing.get("answers"), dict) else {})
                merged_answers.update(answers)
                existing["answers"] = merged_answers
                params_by_call_id[call_id] = existing
            else:
                serialized["answers"] = dict(answers)
                params_by_call_id[call_id] = serialized
        if campaign_contact_id:
            existing = params_by_contact_id.get(campaign_contact_id)
            if existing:
                merged_answers = dict(existing.get("answers") if isinstance(existing.get("answers"), dict) else {})
                merged_answers.update(answers)
                existing["answers"] = merged_answers
                params_by_contact_id[campaign_contact_id] = existing
            else:
                serialized["answers"] = dict(answers)
                params_by_contact_id[campaign_contact_id] = serialized

    rows: list[dict[str, Any]] = []
    included_call_ids: set[str] = set()
    included_contact_ids: set[str] = set()

    for call in calls:
        call_id = str(call.get("call_id") or "").strip()
        campaign_contact_id = str(call.get("campaign_contact_id") or "").strip()
        params = params_by_call_id.get(call_id, {})
        if not params and campaign_contact_id:
            params = params_by_contact_id.get(campaign_contact_id, {})
        answers = params.get("answers") if isinstance(params.get("answers"), dict) else {}
        rows.append(
            {
                "call_id": call_id or None,
                "campaign_contact_id": call.get("campaign_contact_id") or params.get("campaign_contact_id"),
                "customer_name": call.get("customer_name"),
                "phone_number": call.get("phone_number"),
                "attempt_no": int(call.get("attempt_no") or 0),
                "status": call.get("status"),
                "created_at": params.get("created_at") or call.get("created_at"),
                "answers": answers,
            }
        )
        if call_id:
            included_call_ids.add(call_id)
        if campaign_contact_id:
            included_contact_ids.add(campaign_contact_id)

    for call_id, params in params_by_call_id.items():
        if call_id in included_call_ids:
            continue
        answers = params.get("answers") if isinstance(params.get("answers"), dict) else {}
        rows.append(
            {
                "call_id": call_id or None,
                "campaign_contact_id": params.get("campaign_contact_id"),
                "customer_name": None,
                "phone_number": None,
                "attempt_no": 0,
                "status": None,
                "created_at": params.get("created_at"),
                "answers": answers,
            }
        )
        campaign_contact_id = str(params.get("campaign_contact_id") or "").strip()
        if campaign_contact_id:
            included_contact_ids.add(campaign_contact_id)

    for campaign_contact_id, params in params_by_contact_id.items():
        if campaign_contact_id in included_contact_ids:
            continue
        answers = params.get("answers") if isinstance(params.get("answers"), dict) else {}
        rows.append(
            {
                "call_id": params.get("call_id"),
                "campaign_contact_id": params.get("campaign_contact_id"),
                "customer_name": None,
                "phone_number": None,
                "attempt_no": 0,
                "status": None,
                "created_at": params.get("created_at"),
                "answers": answers,
            }
        )

    return {
        "columns": [
            "call_id",
            "customer_name",
            "phone_number",
            "attempt_no",
            "status",
            "created_at",
            *configured_keys,
            *sorted(key for key in answer_keys if key not in configured_key_set),
        ],
        "rows": rows,
    }


def _flatten_collected_params_rows(table: dict[str, Any]) -> list[dict[str, Any]]:
    flat_rows: list[dict[str, Any]] = []
    for row in table.get("rows", []):
        answers = row.get("answers") if isinstance(row.get("answers"), dict) else {}
        flat_rows.append(
            {
                "call_id": row.get("call_id"),
                "customer_name": row.get("customer_name"),
                "phone_number": row.get("phone_number"),
                "attempt_no": row.get("attempt_no"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                **answers,
            }
        )
    return flat_rows


async def _resolve_campaign(campaign_id: str, user_id: str) -> dict:
    """Fetch campaign by logical id or ObjectId, scoped to user. Raises 404 if not found."""
    db = get_db()
    campaign = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id})
    if not campaign and ObjectId.is_valid(campaign_id):
        campaign = await db.campaigns.find_one(
            {"_id": ObjectId(campaign_id), "user_id": user_id}
        )
        if campaign and not campaign.get("id"):
            await db.campaigns.update_one(
                {"_id": campaign["_id"]}, {"$set": {"id": campaign_id}}
            )
            campaign["id"] = campaign_id
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


# ---------------------------------------------------------------------------
# CSV Ingestion
# ---------------------------------------------------------------------------

async def create_campaign_from_csv(
    *,
    user_id: str,
    name: str,
    csv_bytes: bytes,
    initial_greeting: str | None = None,
    voice_agent: str | None = None,
    tts_language: str | None = None,
    tts_prompt_template: str | None = None,
    tts_speed: str | None = None,
    tts_tone: str | None = None,
    barge_in: bool | None = None,
    bot_system_prompt: str | None = None,
    collect_fields: list[CampaignCollectField] | None = None,
) -> dict:
    """Parse a CSV file and create campaign + contacts in DB."""
    db = get_db()
    now = _utcnow()
    default_prompt = load_system_prompt_text().strip()
    normalized_prompt = (bot_system_prompt or "").strip()
    if normalized_prompt == default_prompt:
        normalized_prompt = ""
    _ensure_unique_collect_fields(collect_fields)

    campaign = {
        "id": str(uuid4()),
        "user_id": user_id,
        "name": name.strip(),
        "status": "draft",
        "total_contacts": 0,
        "completed_contacts": 0,
        "failed_contacts": 0,
        "created_at": now,
        "updated_at": now,
        "collect_fields": [f.model_dump() for f in (collect_fields or [])],
        "bot_system_prompt": normalized_prompt or None,
        "bot_knowledge": None,
        "initial_greeting": (initial_greeting or "").strip() or None,
        "voice_agent": (voice_agent or "").strip() or None,
        "tts_language": (tts_language or "").strip() or None,
        "tts_prompt_template": (tts_prompt_template or "").strip() or None,
        "tts_speed": (tts_speed or "").strip() or None,
        "tts_tone": (tts_tone or "").strip() or None,
        "barge_in": bool(barge_in) if barge_in is not None else None,
        "knowledge_source": "text",
        "knowledge_status": "none",
        "knowledge_doc_ids": [],
        "knowledge_version": 0,
    }
    await db.campaigns.insert_one(campaign)
    campaign_id = campaign["id"]

    decoded = csv_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(decoded))
    rows: list[dict] = []
    seq = 1
    for raw in reader:
        payload = {k: (v or "").strip() for k, v in (raw or {}).items()}
        phone_source = (
            payload.get("phone")
            or payload.get("phone_number")
            or payload.get("mobile")
            or payload.get("number")
            or ""
        )
        phone_e164 = _normalize_phone(phone_source)
        if not phone_e164:
            continue
        rows.append(
            {
                "campaign_id": campaign_id,
                "user_id": user_id,
                "phone_e164": phone_e164,
                "csv_payload": payload,
                "state": "pending",
                "retry_count": 0,
                "sequence_no": seq,
                "created_at": now,
            }
        )
        seq += 1

    if rows:
        await db.campaign_contacts.insert_many(rows)

    new_status = "queued" if rows else "failed"
    total = len(rows)
    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": new_status, "total_contacts": total, "updated_at": _utcnow()}},
    )
    campaign.pop("_id", None)
    campaign["status"] = new_status
    campaign["total_contacts"] = total
    _normalize_campaign_public(campaign)
    _attach_campaign_prompt_metadata(campaign, default_prompt=default_prompt)
    return campaign


# ---------------------------------------------------------------------------
# List / Detail
# ---------------------------------------------------------------------------

async def list_campaigns(user_id: str, page: int = 1, limit: int = 20) -> dict:
    """Return all campaigns for the authenticated user, newest first."""
    db = get_db()
    safe_page, safe_limit, skip = _normalize_pagination(page, limit)
    total = await db.campaigns.count_documents({"user_id": user_id})
    cursor = db.campaigns.find({"user_id": user_id}).sort("created_at", -1).skip(skip).limit(safe_limit)
    default_prompt = load_system_prompt_text().strip()
    campaigns: list[dict] = []
    async for doc in cursor:
        campaign = _normalize_campaign_public(_serialize_doc(doc))
        _attach_campaign_prompt_metadata(campaign, default_prompt=default_prompt)
        campaigns.append(campaign)
    return {
        "campaigns": campaigns,
        "pagination": {
            "total": total,
            "page": safe_page,
            "limit": safe_limit,
            "total_pages": (total + safe_limit - 1) // safe_limit if safe_limit > 0 else 0,
        }
    }


async def get_campaign_detail(campaign_id: str, user_id: str, page: int = 1, limit: int = 20) -> dict:
    """Return campaign with its full contact list and call log."""
    redis = get_redis()
    cache_key = f"campaign_detail:{campaign_id}:{user_id}:{page}:{limit}"

    if redis:
        cached = redis.get(cache_key)
        if cached:
            logger.info(f"Cache hit for campaign detail: {campaign_id}")
            return json.loads(cached)
        logger.info(f"Cache miss for campaign detail: {campaign_id}")

    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id
    default_prompt = load_system_prompt_text().strip()

    db = get_db()
    safe_page, safe_limit, skip = _normalize_pagination(page, limit)
    collected_params_table = await _build_campaign_collected_params_table(
        db,
        logical_id,
        configured_fields=campaign.get("collect_fields") or [],
    )

    params_cursor = db.collected_params.find({"campaign_id": logical_id}).sort("created_at", 1)
    answers_by_contact: dict[str, dict] = {}
    async for row in params_cursor:
        cid = row.get("campaign_contact_id")
        if cid:
            existing_answers = answers_by_contact.get(cid, {})
            incoming_answers = row.get("answers", {}) if isinstance(row.get("answers"), dict) else {}
            merged_answers = dict(existing_answers)
            merged_answers.update(incoming_answers)
            answers_by_contact[cid] = merged_answers

    total_contacts = await db.campaign_contacts.count_documents({"campaign_id": logical_id})
    contacts: list[dict] = []
    async for contact in db.campaign_contacts.find(
        {"campaign_id": logical_id}
    ).sort("sequence_no", 1).skip(skip).limit(safe_limit):
        contact["id"] = str(contact["_id"])
        contact.pop("_id", None)
        contact["dynamic_answers"] = answers_by_contact.get(contact["id"], {})
        contacts.append(contact)

    calls: list[dict] = []
    async for call in db.call_sessions.find(
        {"campaign_id": logical_id}
    ).sort("created_at", -1).limit(500):
        call["id"] = str(call["_id"])
        call.pop("_id", None)
        calls.append(call)

    campaign.pop("_id", None)
    _normalize_campaign_public(campaign)
    _attach_campaign_prompt_metadata(campaign, default_prompt=default_prompt)
    result = {
        "ok": True,
        "campaign": campaign,
        "contacts": contacts,
        "calls": calls,
        "collected_params_table": collected_params_table,
        "pagination": {
            "total": total_contacts,
            "page": safe_page,
            "limit": safe_limit,
            "total_pages": (total_contacts + safe_limit - 1) // safe_limit if safe_limit > 0 else 0,
        }
    }

    if redis:
        status = str(campaign.get("status") or "").lower()
        if status in ["completed", "finished"]:
            redis.setex(cache_key, 3600, json.dumps(jsonable_encoder(result)))
            logger.info(f"Cached campaign detail for {status} campaign: {campaign_id}")

    return result


async def download_campaign_collected_params_csv(campaign_id: str, user_id: str) -> StreamingResponse:
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id
    db = get_db()
    table = await _build_campaign_collected_params_table(
        db,
        logical_id,
        configured_fields=campaign.get("collect_fields") or [],
    )
    rows = _flatten_collected_params_rows(table)
    columns = list(table.get("columns") or [])

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column) for column in columns})

    filename = _campaign_export_filename(campaign.get("name") or logical_id)
    payload = io.BytesIO(buffer.getvalue().encode("utf-8"))
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(payload, media_type="text/csv; charset=utf-8", headers=headers)


# ---------------------------------------------------------------------------
# Bot configuration (PATCH)
# ---------------------------------------------------------------------------


def _effective_system_prompt(campaign: dict) -> str:
    override = _campaign_prompt_override(campaign)
    if override:
        return override
    return load_system_prompt_text().strip()


async def update_campaign_bot_config(
    campaign_id: str, user_id: str, patch: CampaignBotConfigPatch
) -> dict:
    """Update collect_fields and/or prompt overrides for a campaign."""
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id

    if (
        patch.collect_fields is None
        and patch.bot_system_prompt is None
        and patch.bot_knowledge is None
        and patch.knowledge_source is None
        and patch.initial_greeting is None
        and patch.voice_agent is None
        and patch.tts_language is None
        and patch.tts_prompt_template is None
        and patch.tts_speed is None
        and patch.tts_tone is None
        and patch.barge_in is None
    ):
        raise HTTPException(status_code=400, detail="No fields to update.")

    db = get_db()
    now = _utcnow()
    set_doc: dict[str, Any] = {"updated_at": now}
    unset_doc: dict[str, str] = {}

    if patch.collect_fields is not None:
        if len(patch.collect_fields) == 0:
            raise HTTPException(
                status_code=400,
                detail="collect_fields must include at least one field.",
            )
        _ensure_unique_collect_fields(patch.collect_fields)
        set_doc["collect_fields"] = [f.model_dump() for f in patch.collect_fields]

    if patch.bot_system_prompt is not None:
        stripped = patch.bot_system_prompt.strip()
        default_prompt = load_system_prompt_text().strip()
        if stripped and stripped != default_prompt:
            set_doc["bot_system_prompt"] = stripped
        else:
            unset_doc["bot_system_prompt"] = ""

    if patch.bot_knowledge is not None:
        stripped = (patch.bot_knowledge or "").strip()
        if stripped:
            set_doc["bot_knowledge"] = stripped
        else:
            unset_doc["bot_knowledge"] = ""

    if patch.tts_language is not None:
        stripped = patch.tts_language.strip()
        if stripped:
            set_doc["tts_language"] = stripped
        else:
            unset_doc["tts_language"] = ""

    if patch.knowledge_source is not None:
        source = str(patch.knowledge_source).strip().lower()
        if source not in {"text", "pdf_embedding"}:
            raise HTTPException(status_code=400, detail="knowledge_source must be 'text' or 'pdf_embedding'.")
        set_doc["knowledge_source"] = source
        if source == "text":
            set_doc["knowledge_status"] = "none"
            set_doc["knowledge_doc_ids"] = []

    if patch.initial_greeting is not None:
        greeting = (patch.initial_greeting or "").strip()
        if greeting:
            set_doc["initial_greeting"] = greeting
        else:
            unset_doc["initial_greeting"] = ""

    if patch.voice_agent is not None:
        voice_agent = (patch.voice_agent or "").strip()
        if voice_agent:
            set_doc["voice_agent"] = voice_agent
        else:
            unset_doc["voice_agent"] = ""

    if patch.tts_prompt_template is not None:
        tts_prompt_template = (patch.tts_prompt_template or "").strip()
        if tts_prompt_template:
            set_doc["tts_prompt_template"] = tts_prompt_template
        else:
            unset_doc["tts_prompt_template"] = ""

    if patch.tts_speed is not None:
        tts_speed = (patch.tts_speed or "").strip().lower()
        if tts_speed in ("slow", "normal", "fast"):
            set_doc["tts_speed"] = tts_speed
        else:
            unset_doc["tts_speed"] = ""

    if patch.tts_tone is not None:
        tts_tone = (patch.tts_tone or "").strip()
        if tts_tone:
            set_doc["tts_tone"] = tts_tone
        else:
            unset_doc["tts_tone"] = ""

    if patch.barge_in is not None:
        set_doc["barge_in"] = bool(patch.barge_in)

    update_payload: dict[str, Any] = {"$set": set_doc}
    if unset_doc:
        update_payload["$unset"] = {k: "" for k in unset_doc}

    await db.campaigns.update_one({"id": logical_id, "user_id": user_id}, update_payload)
    updated = await db.campaigns.find_one({"id": logical_id, "user_id": user_id})
    if not updated:
        raise HTTPException(status_code=404, detail="Campaign not found")
    out = _serialize_doc(updated)
    _normalize_campaign_public(out)
    _attach_campaign_prompt_metadata(out)
    return {"ok": True, "campaign": out}


async def upload_campaign_knowledge_text(
    campaign_id: str,
    user_id: str,
    *,
    text: str = "",
    filename: str | None = None,
    file_bytes: bytes | None = None,
) -> dict:
    """Upload plain-text knowledge directly into the campaign bot configuration."""
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id

    provided_text = (text or "").strip()
    uploaded_text = ""
    if file_bytes is not None:
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Empty text file upload.")
        max_bytes = max(1_000, _env_int("KNOWLEDGE_MAX_TEXT_BYTES", 1_000_000))
        if len(file_bytes) > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Text knowledge file too large. Max allowed size is {max_bytes // 1024} KB "
                    f"(received {len(file_bytes) // 1024} KB)."
                ),
            )
        clean_name = (filename or "knowledge.txt").strip() or "knowledge.txt"
        suffix = Path(clean_name).suffix.lower()
        allowed_suffixes = {"", ".txt", ".md", ".markdown", ".text"}
        if suffix not in allowed_suffixes:
            raise HTTPException(
                status_code=400,
                detail="Only plain text files are supported (.txt, .md, .markdown).",
            )
        try:
            uploaded_text = file_bytes.decode("utf-8-sig").strip()
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Text knowledge file must be UTF-8 encoded.",
            )

    final_text = uploaded_text or provided_text
    if not final_text:
        raise HTTPException(
            status_code=400,
            detail="Provide knowledge text or upload a non-empty text file.",
        )

    db = get_db()
    now = _utcnow()
    await db.campaigns.update_one(
        {"id": logical_id, "user_id": user_id},
        {
            "$set": {
                "bot_knowledge": final_text,
                "knowledge_source": "text",
                "knowledge_status": "none",
                "updated_at": now,
            },
            "$unset": {
                "knowledge_doc_ids": "",
            },
            "$inc": {"knowledge_version": 1},
        },
    )
    updated = await db.campaigns.find_one({"id": logical_id, "user_id": user_id})
    if not updated:
        raise HTTPException(status_code=404, detail="Campaign not found")

    out = _serialize_doc(updated)
    _normalize_campaign_public(out)
    return {
        "ok": True,
        "campaign_id": logical_id,
        "knowledge_source": "text",
        "knowledge_status": "none",
        "knowledge_chars": len(final_text),
        "campaign": out,
    }


async def upload_campaign_knowledge_pdf(
    campaign_id: str,
    user_id: str,
    *,
    filename: str,
    pdf_bytes: bytes,
    content_type: str | None = None,
) -> dict:
    """Upload a PDF for knowledge retrieval and enqueue async embedding ingestion."""
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty PDF upload.")
    max_bytes = max(1_000_000, config.int_setting("KNOWLEDGE_MAX_PDF_BYTES", 50_000_000))
    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"PDF too large. Max allowed size is {max_bytes // (1024 * 1024)} MB "
                f"(received {len(pdf_bytes) // (1024 * 1024)} MB)."
            ),
        )

    clean_name = (filename or "knowledge.pdf").strip() or "knowledge.pdf"
    lower_name = clean_name.lower()
    normalized_content_type = str(content_type or "").strip().lower()
    looks_like_pdf_mime = normalized_content_type == "application/pdf" or normalized_content_type.endswith("+pdf")
    looks_like_pdf = bytes(pdf_bytes[:5]) == b"%PDF-"
    if not lower_name.endswith(".pdf"):
        if looks_like_pdf or looks_like_pdf_mime:
            clean_name = f"{clean_name}.pdf"
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Only PDF files are supported. Upload a .pdf file. "
                    f"Received filename='{clean_name}', content_type='{normalized_content_type or 'unknown'}'."
                ),
            )

    db = get_db()
    now = _utcnow()
    doc_id = str(uuid4())
    job_id = str(uuid4())
    upload_path = _knowledge_upload_dir() / f"{doc_id}.pdf"
    try:
        upload_path.write_bytes(pdf_bytes)
    except Exception as exc:
        logger.error(f"Failed to store uploaded knowledge PDF on disk: {exc}")
        raise HTTPException(status_code=500, detail="Could not store uploaded PDF for processing.")

    doc = {
        "id": doc_id,
        "campaign_id": logical_id,
        "user_id": user_id,
        "filename": clean_name,
        "status": "queued",
        "upload_path": str(upload_path),
        "file_size_bytes": len(pdf_bytes),
        "created_at": now,
        "updated_at": now,
    }
    await db.knowledge_docs.insert_one(doc)
    await db.knowledge_jobs.insert_one(
        {
            "id": job_id,
            "campaign_id": logical_id,
            "doc_id": doc_id,
            "status": "queued",
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    await db.campaigns.update_one(
        {"id": logical_id, "user_id": user_id},
        {
            "$set": {
                "knowledge_source": "pdf_embedding",
                "knowledge_status": "queued",
                "updated_at": now,
            },
            "$addToSet": {"knowledge_doc_ids": doc_id},
            "$inc": {"knowledge_version": 1},
        },
    )

    from services.knowledge_ingestion_service import enqueue_knowledge_job

    await enqueue_knowledge_job(job_id)
    return {
        "ok": True,
        "campaign_id": logical_id,
        "knowledge_doc_id": doc_id,
        "knowledge_job_id": job_id,
        "status": "queued",
    }


async def get_campaign_knowledge_status(campaign_id: str, user_id: str) -> dict:
    """Get latest PDF knowledge ingestion status for a campaign."""
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id
    db = get_db()
    knowledge_source = str(campaign.get("knowledge_source") or "text")
    knowledge_status = str(campaign.get("knowledge_status") or "none")

    if knowledge_source != "pdf_embedding":
        return {
            "ok": True,
            "campaign_id": logical_id,
            "knowledge_source": knowledge_source,
            "knowledge_status": knowledge_status,
            "knowledge_version": int(campaign.get("knowledge_version") or 0),
            "latest_job": None,
            "documents": [],
        }

    latest_job = await db.knowledge_jobs.find_one(
        {"campaign_id": logical_id},
        sort=[("created_at", -1)],
    )
    active_docs = []
    async for doc in db.knowledge_docs.find(
        {"campaign_id": logical_id},
        {"id": 1, "filename": 1, "status": 1, "created_at": 1},
    ).sort("created_at", -1).limit(10):
        doc.pop("_id", None)
        active_docs.append(doc)

    return {
        "ok": True,
        "campaign_id": logical_id,
        "knowledge_source": knowledge_source,
        "knowledge_status": knowledge_status,
        "knowledge_version": int(campaign.get("knowledge_version") or 0),
        "latest_job": {
            "id": latest_job.get("id"),
            "status": latest_job.get("status"),
            "error": latest_job.get("error"),
            "updated_at": latest_job.get("updated_at"),
        }
        if latest_job
        else None,
        "documents": active_docs,
    }


# ---------------------------------------------------------------------------
# Start Campaign
# ---------------------------------------------------------------------------

_campaign_tasks: dict[str, asyncio.Task] = {}


def _is_terminal_status(value: str) -> bool:
    return str(value or "").lower() in {
        "completed", "failed", "ended_llm_failure", 
        "busy", "no-answer", "canceled", "status_timeout"
    }


def _max_call_wait_secs() -> int:
    return max(30, config.int_setting("SEQUENTIAL_CALL_MAX_WAIT_SECS", 180))


def _post_disconnect_call_delay_secs() -> int:
    return max(
        0,
        int(
            (
                config.setting("TELEPHONY_NEXT_CALL_DELAY_SECS")
                or config.setting("ISSABEL_NEXT_CALL_DELAY_SECS")
                or "5"
            ).strip()
        ),
    )


async def _call_had_customer_connection(db, call_id: str) -> bool:
    """True if the callee was on the line (audio path or SIP answered). Used to avoid redialing after they hang up."""
    doc = await db.call_sessions.find_one({"call_id": call_id})
    if not doc:
        return False
    return bool(
        doc.get("sip_joined_at")
        or doc.get("first_bot_audio_at")
        or doc.get("first_user_audio_at")
    )


async def _finalize_contact(campaign_id: str, contact: dict, *, success: bool):
    db = get_db()
    new_state = "completed" if success else "failed_after_retry"
    inc_field = "completed_contacts" if success else "failed_contacts"
    await db.campaign_contacts.update_one(
        {"_id": contact["_id"]}, {"$set": {"state": new_state, "updated_at": _utcnow()}}
    )
    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$inc": {inc_field: 1}, "$set": {"updated_at": _utcnow()}},
    )


async def _run_campaign(campaign_id: str):
    """Sequential dialer loop — called as a background asyncio Task."""
    from services import outbound_call_service  # avoid circular import at module load

    db = get_db()
    while True:
        contact = await db.campaign_contacts.find_one(
            {"campaign_id": campaign_id, "state": "pending"},
            sort=[("sequence_no", 1)],
        )
        if not contact:
            await db.campaigns.update_one(
                {"id": campaign_id},
                {"$set": {"status": "completed", "updated_at": _utcnow()}},
            )
            logger.info(f"Campaign {campaign_id} completed.")
            break

        await db.campaign_contacts.update_one(
            {"_id": contact["_id"]},
            {"$set": {"state": "calling", "updated_at": _utcnow()}},
        )
        attempt_no = int(contact.get("retry_count", 0))
        campaign_row = await db.campaigns.find_one({"id": campaign_id})
        knowledge_source = str((campaign_row or {}).get("knowledge_source") or "text")
        knowledge_status = str((campaign_row or {}).get("knowledge_status") or "none")
        # Keep call metadata small: don't carry full text KB when PDF retrieval is active.
        include_text_knowledge = not (
            knowledge_source == "pdf_embedding" and knowledge_status == "ready"
        )
        bot_config = {
            "collect_fields": (campaign_row or {}).get("collect_fields") or [],
            "bot_system_prompt": _campaign_prompt_override(campaign_row or {}) or None,
            "bot_knowledge": (campaign_row or {}).get("bot_knowledge") if include_text_knowledge else None,
            "initial_greeting": (campaign_row or {}).get("initial_greeting"),
            "voice_agent": (campaign_row or {}).get("voice_agent"),
            "tts_language": (campaign_row or {}).get("tts_language"),
            "tts_prompt_template": (campaign_row or {}).get("tts_prompt_template"),
            "tts_speed": (campaign_row or {}).get("tts_speed"),
            "tts_tone": (campaign_row or {}).get("tts_tone"),
            "barge_in": (campaign_row or {}).get("barge_in"),
            "knowledge_source": knowledge_source,
            "knowledge_status": knowledge_status,
            "knowledge_doc_ids": (campaign_row or {}).get("knowledge_doc_ids") or [],
            "knowledge_version": int((campaign_row or {}).get("knowledge_version") or 0),
        }

        context = {
            "campaign_id": campaign_id,
            "campaign_contact_id": str(contact["_id"]),
            "retry_count": attempt_no,
            "user_id": contact["user_id"],
            "bot_config": bot_config,
        }
        customer_name = (
            contact.get("csv_payload", {}).get("customer_name")
            or contact.get("csv_payload", {}).get("name")
            or "Customer"
        )
        request = OutboundCallRequest(
            phone_number=contact["phone_e164"],
            customer_name=customer_name,
            customer_id=str(contact["_id"]),
            verification_context=context,
        )

        try:
            response = await outbound_call_service.initiate_outbound_call(request)
            call_id = response["call_id"]
        except Exception as exc:
            logger.error(f"Campaign {campaign_id}: failed to initiate call for {contact['phone_e164']}: {exc}")
            await _finalize_contact(campaign_id, contact, success=False)
            continue

        started_wait_at = _utcnow()
        while True:
            await asyncio.sleep(2)
            elapsed = (_utcnow() - started_wait_at).total_seconds()
            if elapsed >= _max_call_wait_secs():
                await db.call_sessions.update_one(
                    {"call_id": call_id},
                    {
                        "$set": {
                            "status": "failed",
                            "ended_at": _utcnow(),
                            "end_reason": "status_timeout",
                        }
                    },
                )
                # Do not redial if the customer was already connected (they hung up or we lost sync).
                if attempt_no == 0 and not await _call_had_customer_connection(db, call_id):
                    await db.campaign_contacts.update_one(
                        {"_id": contact["_id"]},
                        {"$set": {"state": "pending"}, "$inc": {"retry_count": 1}},
                    )
                else:
                    await _finalize_contact(campaign_id, contact, success=False)
                break

            try:
                status = await outbound_call_service.check_call_status(call_id)
            except Exception:
                status = None
            if not status:
                doc = await db.call_sessions.find_one({"call_id": call_id})
                if doc and _is_terminal_status(str(doc.get("status") or "")):
                    status = outbound_call_service._call_status_from_info(call_id, doc)
            if not status:
                continue

            await db.call_sessions.update_one(
                {"call_id": call_id},
                {
                    "$set": {
                        "status": status.status,
                        "ended_at": status.ended_at,
                        "end_reason": "completed" if status.status == "completed" else None,
                    }
                },
            )

            if not _is_terminal_status(status.status):
                continue

            call_info = outbound_call_service.active_calls.get(call_id) or {}
            if call_info.get("provider") in {"issabel-sip", "exotel"}:
                await asyncio.sleep(_post_disconnect_call_delay_secs())

            if status.status == "completed":
                await _finalize_contact(campaign_id, contact, success=True)
                break

            # Auto-redial only for a true "no answer" (rang, nobody picked up). Do not redial on
            # failed (busy, 503/401, user hang-up, SIP errors): those are one-and-done for this campaign step.
            if attempt_no == 0 and status.status == "no-answer":
                await db.campaign_contacts.update_one(
                    {"_id": contact["_id"]},
                    {"$set": {"state": "pending"}, "$inc": {"retry_count": 1}},
                )
                break
            if attempt_no == 0 and status.status in {"failed", "status_timeout"}:
                await _finalize_contact(campaign_id, contact, success=False)
                break

            await _finalize_contact(campaign_id, contact, success=False)
            break


def start_campaign_runner(campaign_id: str):
    """Idempotent — won't start a second runner if one is active."""
    existing = _campaign_tasks.get(campaign_id)
    if existing and not existing.done():
        logger.info(f"Campaign {campaign_id} runner already active — skipping.")
        return
    task = asyncio.create_task(
        _run_campaign(campaign_id), name=f"campaign:{campaign_id}"
    )
    _campaign_tasks[campaign_id] = task
    logger.info(f"Campaign runner started for {campaign_id}")


async def start_campaign(campaign_id: str, user_id: str) -> dict:
    """Validate, mark running in DB, then fire the background runner."""
    db = get_db()
    campaign = await _resolve_campaign(campaign_id, user_id)
    logical_id = campaign.get("id") or campaign_id

    fields = campaign.get("collect_fields")
    if not isinstance(fields, list) or len(fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="Configure collect_fields (at least one) before starting the campaign.",
        )
    if not _effective_system_prompt(campaign):
        raise HTTPException(
            status_code=400,
            detail="System prompt is empty. Set SYSTEM_PROMPT_FILE / prompts/system.txt or save campaign bot_system_prompt.",
        )
    if str(campaign.get("knowledge_source") or "text") == "pdf_embedding":
        status = str(campaign.get("knowledge_status") or "none")
        if status != "ready":
            raise HTTPException(
                status_code=400,
                detail="Campaign PDF knowledge is not ready yet. Upload and wait for embedding ingestion to complete.",
            )

    await db.campaigns.update_one(
        {"_id": campaign["_id"]},
        {"$set": {"status": "running", "id": logical_id, "updated_at": _utcnow()}},
    )
    start_campaign_runner(logical_id)
    return {"ok": True, "campaign_id": logical_id, "status": "running"}
