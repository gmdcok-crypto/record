import logging
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import DataError, IntegrityError, OperationalError, ProgrammingError, SQLAlchemyError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.admin_models import (
    AdminUser,
    Client,
    Invoice,
    Job,
    JobInquiryMessage,
    JobAssignment,
    JobStatusLog,
    Member,
    PaymentRecord,
    Settlement,
    SettlementItem,
    SettlementPayment,
    TranscriberGradeRate,
    Transcriber,
)

from app.services.web_push import send_transcriber_assignment_web_push

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

DEFAULT_ADMIN_EMAIL = "ops@bluecom.local"
DEFAULT_ADMIN_NAME = "운영관리자"
DEFAULT_TRANSCRIBER_CODE = "TR-001"
DEFAULT_CLIENT_CODE = "CLIENT-DEFAULT"
DEFAULT_CLIENT_NAME = "일반 의뢰인"
from app.services.job_workflow import (
    ACTIVE_JOB_STATUSES,
    CLIENT_REVIEW,
    CLIENT_VISIBLE_TRANSCRIPT_STATUSES,
    PDF_SENT,
    TRANSCRIBER_DRAFT_STATUSES,
    TRANSCRIBER_REVIEW,
    TRANSCRIBER_VISIBLE_JOB_STATUSES,
    TRANSCRIPT_REQUEST,
    WAITING_ASSIGNMENT,
    WORKING,
    normalize_job_status,
)
THREAD_CLIENT_ADMIN = "client_admin"
THREAD_TRANSCRIBER_ADMIN = "transcriber_admin"

# DB에 레거시 final_done 으로 남아 있어도 정산 대상으로 포함합니다.
SETTLEMENT_ELIGIBLE_JOB_STATUSES = (PDF_SENT, "final_done")


def _is_pdf_sent_job(job: Job) -> bool:
    return normalize_job_status(job.status) == PDF_SENT


def _settlement_eligible_jobs_filter():
    return Job.status.in_(SETTLEMENT_ELIGIBLE_JOB_STATUSES)


def empty_transcript_json(filename: str) -> dict:
    return {
        "filename": filename,
        "text": "",
        "plain_text": "",
        "segments": [],
        "tokens": [],
        "speaker_labels": {},
    }


def inquiry_summary_for_job(db: Session, job_id: str) -> dict:
    rows = db.scalars(
        select(JobInquiryMessage)
        .where(
            JobInquiryMessage.job_id == job_id,
            JobInquiryMessage.thread_type.in_([THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN]),
        )
        .order_by(JobInquiryMessage.id.desc())
    ).all()

    latest_by_thread: dict[str, JobInquiryMessage] = {}
    for row in rows:
        if row.thread_type not in latest_by_thread:
            latest_by_thread[row.thread_type] = row
        if len(latest_by_thread) == 2:
            break

    client_row = latest_by_thread.get(THREAD_CLIENT_ADMIN)
    transcriber_row = latest_by_thread.get(THREAD_TRANSCRIBER_ADMIN)

    admin_inquiry_badges: list[str] = []
    if client_row is not None and client_row.sender_role == "client":
        admin_inquiry_badges.append("의뢰인 답변 필요")
    if transcriber_row is not None and transcriber_row.sender_role == "transcriber":
        admin_inquiry_badges.append("속기사 답변 필요")

    return {
        "has_inquiry": client_row is not None or transcriber_row is not None,
        "client_inquiry_status": (
            None
            if client_row is None
            else ("reply_arrived" if client_row.sender_role == "admin" else "reply_pending")
        ),
        "transcriber_inquiry_status": (
            None
            if transcriber_row is None
            else ("reply_arrived" if transcriber_row.sender_role == "admin" else "reply_pending")
        ),
        "admin_inquiry_badges": admin_inquiry_badges,
    }


def transcript_visible_to_client(job: Job) -> bool:
    return job.status in CLIENT_VISIBLE_TRANSCRIPT_STATUSES


def transcriber_can_view_job_transcript(job: Job, transcriber: Transcriber | None) -> bool:
    return transcriber is not None and job.assigned_transcriber_id == transcriber.id


def ensure_seed_data(db: Session) -> Client:
    client = db.scalar(select(Client).where(Client.client_code == DEFAULT_CLIENT_CODE))
    if client is None:
        client = Client(client_code=DEFAULT_CLIENT_CODE, name=DEFAULT_CLIENT_NAME)
        db.add(client)

    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    if admin is None:
        admin = AdminUser(email=DEFAULT_ADMIN_EMAIL, name=DEFAULT_ADMIN_NAME, role="owner")
        db.add(admin)

    db.commit()
    db.refresh(client)

    from app.services.admin_auth import ensure_admin_bootstrap_password

    ensure_admin_bootstrap_password(db)
    return client


def member_client_code(member_id: int) -> str:
    return f"MEMBER-{member_id:06d}"


def get_or_create_client_for_member(db: Session, member: Member) -> Client:
    client_code = member_client_code(member.id)
    client = db.scalar(select(Client).where(Client.client_code == client_code))
    if client is None:
        client = Client(
            client_code=client_code,
            name=member.name,
            contact_email=member.email,
            contact_phone=member.phone,
        )
        db.add(client)
        db.flush()
        return client

    if (
        client.name != member.name
        or client.contact_email != member.email
        or client.contact_phone != member.phone
    ):
        client.name = member.name
        client.contact_email = member.email
        client.contact_phone = member.phone
        db.flush()
    return client


def infer_title(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0]
    return stem.replace("_", " ").strip() or "새 녹취 작업"


def _ensure_job_selected_segments_column(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'jobs'
                  AND COLUMN_NAME = 'selected_segments_json'
                LIMIT 1
                """
            )
        ).first()
        if exists:
            return
        conn.execute(text("ALTER TABLE jobs ADD COLUMN selected_segments_json JSON NULL"))


def _ensure_transcriber_grade_level_column(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'transcribers'
                  AND COLUMN_NAME = 'grade_level'
                LIMIT 1
                """
            )
        ).first()
        if exists:
            return
        conn.execute(text("ALTER TABLE transcribers ADD COLUMN grade_level INT NOT NULL DEFAULT 1 AFTER status"))


def _ensure_transcriber_grade_rates_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'transcriber_grade_rates'
                LIMIT 1
                """
            )
        ).first()
        if exists:
            return
        conn.execute(
            text(
                """
                CREATE TABLE transcriber_grade_rates (
                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                  grade_level INT NOT NULL,
                  per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_transcriber_grade_rates_level (grade_level)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
        )


def find_job_by_filename(db: Session, filename: str) -> Job | None:
    normalized = filename.strip()
    if not normalized:
        return None
    for attempt in range(2):
        try:
            return db.scalar(select(Job).where(Job.original_filename == normalized).order_by(Job.uploaded_at.desc()))
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "selected_segments_json" not in message:
                raise
            _ensure_job_selected_segments_column(db)
    return None


def _has_manual_assignment(db: Session, job_id: str) -> bool:
    assignment_id = db.scalar(
        select(JobAssignment.id)
        .where(JobAssignment.job_id == job_id, JobAssignment.assignment_type == "manual")
        .limit(1)
    )
    return assignment_id is not None


def _visible_transcriber_for_job(db: Session, job: Job) -> Transcriber | None:
    if job.transcriber is None:
        return None
    if job.status in {"uploaded", "waiting_assignment"}:
        return None
    if not _has_manual_assignment(db, job.job_id):
        return None
    return job.transcriber


def _display_status_for_job(db: Session, job: Job) -> str:
    status = normalize_job_status(job.status)
    if status == WAITING_ASSIGNMENT:
        return WAITING_ASSIGNMENT
    if status in ACTIVE_JOB_STATUSES and job.assigned_transcriber_id is None:
        return WAITING_ASSIGNMENT
    if status in CLIENT_VISIBLE_TRANSCRIPT_STATUSES:
        return status
    if status in ACTIVE_JOB_STATUSES and not _has_manual_assignment(db, job.job_id):
        return WAITING_ASSIGNMENT
    return status


