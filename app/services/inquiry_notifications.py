from __future__ import annotations

import logging
from typing import Literal

from app.config import settings
from app.models.admin_models import Job, Member, Transcriber
from app.services.job_inquiries import THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN

logger = logging.getLogger(__name__)

ThreadType = Literal["client_admin", "transcriber_admin"]
SenderRole = Literal["client", "transcriber", "admin"]


def inquiry_notifications_enabled() -> bool:
    return settings.channel_talk_notifications_enabled


def _trim_preview(message: str) -> str:
    text = " ".join((message or "").split())
    limit = max(20, int(settings.channel_talk_message_preview_limit or 120))
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _admin_deep_link(job_id: str) -> str:
    base = settings.public_admin_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _client_deep_link(job_id: str) -> str:
    base = settings.public_client_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _transcriber_deep_link(job_id: str) -> str:
    base = settings.public_transcriber_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _target_descriptor(
    *,
    thread_type: ThreadType,
    sender_role: SenderRole,
    member: Member | None,
    transcriber: Transcriber | None,
) -> tuple[str, str]:
    if thread_type == THREAD_CLIENT_ADMIN:
        if sender_role == "client":
            return "admin", _admin_deep_link
        return "client", _client_deep_link
    if sender_role == "transcriber":
        return "admin", _admin_deep_link
    return "transcriber", _transcriber_deep_link


def build_inquiry_notification_payload(
    *,
    job: Job,
    thread_type: ThreadType,
    sender_role: SenderRole,
    sender_name: str,
    message: str,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
) -> dict:
    target_role, link_factory = _target_descriptor(
        thread_type=thread_type,
        sender_role=sender_role,
        member=member,
        transcriber=transcriber,
    )
    if thread_type == THREAD_CLIENT_ADMIN:
        title = "의뢰인 문의 도착" if sender_role == "client" else "문의 답변 도착"
    else:
        title = "속기사 문의 도착" if sender_role == "transcriber" else "문의 답변 도착"

    return {
        "title": title,
        "target_role": target_role,
        "job_id": job.job_id,
        "project_id": job.project_id,
        "project_title": job.project.title if job.project else None,
        "file_name": job.original_filename,
        "thread_type": thread_type,
        "sender_role": sender_role,
        "sender_name": sender_name,
        "message_preview": _trim_preview(message),
        "deep_link_url": link_factory(job.job_id),
        "admin_inbox_id": settings.channel_talk_admin_inbox_id.strip(),
        "admin_user_id": settings.channel_talk_admin_user_id.strip(),
        "admin_tag": settings.channel_talk_admin_tag.strip(),
    }


def send_inquiry_notification(
    *,
    job: Job,
    thread_type: ThreadType,
    sender_role: SenderRole,
    sender_name: str,
    message: str,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
) -> None:
    if not inquiry_notifications_enabled():
        return

    payload = build_inquiry_notification_payload(
        job=job,
        thread_type=thread_type,
        sender_role=sender_role,
        sender_name=sender_name,
        message=message,
        member=member,
        transcriber=transcriber,
    )

    # Placeholder for actual Channel Talk server-side API integration.
    # We intentionally do not fail the primary inquiry flow if notification delivery fails.
    logger.info("Channel Talk inquiry notification queued: %s", payload)
