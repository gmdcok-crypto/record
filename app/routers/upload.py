from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.config import settings
from app.services.audio import remux_faststart, should_faststart
from app.services.r2 import (
    create_voice_upload_url,
    ensure_filename_with_extension,
    get_object_bytes,
    get_voice_object_key,
    save_transcript_json,
    upload_voice_bytes,
)
from app.services.soniox import transcribe_upload

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


def run_transcription(
    job_id: str,
    content: bytes,
    filename: str,
    content_type: str,
) -> dict:
    transcript_json = transcribe_upload(content, filename, content_type)
    transcript_key = save_transcript_json(job_id, transcript_json)
    return {
        "status": "AI_DONE",
        "transcript_text": transcript_json.get("text", ""),
        "transcript_key": transcript_key,
        "transcript_json": transcript_json,
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


class VoiceUploadResponse(BaseModel):
    job_id: str
    object_key: str
    bucket: str
    status: str
    transcript_text: str | None = None
    transcript_key: str | None = None
    transcript_json: dict | None = None
    error: str | None = None


@router.post("/voice", response_model=VoiceUploadResponse)
async def upload_voice(file: UploadFile = File(...)) -> VoiceUploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if not is_allowed_upload(content_type, file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    safe_name = ensure_filename_with_extension(file.filename, content_type)
    if should_faststart(content, safe_name):
        remuxed = remux_faststart(content)
        if remuxed:
            content = remuxed

    try:
        upload_result = upload_voice_bytes(content, file.filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {exc}") from exc

    response = VoiceUploadResponse(
        job_id=upload_result["job_id"],
        object_key=upload_result["object_key"],
        bucket=upload_result["bucket"],
        status="UPLOADED",
    )

    if not settings.soniox_api_key:
        response.error = "SONIOX_API_KEY is not configured"
        return response

    try:
        transcription = run_transcription(
            upload_result["job_id"],
            content,
            upload_result.get("filename", file.filename),
            content_type,
        )
        response.status = transcription["status"]
        response.transcript_text = transcription["transcript_text"]
        response.transcript_key = transcription["transcript_key"]
        response.transcript_json = transcription["transcript_json"]
    except ValueError as exc:
        response.status = "AI_FAILED"
        response.error = str(exc)
    except Exception as exc:
        response.status = "AI_FAILED"
        response.error = f"Transcription failed: {exc}"

    return response


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