def create_job_record(
    db: Session,
    *,
    job_id: str,
    filename: str,
    content_type: str,
    voice_key: str,
    transcript_key: str | None = None,
    transcript_json: dict | None = None,
    member: Member | None = None,
    project_id: str | None = None,
    selected_segments: list[dict] | None = None,
    duration_seconds: int | None = None,
) -> Job:
    if member is not None:
        client = get_or_create_client_for_member(db, member)
    else:
        client = ensure_seed_data(db)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    due_at = now + timedelta(hours=24)
    title = transcript_json.get("filename") if transcript_json else None
    title = (title or infer_title(filename)).strip()

    resolved_duration = int(duration_seconds or 0)
    if resolved_duration <= 0:
        segment_ms = _duration_ms_from_selected_segments(selected_segments)
        if segment_ms > 0:
            resolved_duration = segment_ms // 1000

    job = Job(
        job_id=job_id,
        project_id=project_id,
        client_id=client.id,
        title=title,
        original_filename=filename,
        media_type=content_type,
        requested_at=now,
        uploaded_at=now,
        due_at=due_at,
        priority="normal",
        status="waiting_assignment",
        assigned_transcriber_id=None,
        assigned_admin_id=None,
        r2_voice_key=voice_key,
        r2_transcript_key=transcript_key,
        duration_seconds=resolved_duration if resolved_duration > 0 else None,
        selected_segments_json=selected_segments or None,
        transcript_version=1,
        speaker_count=len((transcript_json or {}).get("speaker_labels") or {}),
        memo=None,
        internal_note=None,
        sales_amount=0,
        extra_amount=0,
        discount_amount=0,
        final_bill_amount=0,
        settlement_amount=0,
        payment_status="unpaid",
        settlement_status="waiting",
    )
    db.add(job)
    db.flush()

    db.add(
        JobStatusLog(
            job_id=job.job_id,
            from_status=None,
            to_status=job.status,
            change_note="업로드 및 초기 작업 생성",
        )
    )

    db.commit()
    db.refresh(job)
    return job


def get_job_record(db: Session, job_id: str) -> Job | None:
    for attempt in range(2):
        try:
            return db.scalar(select(Job).where(Job.job_id == job_id))
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "selected_segments_json" not in message:
                raise
            _ensure_job_selected_segments_column(db)
    return None


def assign_job(
    db: Session,
    job: Job,
    *,
    transcriber_code: str,
    note: str | None = None,
    admin: AdminUser | None = None,
) -> Job:
    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        raise ValueError("Transcriber not found")

    previous_transcriber_id = job.assigned_transcriber_id
    previous_status = job.status
    assigned_at = datetime.now(timezone.utc).replace(tzinfo=None)

    job.assigned_transcriber_id = transcriber.id
    job.assigned_at = assigned_at
    if admin is not None:
        job.assigned_admin_id = admin.id
    if normalize_job_status(job.status) in {
        WAITING_ASSIGNMENT,
        TRANSCRIPT_REQUEST,
        TRANSCRIBER_REVIEW,
        CLIENT_REVIEW,
    } or job.status == "assigned":
        job.status = WORKING

    db.add(
        JobAssignment(
            job_id=job.job_id,
            from_transcriber_id=previous_transcriber_id,
            to_transcriber_id=transcriber.id,
            assigned_by_admin_id=admin.id if admin else None,
            assignment_type="manual",
            reason=note or "관리자 배정",
            assigned_at=assigned_at,
        )
    )

    if previous_status != job.status:
        db.add(
            JobStatusLog(
                job_id=job.job_id,
                from_status=previous_status,
                to_status=job.status,
                changed_by_admin_id=admin.id if admin else None,
                change_note=note or "관리자 배정",
            )
        )

    db.commit()
    _sync_transcriber_load(db, previous_transcriber_id)
    _sync_transcriber_load(db, transcriber.id)
    db.refresh(job)

    if previous_transcriber_id != transcriber.id:
        try:
            delivered = send_transcriber_assignment_web_push(db, transcriber=transcriber, job=job, note=note)
            if delivered == 0:
                logger.info("Transcriber assignment web push delivered 0 notifications for job %s", job.job_id)
        except Exception:
            logger.exception("Failed to send transcriber assignment web push for job %s", job.job_id)

    return job


def set_job_status(
    db: Session,
    job: Job,
    next_status: str,
    note: str | None = None,
    *,
    admin: AdminUser | None = None,
) -> Job:
    previous = job.status
    job.status = next_status
    if next_status == PDF_SENT:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if job.finalized_at is None:
            job.finalized_at = now
        if job.completed_at is None:
            job.completed_at = now
    status_log = JobStatusLog(
        job_id=job.job_id,
        from_status=previous,
        to_status=next_status,
        change_note=note,
    )
    if admin is not None:
        status_log.changed_by_admin_id = admin.id
    else:
        status_log.changed_by_transcriber_id = job.assigned_transcriber_id
    db.add(status_log)
    db.commit()
    _sync_transcriber_load(db, job.assigned_transcriber_id)
    db.refresh(job)
    return job


def set_job_status_resilient(
    db: Session,
    job: Job,
    next_status: str,
    note: str | None = None,
    *,
    admin: AdminUser | None = None,
) -> Job:
    try:
        return set_job_status(db, job, next_status, note, admin=admin)
    except (DataError, DBAPIError):
        db.rollback()
        logger.exception("Job status update failed for %s -> %s", job.job_id, next_status)
        from app.db import get_engine
        from app.services.database_migrate import ensure_jobs_status_column

        engine = get_engine()
        if engine is not None:
            ensure_jobs_status_column(engine)
        refreshed = get_job_record(db, job.job_id)
        if refreshed is None:
            raise
        return set_job_status(db, refreshed, next_status, note, admin=admin)


def mark_transcript_saved(db: Session, job: Job, transcript_key: str, transcript_json: dict) -> Job:
    job.r2_transcript_key = transcript_key
    job.transcript_version = (job.transcript_version or 0) + 1
    job.speaker_count = len((transcript_json or {}).get("speaker_labels") or {})
    _ensure_job_duration_seconds(job, transcript_json=transcript_json)
    db.commit()
    db.refresh(job)
    return job


def store_final_pdf(db: Session, job: Job, pdf_key: str, filename: str) -> Job:
    job.final_pdf_r2_key = pdf_key
    job.final_pdf_filename = filename
    job.final_pdf_generated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if job.finalized_at is None:
        job.finalized_at = job.final_pdf_generated_at
    db.commit()
    db.refresh(job)
    return job


def _resolve_settlement_unit_price(transcriber: Transcriber, rates_by_grade: dict[int, float]) -> float:
    grade_rate = float(rates_by_grade.get(int(transcriber.grade_level or 1), 0) or 0)
    if grade_rate > 0:
        return grade_rate
    return float(transcriber.unit_price or 0)


def _compute_job_settlement_amount(db: Session, job: Job) -> float:
    transcriber = job.transcriber
    if transcriber is None or job.assigned_transcriber_id is None:
        return 0.0
    _ensure_transcriber_grade_rates_table(db)
    rates_by_grade = {
        int(row["grade_level"]): float(row["per_minute_rate"] or 0)
        for row in list_transcriber_grade_rates(db)
    }
    unit_price = _resolve_settlement_unit_price(transcriber, rates_by_grade)
    quantity_minutes = _round_settlement_minutes(_resolve_job_duration_seconds(job))
    return float(unit_price * quantity_minutes)


