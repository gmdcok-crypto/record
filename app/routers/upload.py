from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.r2 import create_voice_upload_url

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4", ".aac", ".wma"}

ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/x-aac",
    "audio/flac",
    "audio/x-flac",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/octet-stream",
}


def is_allowed_upload(content_type: str, filename: str) -> bool:
    ct = content_type.split(";")[0].strip().lower()
    if ct in ALLOWED_CONTENT_TYPES or ct.startswith("audio/"):
        return True
    if ct in {"video/mp4", "video/webm", "video/quicktime"}:
        return True
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_EXTENSIONS


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
    if not is_allowed_upload(content_type, body.filename):
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
