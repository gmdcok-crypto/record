from __future__ import annotations

import logging
from typing import Literal

from sqlalchemy.orm import Session

from app.models.admin_models import Job, Member, Transcriber
from app.services.job_inquiries import THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN
from app.services.web_push import send_client_inquiry_web_push

logger = logging.getLogger(__name__)

ThreadType = Literal["client_admin", "transcriber_admin"]
SenderRole = Literal["client", "transcriber", "admin"]


def _trim_preview(message: str) -> str:
    text = " ".join((message or "").split())
    if len(text) <= 120:
        return text
    return text[:119].rstrip() + "…"


def send_inquiry_notification(
    db: Session,
    *,
    job: Job,
    thread_type: ThreadType,
    sender_role: SenderRole,
    sender_name: str,
    message: str,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
) -> None:
    if thread_type != THREAD_CLIENT_ADMIN or sender_role != "admin" or member is None:
        logger.info(
            "Skipping client web push inquiry notification: thread=%s sender=%s member=%s transcriber=%s",
            thread_type,
            sender_role,
            bool(member),
            bool(transcriber),
        )
        return

    send_client_inquiry_web_push(
        db,
        member=member,
        job=job,
        sender_name=sender_name,
        message_preview=_trim_preview(message),
    )


__all__ = [
    "THREAD_CLIENT_ADMIN",
    "THREAD_TRANSCRIBER_ADMIN",
    "send_inquiry_notification",
]