def _apply_job_settlement_on_pdf_delivered(db: Session, job: Job) -> float:
    """속기사 업무 완료(pdf_sent) 시점에 작업비를 jobs 테이블에 반영합니다."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    job.completed_at = now
    if job.finalized_at is None:
        job.finalized_at = now
    _ensure_job_duration_seconds(job)
    amount = _compute_job_settlement_amount(db, job)
    job.settlement_amount = amount
    if job.settlement_status not in {"confirmed", "paid"}:
        job.settlement_status = "waiting"
    return amount


def _sync_settlement_month_for_job(db: Session, job: Job) -> None:
    if job.assigned_transcriber_id is None or not _is_pdf_sent_job(job):
        return
    pdf_sent_at_by_job = _pdf_sent_at_by_job(db, [job.job_id])
    delivered_at = _job_delivered_at(job, pdf_sent_at_by_job)
    if delivered_at is None:
        return
    month_anchor = _as_kst_date(delivered_at)
    period_start, period_end = _month_period_for_date(month_anchor)
    grouped_entries = _build_grouped_settlement_entries(db, month_anchor=month_anchor, as_of=period_end)
    entries = grouped_entries.get((job.assigned_transcriber_id, period_start, period_end), [])
    if not entries:
        return
    settlement_by_key = _get_settlement_by_period(db)
    settlement = _upsert_settlement_entries(
        db,
        transcriber_id=job.assigned_transcriber_id,
        period_start=period_start,
        period_end=period_end,
        entries=entries,
        settlement_by_key=settlement_by_key,
    )
    for entry in entries:
        entry_job = entry["job"]
        entry_job.settlement_amount = float(entry["amount"])
        if entry_job.settlement_status not in {"confirmed", "paid"}:
            entry_job.settlement_status = settlement.status


def _ensure_pdf_sent_status_log(db: Session, job: Job) -> None:
    if not _is_pdf_sent_job(job):
        return
    existing = db.scalar(
        select(JobStatusLog.id)
        .where(JobStatusLog.job_id == job.job_id, JobStatusLog.to_status == "pdf_sent")
        .limit(1)
    )
    if existing is not None:
        return
    ts = job.completed_at or job.final_pdf_generated_at or job.finalized_at or datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(
        JobStatusLog(
            job_id=job.job_id,
            from_status=None,
            to_status="pdf_sent",
            change_note="최종 PDF 의뢰인 전달 (정산 동기화)",
            changed_by_transcriber_id=job.assigned_transcriber_id,
            changed_at=ts,
        )
    )
    db.flush()


def mark_final_pdf_delivered(db: Session, job: Job) -> Job:
    job_id = job.job_id
    if normalize_job_status(job.status) != PDF_SENT:
        job = set_job_status_resilient(db, job, PDF_SENT, "최종 PDF 의뢰인 전달")
    else:
        _ensure_pdf_sent_status_log(db, job)
        db.commit()
        db.refresh(job)

    try:
        _apply_job_settlement_on_pdf_delivered(db, job)
        db.commit()
        db.refresh(job)
    except Exception:
        db.rollback()
        logger.exception("settlement apply failed after pdf delivery job_id=%s", job_id)
        job = get_job_record(db, job_id)
        if job is None:
            raise RuntimeError(f"작업을 찾을 수 없습니다: {job_id}")
        if job.completed_at is None:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            job.completed_at = now
            if job.finalized_at is None:
                job.finalized_at = now
            db.commit()
            db.refresh(job)

    try:
        _sync_settlement_month_for_job(db, job)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("settlement sync failed after pdf delivery job_id=%s", job_id)

    job = get_job_record(db, job_id)
    if job is None:
        raise RuntimeError(f"작업을 찾을 수 없습니다: {job_id}")
    db.refresh(job)
    if normalize_job_status(job.status) != PDF_SENT:
        raise RuntimeError(f"PDF 전달 후 상태가 pdf_sent로 저장되지 않았습니다 (현재: {job.status})")
    return job


def repair_job_settlement(db: Session, job: Job) -> Job:
    """pdf_sent 작업의 작업비·settlement_items 누락을 복구합니다."""
    if job.assigned_transcriber_id is None:
        raise ValueError("배정된 속기사가 없어 정산할 수 없습니다.")
    if not _is_pdf_sent_job(job):
        raise ValueError("PDF 전달(pdf_sent) 상태가 아닙니다. 먼저 PDF 전달을 완료해 주세요.")
    _ensure_pdf_sent_status_log(db, job)
    _apply_job_settlement_on_pdf_delivered(db, job)
    _sync_settlement_month_for_job(db, job)
    db.commit()
    db.refresh(job)
    return job


def serialize_job(db: Session, job: Job, *, transcript_json: dict, audio_url: str) -> dict:
    visible_transcriber = _visible_transcriber_for_job(db, job)
    visible_status = _display_status_for_job(db, job)
    inquiry = inquiry_summary_for_job(db, job.job_id)
    return {
        "job_id": job.job_id,
        "voice_key": job.r2_voice_key,
        "transcript_key": job.r2_transcript_key,
        "audio_url": audio_url,
        "transcript_json": transcript_json,
        "title": job.title,
        "status": visible_status,
        "workflow_status": job.status,
        "priority": job.priority,
        "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
        "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
        "due_at": job.due_at.isoformat() if job.due_at else None,
        "client": {
            "id": job.client.id if job.client else None,
            "name": job.client.name if job.client else DEFAULT_CLIENT_NAME,
        },
        "transcriber": {
            "id": visible_transcriber.id if visible_transcriber else None,
            "name": visible_transcriber.name if visible_transcriber else None,
        },
        "project_id": job.project_id,
        "selected_segments": job.selected_segments_json or [],
        "final_pdf_ready": bool(job.final_pdf_r2_key),
        "final_pdf_filename": job.final_pdf_filename,
        "has_inquiry": inquiry["has_inquiry"],
        "client_inquiry_status": inquiry["client_inquiry_status"],
        "transcriber_inquiry_status": inquiry["transcriber_inquiry_status"],
        "admin_inquiry_badges": inquiry["admin_inquiry_badges"],
    }


def list_client_jobs(db: Session, member: Member | None = None) -> list[dict]:
    stmt = select(Job).order_by(Job.updated_at.desc())
    if member is not None:
        client = get_or_create_client_for_member(db, member)
        stmt = stmt.where(Job.client_id == client.id)
    for attempt in range(2):
        try:
            rows = db.scalars(stmt).all()
            break
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "selected_segments_json" not in message:
                raise
            _ensure_job_selected_segments_column(db)
    else:
        rows = []
    result: list[dict] = []
    for job in rows:
        inquiry = inquiry_summary_for_job(db, job.job_id)
        result.append(
            {
                "job_id": job.job_id,
                "title": job.title,
                "filename": job.original_filename,
                "status": _display_status_for_job(db, job),
                "workflow_status": job.status,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
                "client_name": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                "selected_segments": job.selected_segments_json or [],
                "pdf_ready": job.status == "pdf_sent",
                "final_pdf_filename": job.final_pdf_filename,
                "has_inquiry": inquiry["has_inquiry"],
                "client_inquiry_status": inquiry["client_inquiry_status"],
                "admin_inquiry_badges": inquiry["admin_inquiry_badges"],
            }
        )
    return result


def list_transcriber_jobs(db: Session, transcriber_code: str = DEFAULT_TRANSCRIBER_CODE) -> list[dict]:
    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        return []
    rows = db.scalars(
        select(Job)
        .where(Job.assigned_transcriber_id == transcriber.id, Job.status.in_(TRANSCRIBER_VISIBLE_JOB_STATUSES))
        .order_by(Job.updated_at.desc())
    ).all()
    result: list[dict] = []
    for job in rows:
        if not _has_manual_assignment(db, job.job_id):
            continue
        inquiry = inquiry_summary_for_job(db, job.job_id)
        result.append(
            {
                "job_id": job.job_id,
                "client": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                "title": job.title,
                "filename": job.original_filename,
                "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
                "due_at": job.due_at.isoformat() if job.due_at else None,
                "status": _display_status_for_job(db, job),
                "priority": job.priority,
                "has_inquiry": inquiry["has_inquiry"],
                "transcriber_inquiry_status": inquiry["transcriber_inquiry_status"],
                "admin_inquiry_badges": inquiry["admin_inquiry_badges"],
            }
        )
    return result


def generate_transcriber_code(db: Session) -> str:
    rows = db.scalars(select(Transcriber.transcriber_code)).all()
    max_num = 0
    for code in rows:
        match = re.fullmatch(r"TR-(\d+)", code or "")
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"TR-{max_num + 1:03d}"


def list_transcribers(db: Session) -> list[dict]:
    for attempt in range(2):
        try:
            rows = db.scalars(select(Transcriber).order_by(Transcriber.name.asc())).all()
            break
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "grade_level" not in message:
                raise
            _ensure_transcriber_grade_level_column(db)
    else:
        rows = []
    return [
        {
            "id": row.id,
            "code": row.transcriber_code,
            "name": row.name,
            "grade_level": row.grade_level,
            "phone": row.phone,
            "resident_id": row.resident_id_masked,
            "bank_name": row.bank_name,
            "account_holder": row.account_holder,
            "account_number": row.account_number,
            "specialty": row.specialty,
            "status": row.status,
            "monthly_capacity": row.monthly_capacity,
            "current_load": row.current_load,
            "unit_price": float(row.unit_price or 0),
            "quality_score": float(row.quality_score or 0),
            "login_id": row.login_id,
            "auth_status": row.auth_status,
        }
        for row in rows
    ]


def list_transcriber_grade_rates(db: Session) -> list[dict]:
    for attempt in range(2):
        try:
            rows = db.scalars(select(TranscriberGradeRate).order_by(TranscriberGradeRate.grade_level.asc())).all()
            break
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "transcriber_grade_rates" not in message:
                raise
            _ensure_transcriber_grade_rates_table(db)
    else:
        rows = []
    return [
        {
            "id": row.id,
            "grade_level": row.grade_level,
            "per_minute_rate": float(row.per_minute_rate or 0),
        }
        for row in rows
    ]


def upsert_transcriber_grade_rate(db: Session, grade_level: int, per_minute_rate: float) -> TranscriberGradeRate:
    if grade_level < 1 or grade_level > 5:
        raise ValueError("등급은 1등급부터 5등급까지 선택할 수 있습니다.")
    if per_minute_rate < 0:
        raise ValueError("분당 전사금액은 0원 이상이어야 합니다.")
    for attempt in range(2):
        try:
            rate = db.scalar(select(TranscriberGradeRate).where(TranscriberGradeRate.grade_level == grade_level))
            if rate is None:
                rate = TranscriberGradeRate(grade_level=grade_level, per_minute_rate=per_minute_rate)
                db.add(rate)
            else:
                rate.per_minute_rate = per_minute_rate
            db.commit()
            db.refresh(rate)
            return rate
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "transcriber_grade_rates" not in message:
                raise
            _ensure_transcriber_grade_rates_table(db)
    raise RuntimeError("Failed to save transcriber grade rate")


def delete_transcriber_grade_rate(db: Session, rate_id: int) -> None:
    for attempt in range(2):
        try:
            rate = db.scalar(select(TranscriberGradeRate).where(TranscriberGradeRate.id == rate_id))
            if rate is None:
                raise ValueError("등급별 요율을 찾을 수 없습니다.")
            db.delete(rate)
            db.commit()
            return
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "transcriber_grade_rates" not in message:
                raise
            _ensure_transcriber_grade_rates_table(db)


def _ensure_settlement_payment_storage(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        paid_column_exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'settlements'
                  AND COLUMN_NAME = 'total_paid_amount'
                LIMIT 1
                """
            )
        ).first()
        if not paid_column_exists:
            conn.execute(
                text(
                    "ALTER TABLE settlements "
                    "ADD COLUMN total_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER final_amount"
                )
            )

        payment_table_exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'settlement_payments'
                LIMIT 1
                """
            )
        ).first()
        if not payment_table_exists:
            conn.execute(
                text(
                    """
                    CREATE TABLE settlement_payments (
                      id BIGINT AUTO_INCREMENT PRIMARY KEY,
                      settlement_id BIGINT NOT NULL,
                      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                      paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      note VARCHAR(255) NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      CONSTRAINT fk_settlement_payments_settlement
                        FOREIGN KEY (settlement_id) REFERENCES settlements(id)
                        ON UPDATE CASCADE ON DELETE CASCADE,
                      KEY idx_settlement_payments_settlement_id (settlement_id),
                      KEY idx_settlement_payments_paid_at (paid_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                    """
                )
            )


def _ensure_payment_records_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        table_exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'payment_records'
                LIMIT 1
                """
            )
        ).first()
        if not table_exists:
            conn.execute(
                text(
                    """
                    CREATE TABLE payment_records (
                      id BIGINT AUTO_INCREMENT PRIMARY KEY,
                      payment_id VARCHAR(120) NOT NULL,
                      member_id BIGINT NULL,
                      member_name VARCHAR(100) NOT NULL,
                      order_name VARCHAR(255) NOT NULL,
                      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                      pay_method VARCHAR(50) NULL,
                      paid_at DATETIME NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      UNIQUE KEY uk_payment_records_payment_id (payment_id),
                      KEY idx_payment_records_member_id (member_id),
                      KEY idx_payment_records_paid_at (paid_at),
                      CONSTRAINT fk_payment_records_member
                        FOREIGN KEY (member_id) REFERENCES members(id)
                        ON UPDATE CASCADE ON DELETE SET NULL
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                    """
                )
            )


