from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import AdminUser, Job, JobInquiryMessage, Member, Transcriber
from app.services.job_store import (
    get_or_create_client_for_member,
    transcriber_can_view_job_transcript,
)

THREAD_CLIENT_ADMIN = "client_admin"
THREAD_TRANSCRIBER_ADMIN = "transcriber_admin"


def can_access_inquiry_thread(
    db: Session,
    job: Job,
    thread_type: str,
    *,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
    admin: AdminUser | None = None,
) -> bool:
    if admin is not None:
        return True
    if thread_type == THREAD_CLIENT_ADMIN and member is not None:
        client = get_or_create_client_for_member(db, member)
        return job.client_id == client.id
    if thread_type == THREAD_TRANSCRIBER_ADMIN and transcriber is not None:
        return transcriber_can_view_job_transcript(job, transcriber)
    return False


def list_job_inquiry_messages(db: Session, job_id: str, thread_type: str) -> list[dict]:
    rows = db.scalars(
        select(JobInquiryMessage)
        .where(JobInquiryMessage.job_id == job_id, JobInquiryMessage.thread_type == thread_type)
        .order_by(JobInquiryMessage.id.asc())
    ).all()
    return [
        {
            "id": row.id,
            "job_id": row.job_id,
            "thread_type": row.thread_type,
            "sender_role": row.sender_role,
            "sender_name": row.sender_name,
            "message": row.message,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def create_job_inquiry_message(
    db: Session,
    job: Job,
    thread_type: str,
    message: str,
    *,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
    admin: AdminUser | None = None,
) -> dict:
    text = message.strip()
    if not text:
        raise ValueError("메시지를 입력해 주세요.")

    sender_role = "admin"
    sender_name = admin.name if admin is not None else "운영관리자"
    sender_member_id = None
    sender_transcriber_id = None
    sender_admin_id = admin.id if admin is not None else None

    if member is not None:
        sender_role = "client"
        sender_name = member.name
        sender_member_id = member.id
        sender_admin_id = None
    elif transcriber is not None:
        sender_role = "transcriber"
        sender_name = transcriber.name
        sender_transcriber_id = transcriber.id
        sender_admin_id = None

    row = JobInquiryMessage(
        job_id=job.job_id,
        thread_type=thread_type,
        sender_role=sender_role,
        sender_name=sender_name,
        sender_member_id=sender_member_id,
        sender_transcriber_id=sender_transcriber_id,
        sender_admin_id=sender_admin_id,
        message=text,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "id": row.id,
        "job_id": row.job_id,
        "thread_type": row.thread_type,
        "sender_role": row.sender_role,
        "sender_name": row.sender_name,
        "message": row.message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
