import re
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies.member_auth import get_optional_current_member
from app.models.admin_models import Member
from app.db import ensure_db_initialized, get_db, get_engine
from app.services.audio import remux_faststart, should_faststart
from app.services.admin_events import publish_admin_event, stream_admin_events
from app.services.database_migrate import run_sql_migration
from app.services.database_reset import purge_all_data, reset_database_schema
from app.services.job_store import (
    assign_job,
    create_transcriber,
    dashboard_overview,
    generate_transcriber_code,
    delete_job_if_unassigned,
    delete_transcriber,
    get_job_record,
    get_invoice_record,
    get_settlement_record,
    get_transcriber_by_code,
    list_client_jobs,
    list_transcriber_jobs,
    mark_final_pdf_saved,
    mark_transcript_saved,
    serialize_job,
    set_job_status,
    update_invoice_status,
    update_settlement_status,
    update_transcriber,
)
from app.services.pdf_export import build_transcript_pdf
from app.services.transcriber_auth import TranscriberAuthError, revoke_transcriber_auth
from app.services.r2 import (
    create_download_url,
    delete_object,
    get_object_bytes,
    get_transcript_json,
    get_voice_object_key,
    put_object_bytes,
    save_final_pdf,
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


class JobAssignRequest(BaseModel):
    transcriber_code: str
    note: str | None = None


class AdminTranscriberUpdateRequest(BaseModel):
    name: str | None = None
    specialty: str | None = None
    phone: str | None = None
    resident_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    unit_price: float | None = None
    monthly_capacity: int | None = None
    status: str | None = None


class DatabaseResetRequest(BaseModel):
    confirm: str


class AdminTranscriberCreateRequest(BaseModel):
    code: str | None = None
    name: str
    specialty: str | None = None
    email: str | None = None
    phone: str | None = None
    resident_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    unit_price: float = 0
    monthly_capacity: int | None = None
    status: str = "available"


class SettlementStatusUpdateRequest(BaseModel):
    status: str


class InvoiceStatusUpdateRequest(BaseModel):
    status: str


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
def list_jobs(
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    return {"jobs": list_client_jobs(db, member=member)}


@router.delete("/{job_id}")
def cancel_client_job(job_id: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status not in {"uploaded", "waiting_assignment"} or job.assigned_transcriber_id is not None:
        raise HTTPException(status_code=409, detail="배정 전 업로드만 취소할 수 있습니다")

    object_keys = [key for key in [job.r2_voice_key, job.r2_transcript_key, job.final_pdf_r2_key] if key]
    try:
        for object_key in object_keys:
            delete_object(object_key)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"파일 삭제 실패: {exc}") from exc

    try:
        delete_job_if_unassigned(db, job)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    publish_admin_event("job_deleted", {"job_id": job_id})
    return {"job_id": job_id, "deleted": True}


@router.post("/admin/maintenance/migrate-transcriber-profile")
def admin_migrate_transcriber_profile(request: Request) -> dict:
    token = settings.maintenance_reset_token.strip()
    if token and request.headers.get("X-Maintenance-Token") != token:
        raise HTTPException(status_code=403, detail="Invalid maintenance token")
    try:
        ensure_db_initialized()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    db_engine = get_engine()
    if db_engine is None:
        raise HTTPException(status_code=503, detail="Database is not configured")

    sql_path = Path(__file__).resolve().parents[2] / "scripts" / "migrate_transcriber_profile.sql"
    run_sql_migration(db_engine, sql_path)
    return {"migrated": True, "file": sql_path.name}


def _validate_maintenance_request(request: Request, body: DatabaseResetRequest) -> None:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail="confirm must be RESET")
    token = settings.maintenance_reset_token.strip()
    if token and request.headers.get("X-Maintenance-Token") != token:
        raise HTTPException(status_code=403, detail="Invalid maintenance token")


@router.post("/admin/maintenance/purge-data")
def admin_purge_data(
    request: Request,
    body: DatabaseResetRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    _validate_maintenance_request(request, body)
    purge_all_data(db.get_bind())
    publish_admin_event("database_purged", {"status": "completed"})
    return {"purged": True}


@router.post("/admin/maintenance/reset-database")
def admin_reset_database(request: Request, body: DatabaseResetRequest) -> dict:
    _validate_maintenance_request(request, body)
    try:
        ensure_db_initialized()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    db_engine = get_engine()
    if db_engine is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    reset_database_schema(db_engine)
    publish_admin_event("database_reset", {"status": "completed"})
    return {"reset": True}


@router.get("/admin/overview")
def admin_overview(db: Annotated[Session, Depends(get_db)]) -> dict:
    return dashboard_overview(db)


@router.get("/admin/events")
def admin_events() -> StreamingResponse:
    return StreamingResponse(
        stream_admin_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/admin/transcribers")
def admin_transcribers(db: Annotated[Session, Depends(get_db)]) -> dict:
    return {"transcribers": dashboard_overview(db)["transcribers"]}


@router.post("/admin/jobs/{job_id}/assign")
def admin_assign_job(
    job_id: str,
    body: JobAssignRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        job = assign_job(db, job, transcriber_code=body.transcriber_code, note=body.note)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    publish_admin_event("job_assigned", {"job_id": job.job_id})
    return {"job_id": job.job_id, "status": job.status, "assigned_transcriber_id": job.assigned_transcriber_id}


@router.get("/admin/transcribers/next-code")
def admin_next_transcriber_code(db: Annotated[Session, Depends(get_db)]) -> dict:
    return {"code": generate_transcriber_code(db)}


@router.patch("/admin/transcribers/{transcriber_code}")
def admin_update_transcriber(
    transcriber_code: str,
    body: AdminTranscriberUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    try:
        transcriber = update_transcriber(
            db,
            transcriber,
            name=body.name,
            specialty=body.specialty,
            phone=body.phone,
            resident_id=body.resident_id,
            bank_name=body.bank_name,
            account_number=body.account_number,
            unit_price=body.unit_price,
            monthly_capacity=body.monthly_capacity,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish_admin_event("transcriber_updated", {"transcriber_code": transcriber.transcriber_code})
    return {
        "code": transcriber.transcriber_code,
        "name": transcriber.name,
        "status": transcriber.status,
        "specialty": transcriber.specialty,
        "monthly_capacity": transcriber.monthly_capacity,
        "unit_price": float(transcriber.unit_price or 0),
    }


@router.post("/admin/transcribers")
def admin_create_transcriber(
    body: AdminTranscriberCreateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    try:
        transcriber = create_transcriber(
            db,
            code=body.code,
            name=body.name,
            specialty=body.specialty,
            email=body.email,
            phone=body.phone,
            resident_id=body.resident_id,
            bank_name=body.bank_name,
            account_number=body.account_number,
            unit_price=body.unit_price,
            monthly_capacity=body.monthly_capacity,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish_admin_event("transcriber_created", {"transcriber_code": transcriber.transcriber_code})
    return {
        "code": transcriber.transcriber_code,
        "name": transcriber.name,
        "status": transcriber.status,
        "specialty": transcriber.specialty,
        "monthly_capacity": transcriber.monthly_capacity,
        "unit_price": float(transcriber.unit_price or 0),
    }


@router.post("/admin/transcribers/{transcriber_code}/revoke-auth")
def admin_revoke_transcriber_auth(
    transcriber_code: str,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    try:
        transcriber = revoke_transcriber_auth(db, transcriber)
    except TranscriberAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_admin_event("transcriber_auth_revoked", {"transcriber_code": transcriber_code})
    return {
        "code": transcriber.transcriber_code,
        "auth_status": transcriber.auth_status,
        "revoked": True,
    }


@router.delete("/admin/transcribers/{transcriber_code}")
def admin_delete_transcriber(
    transcriber_code: str,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    try:
        delete_transcriber(db, transcriber)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"속기사 삭제 실패: {exc}") from exc
    publish_admin_event("transcriber_deleted", {"transcriber_code": transcriber_code})
    return {"code": transcriber_code, "deleted": True}


@router.post("/admin/settlements/{settlement_id}/status")
def admin_update_settlement(
    settlement_id: int,
    body: SettlementStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    settlement = get_settlement_record(db, settlement_id)
    if settlement is None:
        raise HTTPException(status_code=404, detail="Settlement not found")
    settlement = update_settlement_status(db, settlement, body.status)
    publish_admin_event("settlement_updated", {"settlement_id": settlement.id})
    return {"id": settlement.id, "status": settlement.status}


@router.post("/admin/invoices/{invoice_id}/status")
def admin_update_invoice(
    invoice_id: int,
    body: InvoiceStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    invoice = get_invoice_record(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = update_invoice_status(db, invoice, body.status)
    publish_admin_event("invoice_updated", {"invoice_id": invoice.id})
    return {"id": invoice.id, "status": invoice.invoice_status}


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

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in database")

    transcript = get_transcript_json(job_id) or {
        "filename": job.original_filename,
        "text": "",
        "plain_text": "",
        "segments": [],
        "tokens": [],
        "speaker_labels": {},
    }

    return serialize_job(db, job, transcript_json=transcript, audio_url=f"/api/jobs/{job_id}/audio")


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


@router.post("/{job_id}/transcript.pdf/finalize")
def finalize_transcript_pdf(
    job_id: str,
    body: ExportTranscriptPdfRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    _ensure_job_exists(job_id)
    transcript = body.transcript_json or get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        pdf_bytes, filename = build_transcript_pdf(transcript)
        pdf_key, stored_filename = save_final_pdf(job_id, pdf_bytes, filename)
        mark_final_pdf_saved(db, job, pdf_key, stored_filename)
        publish_admin_event("job_updated", {"job_id": job_id, "status": "pdf_sent"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Final PDF save failed: {exc}") from exc

    return {
        "job_id": job_id,
        "status": "pdf_sent",
        "final_pdf_key": pdf_key,
        "filename": stored_filename,
        "download_url": f"/api/jobs/{job_id}/transcript.pdf/final",
    }


@router.get("/{job_id}/transcript.pdf/final")
def download_final_transcript_pdf(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.final_pdf_r2_key:
        raise HTTPException(status_code=404, detail="Final PDF is not ready")

    try:
        pdf_bytes = get_object_bytes(job.final_pdf_r2_key)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Final PDF load failed: {exc}") from exc

    filename = job.final_pdf_filename or "final_transcript.pdf"
    encoded = quote(filename)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded}",
            "Cache-Control": "no-cache",
        },
    )


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
        publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

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
    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": job.status}