def _duration_ms_from_selected_segments(segments: list | str | None) -> int:
    if not segments:
        return 0
    if isinstance(segments, str):
        try:
            import json

            segments = json.loads(segments)
        except Exception:
            return 0
    if not isinstance(segments, list):
        return 0
    total_ms = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        if segment.get("selected", True) is False:
            continue
        start_ms = int(segment.get("start_ms") or 0)
        end_ms = int(segment.get("end_ms") or 0)
        total_ms += max(0, end_ms - start_ms)
    return total_ms


def _duration_seconds_from_transcript_json(transcript_json: dict | None) -> int | None:
    if not transcript_json:
        return None
    max_end_ms = 0
    for token in transcript_json.get("tokens") or []:
        if not isinstance(token, dict):
            continue
        end_ms = token.get("end_ms")
        if isinstance(end_ms, (int, float)) and end_ms > max_end_ms:
            max_end_ms = int(end_ms)
    for segment in transcript_json.get("segments") or []:
        if not isinstance(segment, dict):
            continue
        end_ms = segment.get("end_ms")
        if isinstance(end_ms, (int, float)) and end_ms > max_end_ms:
            max_end_ms = int(end_ms)
    if max_end_ms <= 0:
        return None
    return max_end_ms // 1000


def _try_load_transcript_for_job(job: Job) -> dict | None:
    try:
        import json

        from app.services.r2 import get_object_bytes, get_transcript_json

        if job.r2_transcript_key:
            return json.loads(get_object_bytes(job.r2_transcript_key).decode("utf-8"))
        return get_transcript_json(job.job_id)
    except Exception:
        logger.warning("transcript load failed for settlement duration job_id=%s", job.job_id, exc_info=True)
        return None


def _resolve_job_duration_seconds(job: Job, *, transcript_json: dict | None = None) -> int:
    stored = int(job.duration_seconds or 0)
    if stored > 0:
        return stored
    from_segments = _duration_ms_from_selected_segments(job.selected_segments_json)
    if from_segments > 0:
        return from_segments // 1000
    if transcript_json is None:
        transcript_json = _try_load_transcript_for_job(job)
    from_transcript = _duration_seconds_from_transcript_json(transcript_json)
    return int(from_transcript or 0)


def _ensure_job_duration_seconds(job: Job, *, transcript_json: dict | None = None) -> int:
    resolved = _resolve_job_duration_seconds(job, transcript_json=transcript_json)
    if resolved > 0 and int(job.duration_seconds or 0) <= 0:
        job.duration_seconds = resolved
    return resolved


