from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.r2 import create_voice_upload_url

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/flac",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "application/octet-stream",
}


class PresignRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream")


class PresignResponse(BaseModel):
    job_id: str
    object_key: str
    upload_url: str
    expires_in: int
    bucket: str


@router.post("/presign", response_model=PresignResponse)
def presign_upload(body: PresignRequest) -> PresignResponse:
    content_type = body.content_type.split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

    try:
        result = create_voice_upload_url(body.filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"R2 presign failed: {exc}") from exc

    return PresignResponse(**result)
