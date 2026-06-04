import re
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.audio import remux_faststart, should_faststart
from app.services.job_store import (
    dashboard_overview,
    get_job_record,
    get_transcriber_by_code,
    list_client_jobs,
    list_transcriber_jobs,
    mark_transcript_saved,
    serialize_job,
    set_job_status,
)
from app.services.pdf_export import build_transcript_pdf
from app.services.r2 import (
    get_object_bytes,
    get_transcript_json,
    get_voice_object_key,
    put_object_bytes,
    save_transcript_json,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class SaveTranscriptRequest(BaseModel):
    transcript_json: dict


class JobStatusUpdateRequest(BaseModel):
    status: str
    note: str | None = None


class ExportTranscriptPdfRequest(BaseModel):
    transcript_json: dict | None = None


def _media_type(voice_key: str) -> str:
    if voice_key.endswith(".m4a"):
        return "audio/mp4"
    if voice_key.endswith(".mp3"):
        return "audio/mpeg"
    if voice_key.endswith(".wav"):
        return "audio/wav"
    return "application/octet-stream"


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


@router.get("")
def list_jobs(db: Annotated[Session, Depends(get_db)]) -> dict:
    return {"jobs": list_client_jobs(db)}


@router.get("/admin/overview")
def admin_overview(db: Annotated[Session, Depends(get_db)]) -> dict:
    return dashboard_overview(db)


@router.get("/admin/transcribers")
def admin_transcribers(db: Annotated[Session, Depends(get_db)]) -> dict:
    return {"transcribers": dashboard_overview(db)["transcribers"]}


@router.get("/transcriber/assigned")
def list_transcriber_assigned_jobs(
    db: Annotated[Session, Depends(get_db)],
    transcriber_code: str = Query("TR-001"),
) -> dict:
    return {"jobs": list_transcriber_jobs(db, transcriber_code)}


@router.get("/transcriber/profile")
def transcriber_profile(
    db: Annotated[Session, Depends(get_db)],
    transcriber_code: str = Query("TR-001"),
) -> dict:
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    return {
        "id": transcriber.id,
        "code": transcriber.transcriber_code,
        "name": transcriber.name,
        "specialty": transcriber.specialty,
        "status": transcriber.status,
        "monthly_capacity": transcriber.monthly_capacity,
        "current_load": transcriber.current_load,
        "unit_price": float(transcriber.unit_price or 0),
        "quality_score": float(transcriber.quality_score or 0),
    }


@router.get("/{job_id}")
def get_job(job_id: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    transcript = get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in database")

    return serialize_job(job, transcript_json=transcript, audio_url=f"/api/jobs/{job_id}/audio")


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
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        transcript_key = save_transcript_json(job_id, body.transcript_json)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    job = get_job_record(db, job_id)
    if job is not None:
        mark_transcript_saved(db, job, transcript_key, body.transcript_json)

    return {"job_id": job_id, "status": "saved", "transcript_key": transcript_key}


@router.post("/{job_id}/status")
def update_job_status(
    job_id: str,
    body: JobStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    job = set_job_status(db, job, body.status, body.note)
    return {"job_id": job.job_id, "status": job.status}
