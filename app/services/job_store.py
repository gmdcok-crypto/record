import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import OperationalError, ProgrammingError
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
    Settlement,
    SettlementItem,
    TranscriberGradeRate,
    Transcriber,
)

DEFAULT_ADMIN_EMAIL = "ops@bluecom.local"
DEFAULT_ADMIN_NAME = "운영관리자"
DEFAULT_TRANSCRIBER_CODE = "TR-001"
DEFAULT_CLIENT_CODE = "CLIENT-DEFAULT"
DEFAULT_CLIENT_NAME = "일반 의뢰인"
ACTIVE_JOB_STATUSES = {"assigned", "working", "first_done", "client_editing", "review_waiting"}
TRANSCRIBER_VISIBLE_JOB_STATUSES = ACTIVE_JOB_STATUSES | {"final_done", "pdf_sent"}
CLIENT_VISIBLE_TRANSCRIPT_STATUSES = frozenset(
    {"first_done", "client_editing", "review_waiting", "final_done", "pdf_sent"}
)
TRANSCRIBER_DRAFT_STATUSES = frozenset({"assigned", "working"})
THREAD_CLIENT_ADMIN = "client_admin"
THREAD_TRANSCRIBER_ADMIN = "transcriber_admin"


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
    if job.status in {"uploaded", "waiting_assignment"}:
        return "waiting_assignment"
    if job.status in ACTIVE_JOB_STATUSES and job.assigned_transcriber_id is None:
        return "waiting_assignment"
    if job.status in CLIENT_VISIBLE_TRANSCRIPT_STATUSES:
        return job.status
    if job.status in ACTIVE_JOB_STATUSES and not _has_manual_assignment(db, job.job_id):
        return "waiting_assignment"
    return job.status


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
) -> Job:
    if member is not None:
        client = get_or_create_client_for_member(db, member)
    else:
        client = ensure_seed_data(db)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    due_at = now + timedelta(hours=24)
    title = transcript_json.get("filename") if transcript_json else None
    title = (title or infer_title(filename)).strip()

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
        assigned_admin_id=admin.id if admin else None,
        r2_voice_key=voice_key,
        r2_transcript_key=transcript_key,
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
) -> Job:
    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        raise ValueError("Transcriber not found")

    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    previous_transcriber_id = job.assigned_transcriber_id
    previous_status = job.status
    assigned_at = datetime.now(timezone.utc).replace(tzinfo=None)

    job.assigned_transcriber_id = transcriber.id
    job.assigned_at = assigned_at
    if job.status in {"uploaded", "waiting_assignment", "review_waiting"}:
        job.status = "assigned"

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
    return job


def set_job_status(db: Session, job: Job, next_status: str, note: str | None = None) -> Job:
    previous = job.status
    job.status = next_status
    if next_status == "final_done" and job.completed_at is None:
        job.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if job.finalized_at is None:
            job.finalized_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(
        JobStatusLog(
            job_id=job.job_id,
            from_status=previous,
            to_status=next_status,
            change_note=note,
            changed_by_transcriber_id=job.assigned_transcriber_id,
        )
    )
    db.commit()
    _sync_transcriber_load(db, job.assigned_transcriber_id)
    db.refresh(job)
    return job


def mark_transcript_saved(db: Session, job: Job, transcript_key: str, transcript_json: dict) -> Job:
    job.r2_transcript_key = transcript_key
    job.transcript_version = (job.transcript_version or 0) + 1
    job.speaker_count = len((transcript_json or {}).get("speaker_labels") or {})
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


def mark_final_pdf_delivered(db: Session, job: Job) -> Job:
    previous = job.status
    if previous == "pdf_sent":
        return job
    job.status = "pdf_sent"
    db.add(
        JobStatusLog(
            job_id=job.job_id,
            from_status=previous,
            to_status="pdf_sent",
            change_note="최종 PDF 의뢰인 전달",
            changed_by_transcriber_id=job.assigned_transcriber_id,
        )
    )
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
            account_holder=normalized_name,
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
    unit_price: float | None = None,
    monthly_capacity: int | None = None,
    status: str | None = None,
) -> Transcriber:
    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Transcriber name is required")
        transcriber.name = normalized_name
        if not transcriber.account_holder:
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
                if not transcriber.account_holder:
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
        if job.status in ACTIVE_JOB_STATUSES or job.status == "assigned":
            job.status = "waiting_assignment"

    db.delete(transcriber)
    db.commit()