def _round_settlement_minutes(duration_seconds: int | None) -> int:
    seconds = int(duration_seconds or 0)
    if seconds <= 0:
        return 0
    return int((seconds + 30) // 60)


def _month_period(target: datetime) -> tuple[date, date]:
    return _month_period_for_date(_as_kst_date(target))


def _month_period_for_date(anchor: date) -> tuple[date, date]:
    period_start = date(anchor.year, anchor.month, 1)
    if anchor.month == 12:
        next_month = date(anchor.year + 1, 1, 1)
    else:
        next_month = date(anchor.year, anchor.month + 1, 1)
    return period_start, next_month - timedelta(days=1)


def _as_kst_date(value: datetime) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(KST).date()


def _pdf_sent_at_by_job(db: Session, job_ids: list[str]) -> dict[str, datetime]:
    if not job_ids:
        return {}
    pdf_sent_at_by_job: dict[str, datetime] = {}
    status_logs = db.scalars(
        select(JobStatusLog)
        .where(
            JobStatusLog.job_id.in_(job_ids),
            JobStatusLog.to_status == "pdf_sent",
        )
        .order_by(JobStatusLog.changed_at.desc())
    ).all()
    for row in status_logs:
        pdf_sent_at_by_job.setdefault(row.job_id, row.changed_at)
    return pdf_sent_at_by_job


def _job_delivered_at(job: Job, pdf_sent_at_by_job: dict[str, datetime]) -> datetime | None:
    logged = pdf_sent_at_by_job.get(job.job_id)
    if logged is not None:
        return logged
    if not _is_pdf_sent_job(job):
        return None
    return (
        job.completed_at
        or job.final_pdf_generated_at
        or job.finalized_at
        or job.updated_at
    )


def backfill_completed_job_durations(db: Session) -> int:
    """pdf_sent 작업의 duration_seconds·completed_at·settlement_amount 를 보정합니다."""
    jobs = db.scalars(
        select(Job).where(
            _settlement_eligible_jobs_filter(),
            Job.assigned_transcriber_id.is_not(None),
        )
    ).all()
    updated = 0
    for job in jobs:
        touched = False
        if int(job.duration_seconds or 0) <= 0 and _ensure_job_duration_seconds(job) > 0:
            touched = True
        needs_settlement = (
            job.completed_at is None
            or float(job.settlement_amount or 0) <= 0
        )
        if needs_settlement:
            _apply_job_settlement_on_pdf_delivered(db, job)
            touched = True
        if touched:
            updated += 1
    if updated:
        db.commit()
    return updated


def _build_grouped_settlement_entries(
    db: Session,
    *,
    month_anchor: date,
    as_of: date | None = None,
) -> dict[tuple[int, date, date], list[dict]]:
    _ensure_transcriber_grade_rates_table(db)
    target_period_start, target_period_end = _month_period_for_date(month_anchor)
    cutoff = as_of or target_period_end

    completed_jobs = db.scalars(
        select(Job).where(
            _settlement_eligible_jobs_filter(),
            Job.assigned_transcriber_id.is_not(None),
        )
    ).all()
    pdf_sent_at_by_job = _pdf_sent_at_by_job(db, [job.job_id for job in completed_jobs])
    rates_by_grade = {
        int(row["grade_level"]): float(row["per_minute_rate"] or 0)
        for row in list_transcriber_grade_rates(db)
    }

    grouped_entries: dict[tuple[int, date, date], list[dict]] = {}
    for job in completed_jobs:
        transcriber = job.transcriber
        if transcriber is None:
            continue
        delivered_at = _job_delivered_at(job, pdf_sent_at_by_job)
        if delivered_at is None:
            continue
        delivered_date = _as_kst_date(delivered_at)
        period_start, period_end = _month_period_for_date(delivered_date)
        if period_start != target_period_start:
            continue
        if delivered_date > cutoff:
            continue
        duration_seconds = _ensure_job_duration_seconds(job)
        quantity_minutes = _round_settlement_minutes(duration_seconds)
        unit_price = _resolve_settlement_unit_price(transcriber, rates_by_grade)
        amount = float(unit_price * quantity_minutes)
        if amount <= 0 and quantity_minutes > 0:
            logger.warning(
                "settlement amount zero with billable minutes job_id=%s transcriber_id=%s grade=%s minutes=%s unit_price=%s",
                job.job_id,
                transcriber.id,
                transcriber.grade_level,
                quantity_minutes,
                unit_price,
            )
        grouped_entries.setdefault((transcriber.id, period_start, period_end), []).append(
            {
                "job": job,
                "unit_price": unit_price,
                "quantity_minutes": quantity_minutes,
                "amount": amount,
            }
        )
    return grouped_entries


def _get_settlement_by_period(
    db: Session,
    settlements: list[Settlement] | None = None,
) -> dict[tuple[int, date, date], Settlement]:
    rows = settlements if settlements is not None else db.scalars(select(Settlement).order_by(Settlement.created_at.desc())).all()
    settlement_by_key: dict[tuple[int, date, date], Settlement] = {}
    for settlement in rows:
        key = (settlement.transcriber_id, settlement.period_start, settlement.period_end)
        if key not in settlement_by_key:
            settlement_by_key[key] = settlement
    return settlement_by_key


def _upsert_settlement_entries(
    db: Session,
    *,
    transcriber_id: int,
    period_start: date,
    period_end: date,
    entries: list[dict],
    settlement_by_key: dict[tuple[int, date, date], Settlement] | None = None,
) -> Settlement:
    lookup = settlement_by_key if settlement_by_key is not None else _get_settlement_by_period(db)
    settlement = lookup.get((transcriber_id, period_start, period_end))
    if settlement is None:
        settlement = Settlement(
            settlement_no=_build_settlement_no(transcriber_id, period_start),
            transcriber_id=transcriber_id,
            period_start=period_start,
            period_end=period_end,
            total_jobs=0,
            total_minutes=0,
            gross_amount=0,
            adjustment_amount=0,
            final_amount=0,
            total_paid_amount=0,
            status="waiting",
        )
        db.add(settlement)
        db.flush()
        lookup[(transcriber_id, period_start, period_end)] = settlement

    existing_items = {
        item.job_id: item
        for item in db.scalars(select(SettlementItem).where(SettlementItem.settlement_id == settlement.id)).all()
    }

    total_jobs = 0
    total_minutes = 0
    gross_amount = 0.0
    desired_job_ids: set[str] = set()

    for entry in entries:
        job = entry["job"]
        desired_job_ids.add(job.job_id)
        total_jobs += 1
        total_minutes += int(entry["quantity_minutes"])
        gross_amount += float(entry["amount"])

        item = existing_items.get(job.job_id)
        if item is None:
            item = SettlementItem(
                settlement_id=settlement.id,
                job_id=job.job_id,
                transcriber_id=transcriber_id,
            )
            db.add(item)

        item.transcriber_id = transcriber_id
        item.unit_price = float(entry["unit_price"])
        item.quantity_minutes = int(entry["quantity_minutes"])
        item.amount = float(entry["amount"])
        item.adjustment_amount = 0
        item.final_amount = float(entry["amount"])

    for job_id, item in existing_items.items():
        if job_id not in desired_job_ids:
            db.delete(item)

    settlement.total_jobs = total_jobs
    settlement.total_minutes = total_minutes
    settlement.gross_amount = gross_amount
    settlement.adjustment_amount = 0
    settlement.final_amount = gross_amount
    settlement.status = _settlement_status_for_amounts(
        float(settlement.total_paid_amount or 0),
        float(settlement.final_amount or 0),
    )
    if settlement.status == "waiting" and float(settlement.total_paid_amount or 0) <= 0:
        settlement.paid_at = None
    return settlement


def _serialize_settlement_snapshot_row(
  db: Session,
  *,
  transcriber: Transcriber,
  period_start: date,
  period_end: date,
  as_of: date,
  entries: list[dict],
  settlement: Settlement | None,
) -> dict:
    jobs = len(entries)
    total_minutes = sum(int(entry["quantity_minutes"]) for entry in entries)
    amount = sum(float(entry["amount"]) for entry in entries)
    unit_price = float(entries[0]["unit_price"]) if entries else 0.0
    status = settlement.status if settlement is not None else "waiting"
    total_paid_amount = float(settlement.total_paid_amount or 0) if settlement is not None else 0.0
    if settlement is not None and status in {"confirmed", "paid"}:
        jobs = int(settlement.total_jobs or jobs)
        total_minutes = int(settlement.total_minutes or total_minutes)
        amount = float(settlement.final_amount or amount)
    withholding = _settlement_withholding_breakdown(amount)
    net_pay_amount = float(withholding["net_pay_amount"])
    can_confirm = status not in {"confirmed", "paid"} and jobs > 0
    can_pay = status == "confirmed" and total_paid_amount < net_pay_amount
    return {
        "settlement_id": settlement.id if settlement is not None else None,
        "transcriber_id": transcriber.id,
        "transcriber_code": transcriber.transcriber_code,
        "transcriber_name": transcriber.name,
        "bank_name": transcriber.bank_name or "",
        "account_number": transcriber.account_number or "",
        "account_holder": transcriber.account_holder or "",
        "month": f"{period_start:%Y-%m}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "as_of": as_of.isoformat(),
        "jobs": jobs,
        "total_minutes": total_minutes,
        "unit_price": unit_price,
        "amount": amount,
        "income_tax": withholding["income_tax"],
        "local_tax": withholding["local_tax"],
        "total_withholding": withholding["total_withholding"],
        "net_pay_amount": net_pay_amount,
        "status": status,
        "total_paid_amount": total_paid_amount,
        "confirmed_at": settlement.confirmed_at.isoformat() if settlement and settlement.confirmed_at else None,
        "paid_at": settlement.paid_at.isoformat() if settlement and settlement.paid_at else None,
        "can_confirm": can_confirm,
        "can_pay": can_pay,
    }


def list_settlement_snapshots(db: Session, as_of: date) -> dict:
    _ensure_settlement_payment_storage(db)
    try:
        backfill_completed_job_durations(db)
    except Exception:
        logger.exception("settlement duration backfill failed")
        db.rollback()
    try:
        sync_generated_settlements(db)
    except Exception:
        logger.exception("settlement sync failed")
        db.rollback()
    period_start, period_end = _month_period_for_date(as_of)
    grouped_entries = _build_grouped_settlement_entries(db, month_anchor=as_of, as_of=as_of)
    settlement_by_key = _get_settlement_by_period(db)
    transcribers = db.scalars(select(Transcriber).where(Transcriber.is_active == 1).order_by(Transcriber.name.asc())).all()

    rows: list[dict] = []
    for transcriber in transcribers:
        key = (transcriber.id, period_start, period_end)
        entries = grouped_entries.get(key, [])
        settlement = settlement_by_key.get(key)
        rows.append(
            _serialize_settlement_snapshot_row(
                db,
                transcriber=transcriber,
                period_start=period_start,
                period_end=period_end,
                as_of=as_of,
                entries=entries,
                settlement=settlement,
            )
        )

    rows.sort(key=lambda row: (-float(row["amount"]), row["transcriber_name"]))
    total_amount = sum(float(row["amount"]) for row in rows)
    total_net_pay = sum(float(row["net_pay_amount"]) for row in rows)
    total_jobs = sum(int(row["jobs"]) for row in rows)
    return {
        "as_of": as_of.isoformat(),
        "month": f"{period_start:%Y-%m}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "summary": {
            "transcriber_count": len(transcribers),
            "active_settlement_count": sum(1 for row in rows if row["jobs"] > 0),
            "total_jobs": total_jobs,
            "total_amount": total_amount,
            "total_net_pay_amount": total_net_pay,
        },
        "rows": rows,
    }


