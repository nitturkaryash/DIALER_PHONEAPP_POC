from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.voice_preview_service import get_or_create_voice_sample_url
from services.voice_preview_service import list_voice_preview_entries
from utils.jwt_auth import current_user


router = APIRouter(prefix="/api/voices", tags=["voices"])


class VoicePreviewRequest(BaseModel):
    voice_name: str = Field(min_length=1)
    text: str = Field(min_length=1)


@router.get("")
async def list_voice_previews(
    _user: dict = Depends(current_user),
):
    previews = []
    for entry in await list_voice_preview_entries():
        previews.append(
            {
                "id": entry.get("id"),
                "voice_name": entry.get("voice_name"),
                "text": entry.get("text"),
                "audio_url": entry.get("url"),
                "s3_key": entry.get("s3_key"),
                "updated_at": entry.get("updated_at"),
            }
        )
    return {"count": len(previews), "previews": previews}


@router.post("/sample")
async def generate_voice_sample_audio(
    body: VoicePreviewRequest,
    _user: dict = Depends(current_user),
):
    try:
        preview = await get_or_create_voice_sample_url(
            voice_name=body.voice_name,
            text=body.text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return preview
