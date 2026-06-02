from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_optional_db
from app.services.r2 import get_object_bytes, get_object_metadata, get_voice_object_key
from app.services.transcript_history import save_transcript_with_optional_history
from app.services.soniox import transcribe_upload
router = APIRouter(prefix="/api", tags=["transcribe"])

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4"}


@router.post("/test/transcribe")
async def test_transcribe(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        result = transcribe_upload(
            content,
            file.filename,
            (file.content_type or "application/octet-stream").split(";")[0].strip().lower(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    return {
        "status": "AI_DONE",
        "transcript_json": result,
    }


@router.post("/transcribe/job/{job_id}")
def transcribe_job(
    job_id: str,
    db: Annotated[Session | None, Depends(get_optional_db)],
) -> dict:
    if not settings.soniox_api_key:
        raise HTTPException(status_code=503, detail="SONIOX_API_KEY is not configured")

    try:
        voice_key = get_voice_object_key(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"R2 lookup failed: {exc}") from exc

    if not voice_key:
        raise HTTPException(status_code=404, detail=f"Voice file not found for job: {job_id}")

    filename = voice_key.rsplit("/", 1)[-1]

    try:
        metadata = get_object_metadata(voice_key)
        content = get_object_bytes(voice_key)
        transcript_json = transcribe_upload(
            content,
            filename,
            metadata.get("content_type", "audio/x-m4a"),
        )
        saved = save_transcript_with_optional_history(
            db,
            job_id,
            transcript_json,
            change_summary="AI transcription",
        )
        transcript_key = saved["transcript_key"]
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    return {
        "status": "AI_DONE",
        "job_id": job_id,
        "voice_key": voice_key,
        "transcript_key": transcript_key,
        "transcript_text": transcript_json.get("text", ""),
        "transcript_json": transcript_json,
    }