def resync_settlement_snapshots(db: Session) -> dict:
    """정산 스냅샷 전체를 강제 재계산합니다."""
    _ensure_settlement_payment_storage(db)
    duration_updated = backfill_completed_job_durations(db)
    sync_generated_settlements(db)
    return {"duration_updated": duration_updated, "synced": True}


def confirm_settlement_snapshot(
    db: Session,
    *,
    transcriber_id: int,
    as_of: date,
    admin: AdminUser | None = None,
) -> Settlement:
    _ensure_settlement_payment_storage(db)
    transcriber = db.scalar(select(Transcriber).where(Transcriber.id == transcriber_id))
    if transcriber is None:
        raise ValueError("속기사를 찾을 수 없습니다.")

    period_start, period_end = _month_period_for_date(as_of)
    grouped_entries = _build_grouped_settlement_entries(db, month_anchor=as_of, as_of=as_of)
    entries = grouped_entries.get((transcriber_id, period_start, period_end), [])
    if not entries:
        raise ValueError("확정할 정산 내역이 없습니다.")

    settlement_by_key = _get_settlement_by_period(db)
    existing = settlement_by_key.get((transcriber_id, period_start, period_end))
    if existing is not None and existing.status == "paid":
        raise ValueError("이미 지급 완료된 정산은 다시 확정할 수 없습니다.")

    settlement = _upsert_settlement_entries(
        db,
        transcriber_id=transcriber_id,
        period_start=period_start,
        period_end=period_end,
        entries=entries,
        settlement_by_key=settlement_by_key,
    )

    for entry in entries:
        job = entry["job"]
        job.settlement_amount = float(entry["amount"])
        job.settlement_status = "confirmed"

    settlement = update_settlement_status(db, settlement, "confirmed", admin=admin)
    return settlement


def _build_settlement_no(transcriber_id: int, period_start: date) -> str:
    return f"SET-{period_start:%Y%m}-{transcriber_id:04d}"


def _settlement_withholding_breakdown(gross_amount: float) -> dict[str, float]:
    gross = float(gross_amount or 0)
    income_tax = round(gross * 0.03)
    local_tax = round(gross * 0.003)
    total_withholding = income_tax + local_tax
    net_pay_amount = gross - total_withholding
    return {
        "gross_amount": gross,
        "income_tax": float(income_tax),
        "local_tax": float(local_tax),
        "total_withholding": float(total_withholding),
        "net_pay_amount": float(net_pay_amount),
    }


def _settlement_status_for_amounts(total_paid_amount: float, final_amount: float) -> str:
    net_pay_amount = _settlement_withholding_breakdown(final_amount)["net_pay_amount"]
    if total_paid_amount > 0:
        return "paid" if total_paid_amount >= net_pay_amount else "confirmed"
    return "waiting"


def _build_all_grouped_settlement_entries(db: Session) -> dict[tuple[int, date, date], list[dict]]:
    _ensure_transcriber_grade_rates_table(db)
    completed_jobs = db.scalars(
        select(Job).where(
            _settlement_eligible_jobs_filter(),
            Job.assigned_transcriber_id.is_not(None),
        )
    ).all()
    pdf_sent_at_by_job = _pdf_sent_at_by_job(db, [job.job_id for job in completed_jobs])
    rates_by_grade = {
        int(row["grade_level"]): float(row["per_minute_rate"] or 0)
        for row in list_transcriber_grade_rates(db)
    }

    grouped_entries: dict[tuple[int, date, date], list[dict]] = {}
    for job in completed_jobs:
        transcriber = job.transcriber
        if transcriber is None:
            continue
        delivered_at = _job_delivered_at(job, pdf_sent_at_by_job)
        if delivered_at is None:
            continue
        period_start, period_end = _month_period_for_date(_as_kst_date(delivered_at))
        duration_seconds = _ensure_job_duration_seconds(job)
        quantity_minutes = _round_settlement_minutes(duration_seconds)
        unit_price = _resolve_settlement_unit_price(transcriber, rates_by_grade)
        amount = float(unit_price * quantity_minutes)
        grouped_entries.setdefault((transcriber.id, period_start, period_end), []).append(
            {
                "job": job,
                "unit_price": unit_price,
                "quantity_minutes": quantity_minutes,
                "amount": amount,
            }
        )
    return grouped_entries


def sync_generated_settlements(db: Session) -> None:
    _ensure_settlement_payment_storage(db)
    grouped_entries = _build_all_grouped_settlement_entries(db)
    settlement_by_key = _get_settlement_by_period(db)
    settlement_status_by_job: dict[str, str] = {}
    settlement_amount_by_job: dict[str, float] = {}

    for key, entries in grouped_entries.items():
        transcriber_id, period_start, period_end = key
        settlement = _upsert_settlement_entries(
            db,
            transcriber_id=transcriber_id,
            period_start=period_start,
            period_end=period_end,
            entries=entries,
            settlement_by_key=settlement_by_key,
        )
        for entry in entries:
            job = entry["job"]
            settlement_amount_by_job[job.job_id] = float(entry["amount"])
            settlement_status_by_job[job.job_id] = settlement.status

    completed_jobs = db.scalars(
        select(Job).where(
            _settlement_eligible_jobs_filter(),
            Job.assigned_transcriber_id.is_not(None),
        )
    ).all()
    for job in completed_jobs:
        _ensure_job_duration_seconds(job)
        computed = settlement_amount_by_job.get(job.job_id)
        if computed is None:
            computed = _compute_job_settlement_amount(db, job)
        job.settlement_amount = float(computed or 0)
        job.settlement_status = settlement_status_by_job.get(job.job_id, job.settlement_status or "waiting")

    stale_jobs = db.scalars(
        select(Job).where(
            Job.status.not_in(SETTLEMENT_ELIGIBLE_JOB_STATUSES),
            or_(Job.settlement_amount != 0, Job.settlement_status != "waiting"),
        )
    ).all()
    for job in stale_jobs:
        job.settlement_amount = 0
        job.settlement_status = "waiting"

    db.commit()


