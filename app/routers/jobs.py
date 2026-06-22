import logging
import re
from pathlib import Path
from datetime import date, datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import DataError, DBAPIError
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies.member_auth import get_current_member, get_optional_current_member
from app.dependencies.transcriber_auth import get_current_transcriber, get_optional_current_transcriber
from app.dependencies.admin_auth import AdminAuth, AdminEventAuth, OptionalAdminAuth
from app.models.admin_models import AdminUser, Client, Job, Member, SettlementItem, Transcriber
from app.db import ensure_db_initialized, get_db, get_engine
from app.services.audio import remux_faststart, should_faststart
from app.services.admin_events import publish_admin_event, stream_admin_events
from app.services.database_migrate import ensure_jobs_status_column, run_sql_migration
from app.services.database_reset import purge_all_data, reset_database_schema
from app.services.project_store import get_project_record, list_project_jobs, list_projects, list_transcriber_projects
from app.services.job_store import (
    assign_job,
    create_transcriber,
    delete_transcriber_grade_rate,
    dashboard_overview,
    generate_transcriber_code,
    delete_job_if_unassigned,
    delete_transcriber,
    get_job_record,
    get_invoice_record,
    confirm_settlement_snapshot,
    get_settlement_record,
    get_or_create_client_for_member,
    get_transcriber_by_code,
    list_client_jobs,
    list_settlement_snapshots,
    list_transcriber_grade_rates,
    list_transcribers,
    list_transcriber_jobs,
    mark_final_pdf_delivered,
    empty_transcript_json,
    mark_transcript_saved,
    record_settlement_payment,
    repair_job_settlement,
    serialize_job,
    store_final_pdf,
    set_job_status,
    TRANSCRIBER_DRAFT_STATUSES,
    transcriber_can_view_job_transcript,
    transcript_visible_to_client,
    upsert_transcriber_grade_rate,
    update_invoice_status,
    update_settlement_status,
    update_transcriber,
)
from app.services.transcript_shares import (
    SHARE_EXPIRE_DAYS,
    create_transcript_share,
    deactivate_transcript_share,
    get_transcript_share_by_token,
    transcript_share_is_valid,
)
from app.services.pdf_export import build_project_bundle_pdf, build_transcript_pdf, filter_transcript_to_selected_segments
from app.services.member_auth import get_member_by_id, serialize_member_admin, set_member_active
from app.services.member_auth import list_members_admin
from app.services.job_transcription import transcribe_job_voice
from app.services.transcript_change_log import (
    can_view_transcript_changes,
    list_transcript_change_logs,
    persist_job_transcript,
)
from app.services.job_inquiries import (
    THREAD_CLIENT_ADMIN,
    THREAD_TRANSCRIBER_ADMIN,
    can_access_inquiry_thread,
    create_job_inquiry_message,
    list_job_inquiry_messages,
    resolve_job_inquiry_notify_admin_ids,
)
from app.services.inquiry_notifications import send_inquiry_notification
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
from app.services.web_push import (
    deactivate_admin_push_subscription,
    send_admin_inquiry_web_push,
    send_admin_review_request_web_push,
    send_client_pdf_web_push,
    send_client_status_web_push,
    send_transcriber_client_request_web_push,
    upsert_admin_push_subscription,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


class SaveTranscriptRequest(BaseModel):
    transcript_json: dict
    save_kind: str = "draft"


class JobStatusUpdateRequest(BaseModel):
    status: str
    note: str | None = None


class ExportTranscriptPdfRequest(BaseModel):
    transcript_json: dict | None = None


class TranscriberPdfDeliverRequest(BaseModel):
    bundle_project_pdf: bool = False


class JobAssignRequest(BaseModel):
    transcriber_code: str
    note: str | None = None


class JobInquiryMessageRequest(BaseModel):
    message: str


class MemberActiveUpdateRequest(BaseModel):
    is_active: bool


class AdminTranscriberUpdateRequest(BaseModel):
    name: str | None = None
    grade_level: int | None = None
    specialty: str | None = None
    phone: str | None = None
    resident_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    account_holder: str | None = None
    unit_price: float | None = None
    monthly_capacity: int | None = None
    status: str | None = None


class DatabaseResetRequest(BaseModel):
    confirm: str


class AdminTranscriberCreateRequest(BaseModel):
    code: str | None = None
    name: str
    grade_level: int = 1
    specialty: str | None = None
    email: str | None = None
    phone: str | None = None
    resident_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    account_holder: str | None = None
    unit_price: float = 0
    monthly_capacity: int | None = None
    status: str = "available"


class SettlementStatusUpdateRequest(BaseModel):
    status: str


class SettlementPaymentRequest(BaseModel):
    amount: float
    note: str | None = None


class SettlementConfirmRequest(BaseModel):
    transcriber_id: int
    as_of: date


class TranscriberGradeRateRequest(BaseModel):
    grade_level: int
    per_minute_rate: float


class InvoiceStatusUpdateRequest(BaseModel):
    status: str


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: str | None = None


class TranscriptShareCreateRequest(BaseModel):
    allow_audio: bool = True
    allow_pdf_download: bool = True


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


def _resolve_job_transcript(
    job: Job,
    job_id: str,
    transcriber: Transcriber | None,
) -> dict:
    if transcriber_can_view_job_transcript(job, transcriber) or transcript_visible_to_client(job):
        return get_transcript_json(job_id) or empty_transcript_json(job.original_filename)
    return empty_transcript_json(job.original_filename)


def _ensure_job_exists(job_id: str) -> None:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")


def _share_response(share_token: str, expires_at: datetime) -> dict:
    base = settings.public_client_url.rstrip("/")
    return {
        "share_url": f"{base}/share/transcript/{share_token}",
        "expires_at": expires_at.isoformat(),
        "expires_in_days": SHARE_EXPIRE_DAYS,
    }


def _download_project_bundle_pdf(project_id: str, db: Session) -> Response:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    jobs = list_project_jobs(db, project_id)
    if not jobs:
        raise HTTPException(status_code=404, detail="등록된 문서 없습니다.")

    transcripts: list[dict] = []
    for job in jobs:
        transcript = get_transcript_json(job.job_id)
        if transcript:
            transcript = filter_transcript_to_selected_segments(transcript, job.selected_segments_json or [])
            title = job.original_filename or job.title or transcript.get("filename") or f"문서 {len(transcripts) + 1}"
            transcript = {**transcript, "filename": title}
            transcripts.append(transcript)
    if not transcripts:
        raise HTTPException(status_code=404, detail="등록된 문서 없습니다.")

    try:
        bundle_bytes, bundle_name = build_project_bundle_pdf(project.title or project.project_id, transcripts)
        encoded = quote(bundle_name)
        return Response(
            content=bundle_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=\"project_bundle.pdf\"; filename*=UTF-8''{encoded}",
                "Cache-Control": "no-cache",
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Project PDF bundle failed: {exc}") from exc


def _get_valid_share_or_404(db: Session, token: str):
    share = get_transcript_share_by_token(db, token)
    if share is None:
        raise HTTPException(status_code=404, detail="공유 링크를 찾을 수 없습니다.")
    if not transcript_share_is_valid(share):
        raise HTTPException(status_code=410, detail="공유 링크가 만료되었거나 비활성화되었습니다.")
    return share


def _set_job_status_or_http_error(
    db: Session,
    job: Job,
    next_status: str,
    note: str | None = None,
    *,
    admin: AdminUser | None = None,
) -> Job:
    try:
        return set_job_status(db, job, next_status, note, admin=admin)
    except (DataError, DBAPIError) as exc:
        db.rollback()
        logger.exception("Job status update failed for %s -> %s", job.job_id, next_status)
        db_engine = get_engine()
        if db_engine is not None and ensure_jobs_status_column(db_engine):
            db.refresh(job)
            try:
                return set_job_status(db, job, next_status, note, admin=admin)
            except (DataError, DBAPIError):
                db.rollback()
                logger.exception("Job status update retry failed for %s -> %s", job.job_id, next_status)
        raise HTTPException(
            status_code=409,
            detail=f"작업 상태({next_status})를 저장하지 못했습니다. 서버 DB 설정을 확인해 주세요.",
        ) from exc


def _ensure_member_owns_job(db: Session, member: Member, job: Job) -> None:
    client = get_or_create_client_for_member(db, member)
    if job.client_id is None or job.client_id != client.id:
        raise HTTPException(status_code=403, detail="이 작업은 공유할 수 없습니다.")


def _job_member(db: Session, job: Job) -> Member | None:
    client = job.client
    if client is None and job.client_id is not None:
        client = db.get(Client, job.client_id)
    if client is None:
        return None

    client_code = (client.client_code or "").strip()
    if client_code.startswith("MEMBER-"):
        suffix = client_code.removeprefix("MEMBER-").strip()
        if suffix.isdigit():
            member = get_member_by_id(db, int(suffix))
            if member is not None and member.is_active:
                return member

    contact_email = (client.contact_email or "").strip().lower()
    if contact_email:
        member = db.scalar(select(Member).where(Member.email == contact_email))
        if member is not None and member.is_active:
            return member
    return None


def _notify_client_status_change(db: Session, job: Job, *, note: str | None = None) -> None:
    member = _job_member(db, job)
    if member is None:
        return
    try:
        delivered = send_client_status_web_push(db, member=member, job=job, note=note)
        if delivered == 0:
            logger.warning("No client status web push delivered for job %s", job.job_id)
    except Exception:
        logger.exception("Failed to send client status notification for job %s", job.job_id)


def _notify_client_pdf_delivery(db: Session, job: Job, *, delivery_mode: str) -> None:
    member = _job_member(db, job)
    if member is None:
        return
    try:
        delivered = send_client_pdf_web_push(db, member=member, job=job, delivery_mode=delivery_mode)
        if delivered == 0:
            logger.warning("No client PDF delivery web push delivered for job %s", job.job_id)
    except Exception:
        logger.exception("Failed to send client PDF delivery notification for job %s", job.job_id)


def _notify_admin_inquiry(
    db: Session,
    job: Job,
    *,
    sender_name: str,
    message: str,
    sender_role: str,
    notify_admin_ids: list[int],
) -> None:
    preview = " ".join((message or "").split())
    if len(preview) > 120:
        preview = preview[:119].rstrip() + "…"
    try:
        delivered = send_admin_inquiry_web_push(
            db,
            job=job,
            sender_name=sender_name,
            message_preview=preview,
            sender_role=sender_role,
            notify_admin_ids=notify_admin_ids,
        )
        if delivered == 0:
            logger.info(
                "Admin inquiry web push delivered 0 notifications for job %s (targets=%s)",
                job.job_id,
                notify_admin_ids,
            )
    except Exception:
        logger.exception("Failed to send admin inquiry web push for job %s", job.job_id)


def _maybe_notify_admin_review_request(db: Session, job: Job, *, note: str | None = None) -> None:
    if job.status not in {"review_waiting", "transcriber_review"}:
        return
    try:
        delivered = send_admin_review_request_web_push(db, job=job, note=note)
        if delivered == 0:
            logger.info("Admin review-request web push delivered 0 notifications for job %s", job.job_id)
    except Exception:
        logger.exception("Failed to send admin review-request web push for job %s", job.job_id)


def _maybe_notify_transcriber_client_request(db: Session, job: Job, *, note: str | None = None) -> None:
    if job.status not in {"review_waiting", "transcriber_review"}:
        return
    if job.assigned_transcriber_id is None:
        return
    transcriber = db.get(Transcriber, job.assigned_transcriber_id)
    if transcriber is None:
        return
    try:
        delivered = send_transcriber_client_request_web_push(db, transcriber=transcriber, job=job, note=note)
        if delivered == 0:
            logger.info("Transcriber client-request web push delivered 0 notifications for job %s", job.job_id)
    except Exception:
        logger.exception("Failed to send transcriber client-request web push for job %s", job.job_id)


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


@router.post("/{job_id}/share")
def create_job_share(
    job_id: str,
    body: TranscriptShareCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_member_owns_job(db, member, job)
    if not transcript_visible_to_client(job):
        raise HTTPException(status_code=409, detail="현재 상태에서는 공유 링크를 만들 수 없습니다.")

    share = create_transcript_share(
        db,
        job=job,
        member=member,
        allow_audio=body.allow_audio,
        allow_pdf_download=body.allow_pdf_download,
    )
    return {
        "job_id": job_id,
        "token": share.token,
        "allow_audio": bool(share.allow_audio),
        "allow_pdf_download": bool(share.allow_pdf_download),
        **_share_response(share.token, share.expires_at),
    }


@router.delete("/share/{token}")
def revoke_job_share(
    token: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> dict:
    share = get_transcript_share_by_token(db, token)
    if share is None:
        raise HTTPException(status_code=404, detail="공유 링크를 찾을 수 없습니다.")
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_member_owns_job(db, member, job)
    deactivate_transcript_share(db, share)
    return {"token": token, "revoked": True}


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


@router.post("/admin/maintenance/migrate-job-status-column")
def admin_migrate_job_status_column(request: Request) -> dict:
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
    if not ensure_jobs_status_column(db_engine):
        raise HTTPException(status_code=502, detail="jobs.status column migration failed")
    return {"migrated": True, "column": "jobs.status"}


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
    _admin: AdminAuth,
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
def admin_overview(db: Annotated[Session, Depends(get_db)], _admin: AdminAuth) -> dict:
    try:
        return dashboard_overview(db)
    except Exception:
        # Keep admin usable even if one overview section regresses.
        return {
            "stats": {
                "total_jobs": 0,
                "waiting_assignment": 0,
                "working": 0,
                "final_done": 0,
                "total_sales": 0,
                "total_settlements": 0,
                "outstanding": 0,
            },
            "projects": list_projects(db, include_files=True),
            "members": list_members_admin(db),
            "jobs": list_client_jobs(db, member=None),
            "transcribers": list_transcribers(db),
            "transcriber_grade_rates": list_transcriber_grade_rates(db),
            "settlements": [],
            "sales": [],
        }


@router.get("/admin/events")
def admin_events(admin: AdminEventAuth) -> StreamingResponse:
    return StreamingResponse(
        stream_admin_events(admin.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/admin/push-subscriptions")
def register_admin_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    if not body.endpoint.strip() or not body.keys.p256dh.strip() or not body.keys.auth.strip():
        raise HTTPException(status_code=400, detail="유효한 푸시 구독 정보가 필요합니다.")
    try:
        subscription = upsert_admin_push_subscription(
            db,
            admin_user=admin,
            endpoint=body.endpoint,
            p256dh_key=body.keys.p256dh,
            auth_key=body.keys.auth,
            user_agent=body.user_agent,
        )
    except Exception as exc:
        logger.exception("admin push subscription register failed")
        raise HTTPException(status_code=503, detail="관리자 웹푸시 구독 저장 중 오류가 발생했습니다.") from exc
    return {"subscription_id": subscription.id, "registered": True}


@router.delete("/admin/push-subscriptions")
def unregister_admin_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    try:
        deactivate_admin_push_subscription(db, endpoint=body.endpoint, admin_user=admin)
    except Exception as exc:
        logger.exception("admin push subscription unregister failed")
        raise HTTPException(status_code=503, detail="관리자 웹푸시 구독 해제 중 오류가 발생했습니다.") from exc
    return {"unregistered": True}


@router.get("/admin/transcribers")
def admin_transcribers(db: Annotated[Session, Depends(get_db)], _admin: AdminAuth) -> dict:
    return {"transcribers": list_transcribers(db)}


@router.get("/admin/members")
def admin_members(db: Annotated[Session, Depends(get_db)], _admin: AdminAuth) -> dict:
    return {"members": list_members_admin(db)}


@router.patch("/admin/members/{member_id}")
def admin_update_member_active(
    member_id: int,
    body: MemberActiveUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    member = get_member_by_id(db, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")
    member = set_member_active(db, member, is_active=body.is_active)
    publish_admin_event("member_updated", {"member_id": member.id, "is_active": bool(member.is_active)})
    return {"member": serialize_member_admin(db, member)}


@router.post("/admin/jobs/{job_id}/assign")
def admin_assign_job(
    job_id: str,
    body: JobAssignRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        job = assign_job(db, job, transcriber_code=body.transcriber_code, note=body.note, admin=admin)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    publish_admin_event("job_assigned", {"job_id": job.job_id})
    return {"job_id": job.job_id, "status": job.status, "assigned_transcriber_id": job.assigned_transcriber_id}


@router.get("/admin/jobs/{job_id}")
def admin_get_job(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in database")

    transcript = get_transcript_json(job_id) or empty_transcript_json(job.original_filename)
    return serialize_job(db, job, transcript_json=transcript, audio_url=f"/api/jobs/{job_id}/audio")


@router.get("/{job_id}/inquiries/client")
def list_client_job_inquiries(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not can_access_inquiry_thread(db, job, THREAD_CLIENT_ADMIN, member=member):
        raise HTTPException(status_code=403, detail="이 문의 내역을 볼 수 없습니다.")
    return {"job_id": job_id, "thread_type": THREAD_CLIENT_ADMIN, "messages": list_job_inquiry_messages(db, job_id, THREAD_CLIENT_ADMIN)}


@router.post("/{job_id}/inquiries/client")
def create_client_job_inquiry(
    job_id: str,
    body: JobInquiryMessageRequest,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not can_access_inquiry_thread(db, job, THREAD_CLIENT_ADMIN, member=member):
        raise HTTPException(status_code=403, detail="이 문의를 작성할 수 없습니다.")
    try:
        message = create_job_inquiry_message(db, job, THREAD_CLIENT_ADMIN, body.message, member=member)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    notify_admin_ids = resolve_job_inquiry_notify_admin_ids(db, job)
    try:
        send_inquiry_notification(
            db,
            job=job,
            thread_type=THREAD_CLIENT_ADMIN,
            sender_role="client",
            sender_name=member.name,
            message=message["message"],
            member=member,
        )
    except Exception:
        logger.exception("Failed to send client inquiry notification for job %s", job_id)
    _notify_admin_inquiry(
        db,
        job,
        sender_name=member.name,
        message=message["message"],
        sender_role="client",
        notify_admin_ids=notify_admin_ids,
    )
    publish_admin_event(
        "job_inquiry_created",
        {"job_id": job_id, "thread_type": THREAD_CLIENT_ADMIN, "sender_role": "client"},
        admin_ids=notify_admin_ids,
    )
    return {"message": message}


@router.get("/transcriber/{job_id}/inquiries")
def list_transcriber_job_inquiries(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not can_access_inquiry_thread(db, job, THREAD_TRANSCRIBER_ADMIN, transcriber=current):
        raise HTTPException(status_code=403, detail="이 문의 내역을 볼 수 없습니다.")
    return {"job_id": job_id, "thread_type": THREAD_TRANSCRIBER_ADMIN, "messages": list_job_inquiry_messages(db, job_id, THREAD_TRANSCRIBER_ADMIN)}


@router.post("/transcriber/{job_id}/inquiries")
def create_transcriber_job_inquiry(
    job_id: str,
    body: JobInquiryMessageRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not can_access_inquiry_thread(db, job, THREAD_TRANSCRIBER_ADMIN, transcriber=current):
        raise HTTPException(status_code=403, detail="이 문의를 작성할 수 없습니다.")
    try:
        message = create_job_inquiry_message(db, job, THREAD_TRANSCRIBER_ADMIN, body.message, transcriber=current)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    notify_admin_ids = resolve_job_inquiry_notify_admin_ids(db, job)
    try:
        send_inquiry_notification(
            db,
            job=job,
            thread_type=THREAD_TRANSCRIBER_ADMIN,
            sender_role="transcriber",
            sender_name=current.name,
            message=message["message"],
            transcriber=current,
        )
    except Exception:
        logger.exception("Failed to send transcriber inquiry notification for job %s", job_id)
    _notify_admin_inquiry(
        db,
        job,
        sender_name=current.name,
        message=message["message"],
        sender_role="transcriber",
        notify_admin_ids=notify_admin_ids,
    )
    publish_admin_event(
        "job_inquiry_created",
        {"job_id": job_id, "thread_type": THREAD_TRANSCRIBER_ADMIN, "sender_role": "transcriber"},
        admin_ids=notify_admin_ids,
    )
    return {"message": message}


@router.get("/admin/jobs/{job_id}/inquiries/{thread_type}")
def list_admin_job_inquiries(
    job_id: str,
    thread_type: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    if thread_type not in {THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN}:
        raise HTTPException(status_code=404, detail="Thread not found")
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "thread_type": thread_type, "messages": list_job_inquiry_messages(db, job_id, thread_type)}


@router.post("/admin/jobs/{job_id}/inquiries/{thread_type}")
def create_admin_job_inquiry(
    job_id: str,
    thread_type: str,
    body: JobInquiryMessageRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    if thread_type not in {THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN}:
        raise HTTPException(status_code=404, detail="Thread not found")
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        message = create_job_inquiry_message(db, job, thread_type, body.message, admin=admin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        send_inquiry_notification(
            db,
            job=job,
            thread_type=thread_type,
            sender_role="admin",
            sender_name=message["sender_name"],
            message=message["message"],
            member=_job_member(db, job) if thread_type == THREAD_CLIENT_ADMIN else None,
        )
    except Exception:
        logger.exception("Failed to send admin inquiry notification for job %s", job_id)
    publish_admin_event("job_inquiry_created", {"job_id": job_id, "thread_type": thread_type, "sender_role": "admin"})
    return {"message": message}


@router.put("/admin/jobs/{job_id}/transcript")
def admin_save_transcript(
    job_id: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    save_kind = body.save_kind or "draft"

    try:
        transcript_key = persist_job_transcript(
            db,
            job,
            job_id,
            body.transcript_json,
            admin=admin,
            save_kind=save_kind,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": "saved", "transcript_key": transcript_key}


@router.get("/admin/transcribers/next-code")
def admin_next_transcriber_code(db: Annotated[Session, Depends(get_db)], _admin: AdminAuth) -> dict:
    return {"code": generate_transcriber_code(db)}


@router.patch("/admin/transcribers/{transcriber_code}")
def admin_update_transcriber(
    transcriber_code: str,
    body: AdminTranscriberUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    try:
        transcriber = update_transcriber(
            db,
            transcriber,
            name=body.name,
            grade_level=body.grade_level,
            specialty=body.specialty,
            phone=body.phone,
            resident_id=body.resident_id,
            bank_name=body.bank_name,
            account_number=body.account_number,
            account_holder=body.account_holder,
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
        "grade_level": transcriber.grade_level,
        "status": transcriber.status,
        "specialty": transcriber.specialty,
        "monthly_capacity": transcriber.monthly_capacity,
        "unit_price": float(transcriber.unit_price or 0),
    }


@router.post("/admin/transcribers")
def admin_create_transcriber(
    body: AdminTranscriberCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    try:
        transcriber = create_transcriber(
            db,
            code=body.code,
            name=body.name,
            grade_level=body.grade_level,
            specialty=body.specialty,
            email=body.email,
            phone=body.phone,
            resident_id=body.resident_id,
            bank_name=body.bank_name,
            account_number=body.account_number,
            account_holder=body.account_holder,
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
        "grade_level": transcriber.grade_level,
        "status": transcriber.status,
        "specialty": transcriber.specialty,
        "monthly_capacity": transcriber.monthly_capacity,
        "unit_price": float(transcriber.unit_price or 0),
    }


@router.get("/admin/transcriber-grade-rates")
def admin_list_transcriber_grade_rates(db: Annotated[Session, Depends(get_db)], _admin: AdminAuth) -> dict:
    return {"rates": list_transcriber_grade_rates(db)}


@router.post("/admin/transcriber-grade-rates")
def admin_upsert_transcriber_grade_rate(
    body: TranscriberGradeRateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    try:
        rate = upsert_transcriber_grade_rate(db, body.grade_level, body.per_minute_rate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish_admin_event("transcriber_grade_rate_updated", {"grade_level": rate.grade_level})
    return {
        "rate": {
            "id": rate.id,
            "grade_level": rate.grade_level,
            "per_minute_rate": float(rate.per_minute_rate or 0),
        }
    }


@router.delete("/admin/transcriber-grade-rates/{rate_id}")
def admin_delete_transcriber_grade_rate(
    rate_id: int,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    try:
        delete_transcriber_grade_rate(db, rate_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    publish_admin_event("transcriber_grade_rate_deleted", {"id": rate_id})
    return {"deleted": True, "id": rate_id}


@router.post("/admin/transcribers/{transcriber_code}/revoke-auth")
def admin_revoke_transcriber_auth(
    transcriber_code: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
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
    _admin: AdminAuth,
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


@router.get("/admin/settlements")
def admin_list_settlements(
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
    as_of: Annotated[date, Query(description="기준일 (KST). 선택한 달의 해당일까지 완료된 작업을 집계합니다.")],
) -> dict:
    return list_settlement_snapshots(db, as_of)


@router.post("/admin/settlements/confirm")
def admin_confirm_settlement(
    body: SettlementConfirmRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    try:
        settlement = confirm_settlement_snapshot(
            db,
            transcriber_id=body.transcriber_id,
            as_of=body.as_of,
            admin=admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish_admin_event("settlement_updated", {"settlement_id": settlement.id})
    return {
        "id": settlement.id,
        "status": settlement.status,
        "confirmed_at": settlement.confirmed_at.isoformat() if settlement.confirmed_at else None,
        "final_amount": float(settlement.final_amount or 0),
    }


@router.post("/admin/settlements/{settlement_id}/status")
def admin_update_settlement(
    settlement_id: int,
    body: SettlementStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    settlement = get_settlement_record(db, settlement_id)
    if settlement is None:
        raise HTTPException(status_code=404, detail="Settlement not found")
    settlement = update_settlement_status(db, settlement, body.status, admin=admin)
    publish_admin_event("settlement_updated", {"settlement_id": settlement.id})
    return {"id": settlement.id, "status": settlement.status}


@router.post("/admin/invoices/{invoice_id}/status")
def admin_update_invoice(
    invoice_id: int,
    body: InvoiceStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    invoice = get_invoice_record(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = update_invoice_status(db, invoice, body.status)
    publish_admin_event("invoice_updated", {"invoice_id": invoice.id})
    return {"id": invoice.id, "status": invoice.invoice_status}


@router.post("/admin/settlements/{settlement_id}/payment")
def admin_record_settlement_payment(
    settlement_id: int,
    body: SettlementPaymentRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    settlement = get_settlement_record(db, settlement_id)
    if settlement is None:
        raise HTTPException(status_code=404, detail="Settlement not found")
    try:
        settlement = record_settlement_payment(db, settlement, body.amount, body.note, admin=admin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish_admin_event("settlement_payment_recorded", {"settlement_id": settlement.id})
    return {
        "id": settlement.id,
        "status": settlement.status,
        "total_paid_amount": float(settlement.total_paid_amount or 0),
        "paid_at": settlement.paid_at.isoformat() if settlement.paid_at else None,
    }


def _resolve_transcriber_portal_user(
    db: Session,
    current: Transcriber | None,
    transcriber_code: str | None,
) -> Transcriber:
    if current is not None:
        return current
    if not transcriber_code:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    transcriber = get_transcriber_by_code(db, transcriber_code)
    if transcriber is None:
        raise HTTPException(status_code=404, detail="Transcriber not found")
    return transcriber


@router.get("/transcriber/assigned")
def list_transcriber_assigned_jobs(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    transcriber_code: str | None = Query(None),
) -> dict:
    transcriber = _resolve_transcriber_portal_user(db, current, transcriber_code)
    return {"jobs": list_transcriber_jobs(db, transcriber.transcriber_code)}


@router.get("/transcriber/projects")
def list_transcriber_assigned_projects(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    transcriber_code: str | None = Query(None),
) -> dict:
    transcriber = _resolve_transcriber_portal_user(db, current, transcriber_code)
    return {"projects": list_transcriber_projects(db, transcriber.transcriber_code)}


@router.get("/transcriber/profile")
def transcriber_profile(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    transcriber_code: str | None = Query(None),
) -> dict:
    transcriber = _resolve_transcriber_portal_user(db, current, transcriber_code)
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


@router.post("/transcriber/{job_id}/ai-draft")
def transcriber_ai_draft(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.assigned_transcriber_id != current.id:
        raise HTTPException(status_code=403, detail="배정된 작업만 AI 초벌을 실행할 수 있습니다.")

    try:
        transcript_json, transcript_key, voice_key = transcribe_job_voice(job_id)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=503, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    mark_transcript_saved(db, job, transcript_key, transcript_json)
    if job.status == "assigned":
        job = set_job_status(db, job, "working", "AI 초벌 생성")
    publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

    return {
        "status": "AI_DONE",
        "job_id": job_id,
        "voice_key": voice_key,
        "transcript_key": transcript_key,
        "transcript_json": transcript_json,
    }


@router.post("/transcriber/{job_id}/deliver-draft")
def transcriber_deliver_draft(
    job_id: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.assigned_transcriber_id != current.id:
        raise HTTPException(status_code=403, detail="배정된 작업만 초벌을 전달할 수 있습니다.")
    if job.status not in TRANSCRIBER_DRAFT_STATUSES | {"review_waiting", "transcriber_review", "first_done", "client_editing"}:
        raise HTTPException(status_code=409, detail="현재 상태에서는 초벌을 전달할 수 없습니다.")

    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        transcript_key = persist_job_transcript(
            db,
            job,
            job_id,
            body.transcript_json,
            transcriber=current,
            member=None,
            save_kind="deliver",
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    job = set_job_status(db, job, "first_done", "속기사 초벌 전달")
    _notify_client_status_change(db, job, note="초벌본이 도착했습니다.")
    publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

    return {
        "job_id": job_id,
        "status": job.status,
        "workflow_status": job.status,
        "transcript_key": transcript_key,
        "transcript_json": body.transcript_json,
    }


@router.post("/admin/jobs/{job_id}/ai-draft")
def admin_ai_draft(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        transcript_json, transcript_key, voice_key = transcribe_job_voice(job_id)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=503, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    mark_transcript_saved(db, job, transcript_key, transcript_json)
    if job.status == "assigned":
        job = set_job_status(db, job, "working", "관리자 AI 초벌 생성", admin=admin)
    publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

    return {
        "status": "AI_DONE",
        "job_id": job_id,
        "voice_key": voice_key,
        "transcript_key": transcript_key,
        "workflow_status": job.status,
        "transcript_json": transcript_json,
    }


@router.post("/admin/jobs/{job_id}/deliver-draft")
def admin_deliver_draft(
    job_id: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in TRANSCRIBER_DRAFT_STATUSES | {"review_waiting", "transcriber_review", "first_done", "client_editing"}:
        raise HTTPException(status_code=409, detail="현재 상태에서는 초벌을 전달할 수 없습니다.")

    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        transcript_key = persist_job_transcript(
            db,
            job,
            job_id,
            body.transcript_json,
            admin=admin,
            save_kind="deliver",
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    job = set_job_status(db, job, "first_done", "관리자 초벌 전달", admin=admin)
    _notify_client_status_change(db, job, note="초벌본이 도착했습니다.")
    publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

    return {
        "job_id": job_id,
        "status": job.status,
        "workflow_status": job.status,
        "transcript_key": transcript_key,
        "transcript_json": body.transcript_json,
    }


@router.get("/admin/jobs/{job_id}/transcript/changes")
def admin_list_job_transcript_changes(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "entries": list_transcript_change_logs(db, job_id)}


@router.get("/{job_id}/transcript/changes")
def list_job_transcript_changes(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    transcriber: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not can_view_transcript_changes(db, job, transcriber=transcriber, member=member):
        raise HTTPException(status_code=403, detail="이 작업의 변경 이력을 볼 수 없습니다.")
    return {"job_id": job_id, "entries": list_transcript_change_logs(db, job_id)}


@router.get("/{job_id}")
def get_job(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in database")

    transcript = _resolve_job_transcript(job, job_id, current)

    return serialize_job(db, job, transcript_json=transcript, audio_url=f"/api/jobs/{job_id}/audio")


@router.get("/share/{token}")
def get_shared_job(token: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    share = _get_valid_share_or_404(db, token)
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    transcript = get_transcript_json(job.job_id) or empty_transcript_json(job.original_filename)
    audio_url = f"/api/jobs/share/{token}/audio" if share.allow_audio else ""
    pdf_url = f"/api/jobs/share/{token}/transcript.pdf/final" if share.allow_pdf_download and job.final_pdf_r2_key else ""

    return {
        "job": serialize_job(db, job, transcript_json=transcript, audio_url=audio_url),
        "share": {
            "token": share.token,
            "expires_at": share.expires_at.isoformat(),
            "allow_audio": bool(share.allow_audio),
            "allow_pdf_download": bool(share.allow_pdf_download),
            "final_pdf_url": pdf_url,
        },
    }


@router.get("/share/{token}/transcript/changes")
def get_shared_job_changes(token: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    share = _get_valid_share_or_404(db, token)
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job.job_id, "entries": list_transcript_change_logs(db, job.job_id)}


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


@router.get("/share/{token}/audio")
def stream_shared_audio(token: str, request: Request, db: Annotated[Session, Depends(get_db)]) -> Response:
    share = _get_valid_share_or_404(db, token)
    if not share.allow_audio:
        raise HTTPException(status_code=403, detail="오디오 재생이 허용되지 않았습니다.")
    return stream_audio(share.job_id, request)


@router.get("/{job_id}/transcript.pdf")
def export_transcript_pdf_get(job_id: str, db: Annotated[Session, Depends(get_db)]) -> Response:
    _ensure_job_exists(job_id)
    transcript = get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")
    job = get_job_record(db, job_id)
    if job is not None:
        transcript = filter_transcript_to_selected_segments(transcript, job.selected_segments_json or [])
    return _pdf_response(transcript)


@router.post("/{job_id}/transcript.pdf")
def export_transcript_pdf_post(
    job_id: str,
    body: ExportTranscriptPdfRequest,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    _ensure_job_exists(job_id)
    transcript = body.transcript_json or get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")
    job = get_job_record(db, job_id)
    if job is not None:
        transcript = filter_transcript_to_selected_segments(transcript, job.selected_segments_json or [])
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
        transcript = filter_transcript_to_selected_segments(transcript, job.selected_segments_json or [])
        pdf_bytes, filename = build_transcript_pdf(transcript)
        pdf_key, stored_filename = save_final_pdf(job_id, pdf_bytes, filename)
        store_final_pdf(db, job, pdf_key, stored_filename)
        publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Final PDF save failed: {exc}") from exc

    return {
        "job_id": job_id,
        "status": job.status,
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
    fallback_name = "final_transcript.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{fallback_name}\"; filename*=UTF-8''{encoded}",
            "Cache-Control": "no-cache",
        },
    )


@router.get("/transcriber/projects/{project_id}/transcript.pdf/final")
def download_transcriber_project_final_pdf_bundle(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> Response:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    jobs = [job for job in list_project_jobs(db, project_id) if job.assigned_transcriber_id == current.id]
    if not jobs:
        raise HTTPException(status_code=404, detail="등록된 문서 없습니다.")
    return _download_project_bundle_pdf(project_id, db)


@router.get("/share/project/{project_id}/transcript.pdf/final")
def download_member_project_final_pdf_bundle(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> Response:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    client = get_or_create_client_for_member(db, member)
    if project.client_id != client.id:
        raise HTTPException(status_code=403, detail="이 프로젝트에 접근할 수 없습니다.")
    return _download_project_bundle_pdf(project_id, db)


@router.post("/admin/jobs/{job_id}/deliver-pdf")
def admin_deliver_pdf(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.final_pdf_r2_key:
        raise HTTPException(status_code=409, detail="먼저 PDF를 생성해 주세요.")
    job = mark_final_pdf_delivered(db, job)
    _notify_client_pdf_delivery(db, job, delivery_mode="individual")
    _notify_client_status_change(db, job, note="PDF가 전달되었습니다.")
    publish_admin_event("job_updated", {"job_id": job_id, "status": "pdf_sent"})
    return {
        "job_id": job_id,
        "status": job.status,
        "settlement_amount": float(job.settlement_amount or 0),
    }


@router.post("/admin/jobs/{job_id}/sync-settlement")
def admin_sync_job_settlement(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminAuth,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        job = repair_job_settlement(db, job)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    item = db.scalar(select(SettlementItem).where(SettlementItem.job_id == job_id))
    return {
        "job_id": job_id,
        "status": job.status,
        "settlement_amount": float(job.settlement_amount or 0),
        "settlement_item_id": item.id if item is not None else None,
    }


@router.post("/transcriber/{job_id}/deliver-pdf")
def transcriber_deliver_pdf(
    job_id: str,
    body: TranscriberPdfDeliverRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.assigned_transcriber_id != current.id:
        raise HTTPException(status_code=403, detail="배정된 작업만 PDF 전달할 수 있습니다.")
    if not job.final_pdf_r2_key:
        raise HTTPException(status_code=409, detail="먼저 현재 내용을 저장해 PDF를 생성해 주세요.")

    if body.bundle_project_pdf:
        if not job.project_id:
            raise HTTPException(status_code=409, detail="프로젝트 통합본은 프로젝트에 속한 작업에서만 전달할 수 있습니다.")
        project = get_project_record(db, job.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        project.pdf_delivery_mode = "bundle"
        db.commit()
    elif job.project_id:
        project = get_project_record(db, job.project_id)
        if project is not None:
            project.pdf_delivery_mode = "individual"
            db.commit()

    mark_final_pdf_delivered(db, job)
    _notify_client_pdf_delivery(db, job, delivery_mode="bundle" if body.bundle_project_pdf else "individual")
    _notify_client_status_change(db, job, note="PDF가 전달되었습니다.")
    publish_admin_event("job_updated", {"job_id": job_id, "status": "pdf_sent"})
    return {
        "job_id": job_id,
        "status": "pdf_sent",
        "project_id": job.project_id,
        "pdf_delivery_mode": "bundle" if body.bundle_project_pdf else "individual",
    }


@router.get("/share/{token}/transcript.pdf/final")
def download_shared_final_transcript_pdf(
    token: str,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    share = _get_valid_share_or_404(db, token)
    if not share.allow_pdf_download:
        raise HTTPException(status_code=403, detail="PDF 다운로드가 허용되지 않았습니다.")
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.project_id:
        project = get_project_record(db, job.project_id)
        if project is not None and project.pdf_delivery_mode == "bundle":
            return _download_project_bundle_pdf(job.project_id, db)
    return download_final_transcript_pdf(share.job_id, db)


@router.put("/{job_id}/transcript")
def save_transcript(
    job_id: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
    transcriber: Annotated[Transcriber | None, Depends(get_optional_current_transcriber)] = None,
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    job = get_job_record(db, job_id)
    save_kind = body.save_kind or "draft"

    try:
        if job is not None:
            transcript_key = persist_job_transcript(
            db,
                job,
            job_id,
            body.transcript_json,
                transcriber=transcriber,
                member=member,
                save_kind=save_kind,
        )
        else:
            transcript_key = save_transcript_json(job_id, body.transcript_json)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    if job is not None:
        publish_admin_event("job_updated", {"job_id": job_id, "status": job.status})

    return {"job_id": job_id, "status": "saved", "transcript_key": transcript_key}


@router.put("/share/{token}/transcript")
def save_shared_transcript(
    token: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    share = _get_valid_share_or_404(db, token)
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    save_kind = body.save_kind or "shared_edit"
    try:
        transcript_key = persist_job_transcript(
            db,
            job,
            job.job_id,
            body.transcript_json,
            save_kind=save_kind,
            shared_editor=True,
        )
        if job.status != "client_editing":
            job = set_job_status(db, job, "client_editing", "공유 링크 수정본 저장")
            _notify_client_status_change(db, job, note="의뢰인 수정본이 저장되었습니다.")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": job.status, "transcript_key": transcript_key}


@router.post("/share/{token}/review-request")
def submit_shared_review_request(
    token: str,
    body: SaveTranscriptRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    share = _get_valid_share_or_404(db, token)
    job = get_job_record(db, share.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        persist_job_transcript(
            db,
            job,
            job.job_id,
            body.transcript_json,
            save_kind="review_request",
            shared_editor=True,
        )
        job = set_job_status(db, job, "review_waiting", "공유 링크에서 속기사 재검수 요청")
        _notify_client_status_change(db, job, note="속기사 재검토 요청이 접수되었습니다.")
        _maybe_notify_admin_review_request(db, job, note="공유 링크에서 속기사 재검수 요청")
        _maybe_notify_transcriber_client_request(db, job, note="공유 링크에서 속기사 재검수 요청")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Review request failed: {exc}") from exc

    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": job.status}


@router.post("/{job_id}/transcriber-review-request")
def submit_transcriber_review_request(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member, Depends(get_current_member)],
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_member_owns_job(db, member, job)

    try:
        job = _set_job_status_or_http_error(db, job, "transcriber_review", "의뢰인 검토요청")
        _notify_client_status_change(db, job, note="속기사 검토가 요청되었습니다.")
        _maybe_notify_admin_review_request(db, job, note="의뢰인 검토요청")
        _maybe_notify_transcriber_client_request(db, job, note="의뢰인 검토요청")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"검토 요청 처리 실패: {exc}") from exc

    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": job.status}


@router.post("/{job_id}/status")
def update_job_status(
    job_id: str,
    body: JobStatusUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: OptionalAdminAuth = None,
) -> dict:
    job = get_job_record(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    job = _set_job_status_or_http_error(db, job, body.status, body.note, admin=admin)
    _notify_client_status_change(db, job, note=body.note)
    _maybe_notify_admin_review_request(db, job, note=body.note)
    _maybe_notify_transcriber_client_request(db, job, note=body.note)
    publish_admin_event("job_updated", {"job_id": job.job_id, "status": job.status})
    return {"job_id": job.job_id, "status": job.status}
