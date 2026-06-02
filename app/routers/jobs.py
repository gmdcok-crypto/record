import re
from typing import Annotated

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_optional_db
from app.services.audio import remux_faststart, should_faststart
from app.services.pdf_export import build_transcript_pdf
from app.services.r2 import (
    get_object_bytes,
    get_transcript_json,
    get_voice_object_key,
    put_object_bytes,
)
from app.services.transcript_history import (
    get_transcript_revision,
    list_transcript_history,
    restore_transcript_revision,
    save_transcript_with_optional_history,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class SaveTranscriptRequest(BaseModel):
    transcript_json: dict
    editor: str | None = Field(default=None, max_length=100)
    change_summary: str | None = Field(default=None, max_length=500)


class RestoreTranscriptRequest(BaseModel):
    editor: str | None = Field(default=None, max_length=100)


def _media_type(voice_key: str) -> str:
    if voice_key.endswith(".m4a"):
        return "audio/mp4"
    if voice_key.endswith(".mp3"):
        return "audio/mpeg"
    if voice_key.endswith(".wav"):
        return "audio/wav"
    return "application/octet-stream"


@router.get("/{job_id}")
def get_job(job_id: str) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    transcript = get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    return {
        "job_id": job_id,
        "voice_key": voice_key,
        "transcript_key": f"text/{job_id}/transcript.json",
        "audio_url": f"/api/jobs/{job_id}/audio",
        "transcript_json": transcript,
        "history_enabled": settings.database_configured,
    }


@router.get("/{job_id}/audio")
def stream_audio(job_id: str, request: Request) -> Response:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        content = get_object_bytes(voice_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to load audio: {exc}") from exc

    if should_faststart(content, voice_key):
        remuxed = remux_faststart(content)
        if remuxed:
            content = remuxed
            try:
                put_object_bytes(voice_key, content, _media_type(voice_key))
            except Exception:
                pass

    media_type = _media_type(voice_key)
    file_size = len(content)
    range_header = request.headers.get("range")

    if range_header:
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else file_size - 1
            end = min(end, file_size - 1)
            if start <= end:
                return Response(
                    content=content[start : end + 1],
                    status_code=206,
                    media_type=media_type,
                    headers={
                        "Accept-Ranges": "bytes",
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Content-Length": str(end - start + 1),
                        "Cache-Control": "no-cache",
                    },
                )

    return Response(
        content=content,
        status_code=200,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Cache-Control": "no-cache",
        },
    )


class ExportTranscriptPdfRequest(BaseModel):
    transcript_json: dict | None = None


def _pdf_response(transcript: dict) -> Response:
    try:
        pdf_bytes, filename = build_transcript_pdf(transcript)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc

    encoded = quote(filename)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"transcript.pdf\"; filename*=UTF-8''{encoded}",
            "Cache-Control": "no-cache",
        },
    )


def _ensure_job_exists(job_id: str) -> None:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")


@router.get("/{job_id}/transcript.pdf")
def export_transcript_pdf_get(job_id: str) -> Response:
    _ensure_job_exists(job_id)
    transcript = get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return _pdf_response(transcript)


@router.post("/{job_id}/transcript.pdf")
def export_transcript_pdf_post(job_id: str, body: ExportTranscriptPdfRequest) -> Response:
    _ensure_job_exists(job_id)
    transcript = body.transcript_json or get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return _pdf_response(transcript)


@router.put("/{job_id}/transcript")
def save_transcript(
    job_id: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        result = save_transcript_with_optional_history(
            db,
            job_id,
            body.transcript_json,
            editor=body.editor,
            change_summary=body.change_summary or "편집 저장",
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    return {"job_id": job_id, "status": "saved", **result}


@router.get("/{job_id}/history")
def get_transcript_history_list(
    job_id: str,
    db: Annotated[Session | None, Depends(get_optional_db)],
) -> dict:
    if not settings.database_configured or db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")

    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    return {"job_id": job_id, "history": list_transcript_history(db, job_id)}


@router.get("/{job_id}/history/{revision_id}")
def get_transcript_history_detail(
    job_id: str,
    revision_id: str,
    db: Annotated[Session | None, Depends(get_optional_db)],
) -> dict:
    if not settings.database_configured or db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")

    try:
        detail = get_transcript_revision(db, job_id, revision_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to load revision: {exc}") from exc

    if not detail:
        raise HTTPException(status_code=404, detail="Revision not found")

    return {"job_id": job_id, **detail}


@router.post("/{job_id}/history/{revision_id}/restore")
def restore_transcript_history(
    job_id: str,
    revision_id: str,
    body: RestoreTranscriptRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
) -> dict:
    if not settings.database_configured or db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")

    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        result = restore_transcript_revision(
            db,
            job_id,
            revision_id,
            editor=body.editor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Restore failed: {exc}") from exc

    return {"job_id": job_id, "status": "restored", **result}