def record_settlement_payment(
    db: Session,
    settlement: Settlement,
    amount: float,
    note: str | None = None,
    *,
    admin: AdminUser | None = None,
) -> Settlement:
    if amount <= 0:
        raise ValueError("입금액은 0보다 커야 합니다.")
    for attempt in range(2):
        try:
            payment = SettlementPayment(
                settlement_id=settlement.id,
                amount=amount,
                paid_at=datetime.now(timezone.utc).replace(tzinfo=None),
                note=(note or "").strip() or None,
            )
            db.add(payment)
            settlement.total_paid_amount = float(settlement.total_paid_amount or 0) + amount
            settlement.paid_at = payment.paid_at
            settlement.status = "paid" if settlement.total_paid_amount >= float(settlement.final_amount or 0) else "confirmed"
            if admin is not None and settlement.confirmed_by_admin_id is None:
                settlement.confirmed_at = payment.paid_at
                settlement.confirmed_by_admin_id = admin.id
            db.commit()
            db.refresh(settlement)
            return settlement
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or ("settlement_payments" not in message and "total_paid_amount" not in message):
                raise
            _ensure_settlement_payment_storage(db)
    raise RuntimeError("Failed to record settlement payment")


def _payment_record_datetime_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    iso = value.isoformat()
    if value.tzinfo is None and not iso.endswith("Z") and "+" not in iso[-6:]:
        return f"{iso}Z"
    return iso


def record_payment_record(
    db: Session,
    *,
    payment_id: str,
    member: Member,
    order_name: str,
    amount: float,
    pay_method: str | None,
    paid_at: datetime | None,
) -> tuple[PaymentRecord, bool]:
    safe_payment_id = payment_id.strip()[:120]
    safe_member_name = (member.name or "").strip()[:100] or "의뢰인"
    safe_order_name = (order_name or "").strip()[:255] or safe_payment_id
    safe_pay_method = (pay_method or "").strip()[:50] or None
    resolved_paid_at = paid_at or datetime.now(timezone.utc).replace(tzinfo=None)

    for attempt in range(2):
        try:
            record = db.scalar(select(PaymentRecord).where(PaymentRecord.payment_id == safe_payment_id))
            created = record is None
            if record is None:
                record = PaymentRecord(payment_id=safe_payment_id)
                db.add(record)

            record.member_id = member.id
            record.member_name = safe_member_name
            record.order_name = safe_order_name
            record.amount = amount
            record.pay_method = safe_pay_method
            record.paid_at = resolved_paid_at
            db.commit()
            db.refresh(record)
            return record, created
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "payment_records" not in message:
                raise
            _ensure_payment_records_table(db)
        except (DataError, IntegrityError, SQLAlchemyError):
            db.rollback()
            raise
    raise RuntimeError("Failed to record payment record")


def list_payment_records(db: Session) -> list[dict]:
    for attempt in range(2):
        try:
            rows = db.scalars(select(PaymentRecord).order_by(PaymentRecord.paid_at.desc(), PaymentRecord.id.desc())).all()
            break
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "payment_records" not in message:
                raise
            _ensure_payment_records_table(db)
    else:
        rows = []
    return [
        {
            "id": row.id,
            "payment_id": row.payment_id,
            "member_name": row.member_name,
            "order_name": row.order_name,
            "amount": float(row.amount or 0),
            "pay_method": row.pay_method,
            "paid_at": _payment_record_datetime_iso(row.paid_at or row.created_at),
            "created_at": _payment_record_datetime_iso(row.created_at),
            "status": "paid",
        }
        for row in rows
    ]


def get_transcriber_by_code(db: Session, transcriber_code: str = DEFAULT_TRANSCRIBER_CODE) -> Transcriber | None:
    return db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))


def create_transcriber(
    db: Session,
    *,
    code: str | None = None,
    name: str,
    grade_level: int = 1,
    specialty: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    resident_id: str | None = None,
    bank_name: str | None = None,
    account_number: str | None = None,
    account_holder: str | None = None,
    unit_price: float = 0,
    monthly_capacity: int | None = None,
    status: str = "available",
) -> Transcriber:
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("Transcriber name is required")
    if grade_level < 1 or grade_level > 5:
        raise ValueError("등급은 1등급부터 5등급까지 선택할 수 있습니다.")

    transcriber_code = (code or "").strip() or generate_transcriber_code(db)
    for attempt in range(2):
        transcriber = Transcriber(
            transcriber_code=transcriber_code,
            name=normalized_name,
            grade_level=grade_level,
            specialty=(specialty or "").strip() or None,
            email=(email or "").strip() or None,
            phone=(phone or "").strip() or None,
            resident_id_masked=(resident_id or "").strip() or None,
            bank_name=(bank_name or "").strip() or None,
            account_number=(account_number or "").strip() or None,
            account_holder=(account_holder or "").strip() or normalized_name,
            unit_price=unit_price,
            monthly_capacity=monthly_capacity,
            status=status,
            current_load=0,
            auth_status="pending_signup",
        )
        try:
            db.add(transcriber)
            db.commit()
            db.refresh(transcriber)
            return transcriber
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "grade_level" not in message:
                raise
            _ensure_transcriber_grade_level_column(db)
    raise RuntimeError("Failed to create transcriber")


def update_transcriber(
    db: Session,
    transcriber: Transcriber,
    *,
    name: str | None = None,
    grade_level: int | None = None,
    specialty: str | None = None,
    phone: str | None = None,
    resident_id: str | None = None,
    bank_name: str | None = None,
    account_number: str | None = None,
    account_holder: str | None = None,
    unit_price: float | None = None,
    monthly_capacity: int | None = None,
    status: str | None = None,
) -> Transcriber:
    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Transcriber name is required")
        transcriber.name = normalized_name
    if account_holder is not None:
        transcriber.account_holder = account_holder.strip() or None
    elif name is not None and not transcriber.account_holder:
        transcriber.account_holder = normalized_name
    if grade_level is not None:
        if grade_level < 1 or grade_level > 5:
            raise ValueError("등급은 1등급부터 5등급까지 선택할 수 있습니다.")
        transcriber.grade_level = grade_level
    if specialty is not None:
        transcriber.specialty = specialty.strip() or None
    if phone is not None:
        transcriber.phone = phone.strip() or None
    if resident_id is not None:
        transcriber.resident_id_masked = resident_id.strip() or None
    if bank_name is not None:
        transcriber.bank_name = bank_name.strip() or None
    if account_number is not None:
        transcriber.account_number = account_number.strip() or None
    if unit_price is not None:
        transcriber.unit_price = unit_price
    if monthly_capacity is not None:
        transcriber.monthly_capacity = monthly_capacity
    if status is not None:
        transcriber.status = status
    for attempt in range(2):
        try:
            db.commit()
            db.refresh(transcriber)
            return transcriber
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "grade_level" not in message:
                raise
            _ensure_transcriber_grade_level_column(db)
            if name is not None:
                transcriber.name = normalized_name
            if account_holder is not None:
                transcriber.account_holder = account_holder.strip() or None
            elif name is not None and not transcriber.account_holder:
                transcriber.account_holder = normalized_name
            if grade_level is not None:
                transcriber.grade_level = grade_level
            if specialty is not None:
                transcriber.specialty = specialty.strip() or None
            if phone is not None:
                transcriber.phone = phone.strip() or None
            if resident_id is not None:
                transcriber.resident_id_masked = resident_id.strip() or None
            if bank_name is not None:
                transcriber.bank_name = bank_name.strip() or None
            if account_number is not None:
                transcriber.account_number = account_number.strip() or None
            if unit_price is not None:
                transcriber.unit_price = unit_price
            if monthly_capacity is not None:
                transcriber.monthly_capacity = monthly_capacity
            if status is not None:
                transcriber.status = status
    raise RuntimeError("Failed to update transcriber")


