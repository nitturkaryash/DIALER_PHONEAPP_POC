"""Thin router for campaign endpoints."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from models.campaigns import CampaignBotConfigPatch, CampaignCollectField
from services import campaign_service
from utils.jwt_auth import current_user


router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


@router.post("/upload-csv")
async def upload_csv_campaign(
    name: str = Form(...),
    initial_greeting: str = Form(""),
    voice_agent: str = Form(""),
    tts_language: str = Form(""),
    tts_prompt_template: str = Form(""),
    tts_speed: str = Form(""),
    tts_tone: str = Form(""),
    barge_in: bool = Form(False),
    bot_system_prompt: str = Form(""),
    collect_fields: str = Form("[]"),
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a CSV file.")

    content = await file.read()
    try:
        raw_fields = json.loads(collect_fields or "[]")
        parsed_fields = [CampaignCollectField.model_validate(item) for item in (raw_fields or [])]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid collect_fields payload: {exc}")

    campaign = await campaign_service.create_campaign_from_csv(
        user_id=user.get("id", ""),
        name=name,
        initial_greeting=initial_greeting,
        voice_agent=voice_agent,
        tts_language=tts_language,
        tts_prompt_template=tts_prompt_template,
        tts_speed=tts_speed,
        tts_tone=tts_tone,
        barge_in=barge_in,
        bot_system_prompt=bot_system_prompt,
        collect_fields=parsed_fields,
        csv_bytes=content,
    )
    return {"ok": True, "campaign": campaign}


@router.get("")
async def list_campaigns(
    page: int = 1,
    limit: int = 20,
    user: dict = Depends(current_user),
):
    campaigns_data = await campaign_service.list_campaigns(
        user_id=user.get("id", ""),
        page=page,
        limit=limit,
    )
    return {"ok": True, **campaigns_data}


@router.get("/{campaign_id}")
async def campaign_detail(
    campaign_id: str,
    page: int = 1,
    limit: int = 20,
    user: dict = Depends(current_user),
):
    return await campaign_service.get_campaign_detail(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
        page=page,
        limit=limit,
    )


@router.get("/{campaign_id}/collected-params.csv")
async def download_campaign_collected_params_csv(
    campaign_id: str,
    user: dict = Depends(current_user),
):
    return await campaign_service.download_campaign_collected_params_csv(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
    )


@router.patch("/{campaign_id}")
async def patch_campaign_bot_config(
    campaign_id: str,
    body: CampaignBotConfigPatch,
    user: dict = Depends(current_user),
):
    return await campaign_service.update_campaign_bot_config(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
        patch=body,
    )


@router.post("/{campaign_id}/start")
async def start_campaign(campaign_id: str, user: dict = Depends(current_user)):
    return await campaign_service.start_campaign(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
    )


@router.post("/{campaign_id}/knowledge/pdf")
async def upload_campaign_knowledge_pdf(
    campaign_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    content = await file.read()
    return await campaign_service.upload_campaign_knowledge_pdf(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
        filename=file.filename or "knowledge.pdf",
        pdf_bytes=content,
        content_type=file.content_type,
    )


@router.post("/{campaign_id}/knowledge/text")
async def upload_campaign_knowledge_text(
    campaign_id: str,
    text: str = Form(""),
    file: UploadFile | None = File(None),
    user: dict = Depends(current_user),
):
    file_bytes = await file.read() if file else None
    return await campaign_service.upload_campaign_knowledge_text(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
        text=text,
        filename=file.filename if file else None,
        file_bytes=file_bytes,
    )


@router.get("/{campaign_id}/knowledge/status")
async def campaign_knowledge_status(campaign_id: str, user: dict = Depends(current_user)):
    return await campaign_service.get_campaign_knowledge_status(
        campaign_id=campaign_id,
        user_id=user.get("id", ""),
    )
