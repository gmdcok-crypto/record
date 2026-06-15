from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.admin_models import Job, Member, MemberPushSubscription
from app.services.database_reset import _run_sql_file

logger = logging.getLogger(__name__)
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
PUSH_SUBSCRIPTIONS_SQL = SCRIPTS_DIR / "migrate_member_push_subscriptions.sql"


def web_push_enabled() -> bool:
    return bool(
        settings.web_push_enabled
        and settings.web_push_vapid_public_key.strip()
        and settings.web_push_vapid_private_key.strip()
        and settings.web_push_subject.strip()
    )


def web_push_public_config() -> dict[str, Any]:
    return {
        "enabled": web_push_enabled(),
        "vapidPublicKey": settings.web_push_vapid_public_key.strip(),
    }


def _ensure_member_push_subscription_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    _run_sql_file(bind, PUSH_SUBSCRIPTIONS_SQL)


def upsert_member_push_subscription(
    db: Session,
    *,
    member: Member,
    endpoint: str,
    p256dh_key: str,
    auth_key: str,
    user_agent: str | None = None,
) -> MemberPushSubscription:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(select(MemberPushSubscription).where(MemberPushSubscription.endpoint == normalized_endpoint))
            if row is None:
                row = MemberPushSubscription(
                    member_id=member.id,
                    endpoint=normalized_endpoint,
                    p256dh_key=p256dh_key.strip(),
                    auth_key=auth_key.strip(),
                    user_agent=(user_agent or "").strip() or None,
                    is_active=1,
                )
                db.add(row)
            else:
                row.member_id = member.id
                row.p256dh_key = p256dh_key.strip()
                row.auth_key = auth_key.strip()
                row.user_agent = (user_agent or "").strip() or None
                row.is_active = 1
            db.commit()
            db.refresh(row)
            return row
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_member_push_subscription_table(db)
    raise RuntimeError("Failed to upsert member push subscription")


def deactivate_member_push_subscription(db: Session, *, endpoint: str, member: Member | None = None) -> None:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(select(MemberPushSubscription).where(MemberPushSubscription.endpoint == normalized_endpoint))
            if row is None:
                return
            if member is not None and row.member_id != member.id:
                return
            row.is_active = 0
            db.commit()
            return
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_member_push_subscription_table(db)


def list_member_push_subscriptions(db: Session, *, member: Member) -> list[MemberPushSubscription]:
    for attempt in range(2):
        try:
            return db.scalars(
                select(MemberPushSubscription)
                .where(MemberPushSubscription.member_id == member.id, MemberPushSubscription.is_active == 1)
                .order_by(MemberPushSubscription.updated_at.desc(), MemberPushSubscription.id.desc())
            ).all()
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_member_push_subscription_table(db)
    return []


def _payload(
    *,
    title: str,
    body: str,
    url: str,
    tag: str,
    job_id: str | None = None,
    kind: str = "general",
) -> dict[str, Any]:
    return {
        "title": title,
        "body": body,
        "url": url,
        "tag": tag,
        "jobId": job_id,
        "kind": kind,
    }


def _send_payload_to_subscription(subscription: MemberPushSubscription, payload: dict[str, Any]) -> None:
    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {
                "p256dh": subscription.p256dh_key,
                "auth": subscription.auth_key,
            },
        },
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=settings.web_push_vapid_private_key.strip(),
        vapid_claims={"sub": settings.web_push_subject.strip()},
        timeout=3,
    )


def send_web_push_to_member(db: Session, *, member: Member, payload: dict[str, Any]) -> int:
    if not web_push_enabled():
        return 0
    delivered = 0
    for subscription in list_member_push_subscriptions(db, member=member):
        try:
            _send_payload_to_subscription(subscription, payload)
            delivered += 1
        except WebPushException as exc:
            logger.warning("Web push failed for member=%s subscription=%s: %s", member.id, subscription.id, exc)
            subscription.is_active = 0
            db.commit()
        except Exception:
            logger.exception("Unexpected web push failure for member=%s subscription=%s", member.id, subscription.id)
    return delivered


def _client_job_url(job: Job) -> str:
    base = settings.public_client_url.rstrip("/")
    return f"{base}?job_id={job.job_id}" if base else ""


def send_client_status_web_push(db: Session, *, member: Member, job: Job, note: str | None = None) -> int:
    status_text = {
        "assigned": "작업이 배정되었습니다.",
        "working": "작업이 시작되었습니다.",
        "first_done": "초벌본 검토가 가능합니다.",
        "client_editing": "의뢰인 수정본이 저장되었습니다.",
        "review_waiting": "속기사 재검토가 진행 중입니다.",
        "final_done": "최종본이 확정되었습니다.",
        "pdf_sent": "PDF가 전달되었습니다.",
    }.get(job.status)
    if not status_text:
        return 0
    extra = f" {note.strip()}" if note and note.strip() else ""
    return send_web_push_to_member(
        db,
        member=member,
        payload=_payload(
            title="작업 상태 안내",
            body=f"{job.original_filename}: {status_text}{extra}",
            url=_client_job_url(job),
            tag=f"job-status-{job.job_id}",
            job_id=job.job_id,
            kind="job_status",
        ),
    )


def send_client_pdf_web_push(db: Session, *, member: Member, job: Job, delivery_mode: str) -> int:
    mode_text = "통합본 PDF" if delivery_mode == "bundle" else "개별 PDF"
    return send_web_push_to_member(
        db,
        member=member,
        payload=_payload(
            title="PDF 전달 완료",
            body=f"{job.original_filename}: {mode_text}가 전달되었습니다.",
            url=_client_job_url(job),
            tag=f"job-pdf-{job.job_id}",
            job_id=job.job_id,
            kind="pdf_delivery",
        ),
    )


def send_client_inquiry_web_push(db: Session, *, member: Member, job: Job, sender_name: str, message_preview: str) -> int:
    return send_web_push_to_member(
        db,
        member=member,
        payload=_payload(
            title="관리자 답변 도착",
            body=f"{job.original_filename}: {sender_name} - {message_preview}",
            url=_client_job_url(job),
            tag=f"job-inquiry-{job.job_id}",
            job_id=job.job_id,
            kind="inquiry_reply",
        ),
    )