def delete_job_if_unassigned(db: Session, job: Job) -> None:
    if job.status not in {"uploaded", "waiting_assignment"} or job.assigned_transcriber_id is not None:
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
    return db.scalar(select(Settlement).where(Settlement.id == settlement_id))


def update_settlement_status(db: Session, settlement: Settlement, status: str) -> Settlement:
    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
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


def dashboard_overview(db: Session) -> dict:
    for attempt in range(2):
        try:
            jobs = db.scalars(select(Job).order_by(Job.updated_at.desc()).limit(50)).all()
            break
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "selected_segments_json" not in message:
                raise
            _ensure_job_selected_segments_column(db)
    else:
        jobs = []
    transcribers = list_transcribers(db)
    settlements = db.scalars(select(Settlement).order_by(Settlement.created_at.desc()).limit(20)).all()
    invoices = db.scalars(select(Invoice).order_by(Invoice.issue_date.desc()).limit(20)).all()
    display_statuses = {job.job_id: _display_status_for_job(db, job) for job in jobs}

    total_sales = sum(float(job.final_bill_amount or job.sales_amount or 0) for job in jobs)
    total_settlements = sum(float(job.settlement_amount or 0) for job in jobs)
    outstanding = sum(
        float(job.final_bill_amount or job.sales_amount or 0)
        for job in jobs
        if job.payment_status != "paid"
    )

    from app.services.member_auth import list_members_admin
    from app.services.project_store import list_projects

    return {
        "stats": {
            "total_jobs": len(jobs),
            "waiting_assignment": sum(1 for job in jobs if display_statuses[job.job_id] == "waiting_assignment"),
            "working": sum(1 for job in jobs if display_statuses[job.job_id] in {"assigned", "working", "client_editing", "review_waiting"}),
            "final_done": sum(1 for job in jobs if display_statuses[job.job_id] in {"final_done", "pdf_sent"}),
            "total_sales": total_sales,
            "total_settlements": total_settlements,
            "outstanding": outstanding,
        },
        "projects": list_projects(db, include_files=True),
        "members": list_members_admin(db),
        "jobs": [
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
                "status": display_statuses[job.job_id],
                "assignee": visible_transcriber.name if (visible_transcriber := _visible_transcriber_for_job(db, job)) else "-",
                "progress": _progress_for_status(display_statuses[job.job_id]),
                "duration": _format_duration(job.duration_seconds),
                "sales_amount": float(job.sales_amount or 0),
                "settlement_amount": float(job.settlement_amount or 0),
                "payment_status": job.payment_status,
                "settlement_status": job.settlement_status,
                "has_inquiry": inquiry_summary_for_job(db, job.job_id)["has_inquiry"],
                "admin_inquiry_badges": inquiry_summary_for_job(db, job.job_id)["admin_inquiry_badges"],
            }
            for job in jobs
        ],
        "transcribers": transcribers,
        "transcriber_grade_rates": list_transcriber_grade_rates(db),
        "settlements": [
            {
                "id": row.id,
                "month": f"{row.period_start:%Y-%m}",
                "transcriber": (
                    db.scalar(select(Transcriber.name).where(Transcriber.id == row.transcriber_id)) or row.transcriber_id
                ),
                "jobs": row.total_jobs,
                "amount": float(row.final_amount or 0),
                "status": row.status,
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in settlements
        ],
        "sales": [
            {
                "id": row.id,
                "month": f"{row.issue_date:%Y-%m}",
                "client": db.scalar(select(Client.name).where(Client.id == row.client_id)) or DEFAULT_CLIENT_NAME,
                "billed": float(row.total_amount or 0),
                "collected": float(row.total_amount or 0) if row.invoice_status == "paid" else 0,
                "outstanding": 0 if row.invoice_status == "paid" else float(row.total_amount or 0),
                "margin": "40%",
                "status": row.invoice_status,
            }
            for row in invoices
        ],
    }


def _progress_for_status(status: str) -> int:
    mapping = {
        "uploaded": 5,
        "waiting_assignment": 15,
        "assigned": 25,
        "working": 55,
        "first_done": 70,
        "client_editing": 82,
        "review_waiting": 90,
        "final_done": 98,
        "pdf_sent": 100,
        "cancelled": 0,
    }
    return mapping.get(status, 0)


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