def delete_transcriber(db: Session, transcriber: Transcriber) -> None:
    transcriber_id = transcriber.id
    _ensure_settlement_payment_storage(db)

    settlement_items = db.scalars(select(SettlementItem).where(SettlementItem.transcriber_id == transcriber_id)).all()
    for item in settlement_items:
        db.delete(item)

    settlements = db.scalars(select(Settlement).where(Settlement.transcriber_id == transcriber_id)).all()
    for settlement in settlements:
        db.delete(settlement)

    assignments = db.scalars(
        select(JobAssignment).where(
            or_(
                JobAssignment.from_transcriber_id == transcriber_id,
                JobAssignment.to_transcriber_id == transcriber_id,
            )
        )
    ).all()
    for assignment in assignments:
        db.delete(assignment)

    assigned_jobs = db.scalars(select(Job).where(Job.assigned_transcriber_id == transcriber_id)).all()
    for job in assigned_jobs:
        job.assigned_transcriber_id = None
        job.assigned_at = None
        if normalize_job_status(job.status) in ACTIVE_JOB_STATUSES:
            job.status = WAITING_ASSIGNMENT

    db.delete(transcriber)
    db.commit()


def delete_job_if_unassigned(db: Session, job: Job) -> None:
    if normalize_job_status(job.status) not in {WAITING_ASSIGNMENT} or job.assigned_transcriber_id is not None:
        raise ValueError("Only unassigned jobs can be cancelled")

    assignments = db.scalars(select(JobAssignment).where(JobAssignment.job_id == job.job_id)).all()
    for assignment in assignments:
        db.delete(assignment)

    status_logs = db.scalars(select(JobStatusLog).where(JobStatusLog.job_id == job.job_id)).all()
    for log in status_logs:
        db.delete(log)

    db.delete(job)
    db.commit()


def get_settlement_record(db: Session, settlement_id: int) -> Settlement | None:
    _ensure_settlement_payment_storage(db)
    return db.scalar(select(Settlement).where(Settlement.id == settlement_id))


def update_settlement_status(
    db: Session,
    settlement: Settlement,
    status: str,
    *,
    admin: AdminUser | None = None,
) -> Settlement:
    settlement.status = status
    if status == "confirmed":
        settlement.confirmed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        settlement.confirmed_by_admin_id = admin.id if admin else None
    if status == "paid":
        settlement.paid_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if settlement.confirmed_at is None:
            settlement.confirmed_at = settlement.paid_at
            settlement.confirmed_by_admin_id = admin.id if admin else None
    db.commit()
    db.refresh(settlement)
    return settlement


def get_invoice_record(db: Session, invoice_id: int) -> Invoice | None:
    return db.scalar(select(Invoice).where(Invoice.id == invoice_id))


def update_invoice_status(db: Session, invoice: Invoice, status: str) -> Invoice:
    invoice.invoice_status = status
    db.commit()
    db.refresh(invoice)
    return invoice


def _dashboard_overview_jobs(db: Session, jobs: list[Job], display_statuses: dict[str, str]) -> list[dict]:
    rows: list[dict] = []
    for job in jobs:
        try:
            inquiry = inquiry_summary_for_job(db, job.job_id)
            visible_transcriber = _visible_transcriber_for_job(db, job)
            rows.append(
                {
                    "id": job.job_id,
                    "project_id": job.project_id,
                    "client": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                    "title": job.title,
                    "filename": job.original_filename,
                    "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
                    "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
                    "due_at": job.due_at.isoformat() if job.due_at else None,
                    "priority": job.priority,
                    "status": display_statuses.get(job.job_id, normalize_job_status(job.status)),
                    "assignee": visible_transcriber.name if visible_transcriber else "-",
                    "progress": _progress_for_status(display_statuses.get(job.job_id, normalize_job_status(job.status))),
                    "duration": _format_duration(job.duration_seconds),
                    "sales_amount": float(job.sales_amount or 0),
                    "settlement_amount": float(job.settlement_amount or 0),
                    "payment_status": job.payment_status,
                    "settlement_status": job.settlement_status,
                    "has_inquiry": inquiry["has_inquiry"],
                    "admin_inquiry_badges": inquiry["admin_inquiry_badges"],
                }
            )
        except Exception:
            db.rollback()
    return rows


def safe_list_payment_records(db: Session) -> list[dict]:
    try:
        return list_payment_records(db)
    except Exception:
        db.rollback()
        return []


def dashboard_overview(db: Session) -> dict:
    payment_records = safe_list_payment_records(db)
    try:
        sync_generated_settlements(db)
    except Exception:
        db.rollback()
    jobs: list[Job] = []
    try:
        for attempt in range(2):
            try:
                jobs = db.scalars(select(Job).order_by(Job.updated_at.desc()).limit(50)).all()
                break
            except (OperationalError, ProgrammingError) as exc:
                message = str(exc).lower()
                if attempt == 1 or "selected_segments_json" not in message:
                    raise
                _ensure_job_selected_segments_column(db)
    except Exception:
        db.rollback()
        jobs = []
    try:
        transcribers = list_transcribers(db)
    except Exception:
        db.rollback()
        transcribers = []
    try:
        settlements = db.scalars(select(Settlement).order_by(Settlement.created_at.desc()).limit(20)).all()
    except Exception:
        db.rollback()
        settlements = []
    try:
        display_statuses = {job.job_id: _display_status_for_job(db, job) for job in jobs}
    except Exception:
        db.rollback()
        display_statuses = {}

    total_sales = sum(float(job.final_bill_amount or job.sales_amount or 0) for job in jobs)
    total_settlements = sum(float(job.settlement_amount or 0) for job in jobs)
    outstanding = sum(
        float(job.final_bill_amount or job.sales_amount or 0)
        for job in jobs
        if job.payment_status != "paid"
    )

    from app.services.member_auth import list_members_admin
    from app.services.project_store import list_projects

    try:
        projects = list_projects(db, include_files=True)
    except Exception:
        db.rollback()
        projects = []
    try:
        members = list_members_admin(db)
    except Exception:
        db.rollback()
        members = []
    try:
        grade_rates = list_transcriber_grade_rates(db)
    except Exception:
        db.rollback()
        grade_rates = []

    return {
        "stats": {
            "total_jobs": len(jobs),
            "waiting_assignment": sum(1 for job in jobs if display_statuses[job.job_id] == "waiting_assignment"),
            "working": sum(
                1
                for job in jobs
                if display_statuses[job.job_id]
                in {WORKING, CLIENT_REVIEW, TRANSCRIBER_REVIEW, TRANSCRIPT_REQUEST}
            ),
            "final_done": sum(1 for job in jobs if display_statuses[job.job_id] == PDF_SENT),
            "total_sales": total_sales,
            "total_settlements": total_settlements,
            "outstanding": outstanding,
        },
        "projects": projects,
        "members": members,
        "jobs": _dashboard_overview_jobs(db, jobs, display_statuses),
        "transcribers": transcribers,
        "transcriber_grade_rates": grade_rates,
        "settlements": [
            {
                "id": row.id,
                "month": f"{row.period_start:%Y-%m}",
                "transcriber_id": row.transcriber_id,
                "transcriber": (
                    db.scalar(select(Transcriber.name).where(Transcriber.id == row.transcriber_id)) or row.transcriber_id
                ),
                "jobs": row.total_jobs,
                "amount": float(row.final_amount or 0),
                "total_paid_amount": float(row.total_paid_amount or 0),
                "status": row.status,
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in settlements
        ],
        "sales": payment_records,
    }


def _progress_for_status(status: str) -> int:
    canonical = normalize_job_status(status)
    mapping = {
        WAITING_ASSIGNMENT: 15,
        WORKING: 40,
        CLIENT_REVIEW: 60,
        TRANSCRIBER_REVIEW: 75,
        TRANSCRIPT_REQUEST: 90,
        PDF_SENT: 100,
        CANCELLED: 0,
    }
    return mapping.get(canonical, 0)


def _format_duration(seconds: int | None) -> str:
    if not seconds:
        return "--:--:--"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _sync_transcriber_load(db: Session, transcriber_id: int | None) -> None:
    if transcriber_id is None:
        return
    transcriber = db.scalar(select(Transcriber).where(Transcriber.id == transcriber_id))
    if transcriber is None:
        return
    jobs = db.scalars(
        select(Job).where(Job.assigned_transcriber_id == transcriber_id, Job.status.in_(ACTIVE_JOB_STATUSES))
    ).all()
    transcriber.current_load = len(jobs)
    db.commit()
