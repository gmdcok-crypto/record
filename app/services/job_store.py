from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import (
    AdminUser,
    Client,
    Invoice,
    Job,
    JobAssignment,
    JobStatusLog,
    Settlement,
    Transcriber,
)

DEFAULT_ADMIN_EMAIL = "ops@bluecom.local"
DEFAULT_ADMIN_NAME = "운영관리자"
DEFAULT_TRANSCRIBER_EMAIL = "transcriber@bluecom.local"
DEFAULT_TRANSCRIBER_NAME = "김민서"
DEFAULT_TRANSCRIBER_CODE = "TR-001"
DEFAULT_CLIENT_CODE = "CLIENT-DEFAULT"
DEFAULT_CLIENT_NAME = "일반 의뢰인"
ACTIVE_JOB_STATUSES = {"assigned", "working", "first_done", "client_editing", "review_waiting"}


def ensure_seed_data(db: Session) -> tuple[Client, Transcriber]:
    client = db.scalar(select(Client).where(Client.client_code == DEFAULT_CLIENT_CODE))
    if client is None:
        client = Client(client_code=DEFAULT_CLIENT_CODE, name=DEFAULT_CLIENT_NAME)
        db.add(client)

    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    if admin is None:
        admin = AdminUser(email=DEFAULT_ADMIN_EMAIL, name=DEFAULT_ADMIN_NAME, role="owner")
        db.add(admin)

    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == DEFAULT_TRANSCRIBER_CODE))
    if transcriber is None:
        transcriber = Transcriber(
            transcriber_code=DEFAULT_TRANSCRIBER_CODE,
            name=DEFAULT_TRANSCRIBER_NAME,
            email=DEFAULT_TRANSCRIBER_EMAIL,
            status="available",
            specialty="법률 / 인터뷰",
            unit_price=1800,
            monthly_capacity=30,
            current_load=0,
            quality_score=4.8,
        )
        db.add(transcriber)

    db.commit()
    db.refresh(client)
    db.refresh(transcriber)
    return client, transcriber


def infer_title(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0]
    return stem.replace("_", " ").strip() or "새 녹취 작업"


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
    if job.status in ACTIVE_JOB_STATUSES and not _has_manual_assignment(db, job.job_id):
        return "waiting_assignment"
    if job.status == "uploaded":
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
) -> Job:
    client, _ = ensure_seed_data(db)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    due_at = now + timedelta(hours=24)
    title = transcript_json.get("filename") if transcript_json else None
    title = (title or infer_title(filename)).strip()

    job = Job(
        job_id=job_id,
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
    return db.scalar(select(Job).where(Job.job_id == job_id))


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

    job.assigned_transcriber_id = transcriber.id
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


def mark_final_pdf_saved(db: Session, job: Job, pdf_key: str, filename: str) -> Job:
    job.final_pdf_r2_key = pdf_key
    job.final_pdf_filename = filename
    job.final_pdf_generated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if job.finalized_at is None:
        job.finalized_at = job.final_pdf_generated_at
    job.status = "pdf_sent"
    db.add(
        JobStatusLog(
            job_id=job.job_id,
            from_status="final_done",
            to_status="pdf_sent",
            change_note="최종 PDF 저장 및 다운로드 가능 상태 전환",
            changed_by_transcriber_id=job.assigned_transcriber_id,
        )
    )
    db.commit()
    db.refresh(job)
    return job


def serialize_job(db: Session, job: Job, *, transcript_json: dict, audio_url: str) -> dict:
    visible_transcriber = _visible_transcriber_for_job(db, job)
    visible_status = _display_status_for_job(db, job)
    return {
        "job_id": job.job_id,
        "voice_key": job.r2_voice_key,
        "transcript_key": job.r2_transcript_key,
        "audio_url": audio_url,
        "transcript_json": transcript_json,
        "title": job.title,
        "status": visible_status,
        "priority": job.priority,
        "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
        "due_at": job.due_at.isoformat() if job.due_at else None,
        "client": {
            "id": job.client.id if job.client else None,
            "name": job.client.name if job.client else DEFAULT_CLIENT_NAME,
        },
        "transcriber": {
            "id": visible_transcriber.id if visible_transcriber else None,
            "name": visible_transcriber.name if visible_transcriber else None,
        },
        "final_pdf_ready": job.status == "pdf_sent",
        "final_pdf_filename": job.final_pdf_filename,
    }


def list_client_jobs(db: Session) -> list[dict]:
    rows = db.scalars(select(Job).order_by(Job.updated_at.desc())).all()
    result: list[dict] = []
    for job in rows:
        result.append(
            {
                "job_id": job.job_id,
                "title": job.title,
                "filename": job.original_filename,
                "status": job.status,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "client_name": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                "pdf_ready": job.status == "pdf_sent",
                "final_pdf_filename": job.final_pdf_filename,
            }
        )
    return result


def list_transcriber_jobs(db: Session, transcriber_code: str = DEFAULT_TRANSCRIBER_CODE) -> list[dict]:
    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        return []
    rows = db.scalars(
        select(Job)
        .where(Job.assigned_transcriber_id == transcriber.id, Job.status.in_(ACTIVE_JOB_STATUSES))
        .order_by(Job.updated_at.desc())
    ).all()
    return [
        {
            "job_id": job.job_id,
            "client": job.client.name if job.client else DEFAULT_CLIENT_NAME,
            "title": job.title,
            "filename": job.original_filename,
            "due_at": job.due_at.isoformat() if job.due_at else None,
            "status": _display_status_for_job(db, job),
            "priority": job.priority,
        }
        for job in rows
        if _has_manual_assignment(db, job.job_id)
    ]


def list_transcribers(db: Session) -> list[dict]:
    rows = db.scalars(select(Transcriber).order_by(Transcriber.name.asc())).all()
    return [
        {
            "id": row.id,
            "code": row.transcriber_code,
            "name": row.name,
            "specialty": row.specialty,
            "status": row.status,
            "monthly_capacity": row.monthly_capacity,
            "current_load": row.current_load,
            "unit_price": float(row.unit_price or 0),
            "quality_score": float(row.quality_score or 0),
        }
        for row in rows
    ]


def get_transcriber_by_code(db: Session, transcriber_code: str = DEFAULT_TRANSCRIBER_CODE) -> Transcriber | None:
    return db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))


def create_transcriber(
    db: Session,
    *,
    code: str,
    name: str,
    specialty: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    unit_price: float = 0,
    monthly_capacity: int | None = None,
    status: str = "available",
) -> Transcriber:
    transcriber = Transcriber(
        transcriber_code=code.strip(),
        name=name.strip(),
        specialty=(specialty or "").strip() or None,
        email=(email or "").strip() or None,
        phone=(phone or "").strip() or None,
        unit_price=unit_price,
        monthly_capacity=monthly_capacity,
        status=status,
        current_load=0,
    )
    db.add(transcriber)
    db.commit()
    db.refresh(transcriber)
    return transcriber


def update_transcriber(
    db: Session,
    transcriber: Transcriber,
    *,
    specialty: str | None = None,
    unit_price: float | None = None,
    monthly_capacity: int | None = None,
    status: str | None = None,
) -> Transcriber:
    if specialty is not None:
        transcriber.specialty = specialty.strip() or None
    if unit_price is not None:
        transcriber.unit_price = unit_price
    if monthly_capacity is not None:
        transcriber.monthly_capacity = monthly_capacity
    if status is not None:
        transcriber.status = status
    db.commit()
    db.refresh(transcriber)
    return transcriber


def delete_transcriber(db: Session, transcriber: Transcriber) -> None:
    assigned_jobs = db.scalars(select(Job).where(Job.assigned_transcriber_id == transcriber.id)).all()
    for job in assigned_jobs:
        job.assigned_transcriber_id = None
        if job.status == "assigned":
            job.status = "waiting_assignment"
    db.delete(transcriber)
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
    jobs = db.scalars(select(Job).order_by(Job.updated_at.desc()).limit(50)).all()
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
        "jobs": [
            {
                "id": job.job_id,
                "client": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                "title": job.title,
                "filename": job.original_filename,
                "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
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
            }
            for job in jobs
        ],
        "transcribers": transcribers,
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
