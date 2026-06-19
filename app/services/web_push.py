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
from app.models.admin_models import (
    AdminPushSubscription,
    AdminUser,
    Job,
    Member,
    MemberPushSubscription,
    Transcriber,
    TranscriberPushSubscription,
)
from app.services.database_reset import _run_sql_file

logger = logging.getLogger(__name__)
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
PUSH_SUBSCRIPTIONS_SQL = SCRIPTS_DIR / "migrate_member_push_subscriptions.sql"
ADMIN_PUSH_SUBSCRIPTIONS_SQL = SCRIPTS_DIR / "migrate_admin_push_subscriptions.sql"
TRANSCRIBER_PUSH_SUBSCRIPTIONS_SQL = SCRIPTS_DIR / "migrate_transcriber_push_subscriptions.sql"


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


def _ensure_admin_push_subscription_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    _run_sql_file(bind, ADMIN_PUSH_SUBSCRIPTIONS_SQL)


def _ensure_transcriber_push_subscription_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    _run_sql_file(bind, TRANSCRIBER_PUSH_SUBSCRIPTIONS_SQL)


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


def upsert_admin_push_subscription(
    db: Session,
    *,
    admin_user: AdminUser,
    endpoint: str,
    p256dh_key: str,
    auth_key: str,
    user_agent: str | None = None,
) -> AdminPushSubscription:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(select(AdminPushSubscription).where(AdminPushSubscription.endpoint == normalized_endpoint))
            if row is None:
                row = AdminPushSubscription(
                    admin_user_id=admin_user.id,
                    endpoint=normalized_endpoint,
                    p256dh_key=p256dh_key.strip(),
                    auth_key=auth_key.strip(),
                    user_agent=(user_agent or "").strip() or None,
                    is_active=1,
                )
                db.add(row)
            else:
                row.admin_user_id = admin_user.id
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
            _ensure_admin_push_subscription_table(db)
    raise RuntimeError("Failed to upsert admin push subscription")


def upsert_transcriber_push_subscription(
    db: Session,
    *,
    transcriber: Transcriber,
    endpoint: str,
    p256dh_key: str,
    auth_key: str,
    user_agent: str | None = None,
) -> TranscriberPushSubscription:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(
                select(TranscriberPushSubscription).where(TranscriberPushSubscription.endpoint == normalized_endpoint)
            )
            if row is None:
                row = TranscriberPushSubscription(
                    transcriber_id=transcriber.id,
                    endpoint=normalized_endpoint,
                    p256dh_key=p256dh_key.strip(),
                    auth_key=auth_key.strip(),
                    user_agent=(user_agent or "").strip() or None,
                    is_active=1,
                )
                db.add(row)
            else:
                row.transcriber_id = transcriber.id
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
            _ensure_transcriber_push_subscription_table(db)
    raise RuntimeError("Failed to upsert transcriber push subscription")


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


def deactivate_admin_push_subscription(db: Session, *, endpoint: str, admin_user: AdminUser | None = None) -> None:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(select(AdminPushSubscription).where(AdminPushSubscription.endpoint == normalized_endpoint))
            if row is None:
                return
            if admin_user is not None and row.admin_user_id != admin_user.id:
                return
            row.is_active = 0
            db.commit()
            return
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_admin_push_subscription_table(db)


def deactivate_transcriber_push_subscription(
    db: Session, *, endpoint: str, transcriber: Transcriber | None = None
) -> None:
    normalized_endpoint = endpoint.strip()
    for attempt in range(2):
        try:
            row = db.scalar(
                select(TranscriberPushSubscription).where(TranscriberPushSubscription.endpoint == normalized_endpoint)
            )
            if row is None:
                return
            if transcriber is not None and row.transcriber_id != transcriber.id:
                return
            row.is_active = 0
            db.commit()
            return
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_transcriber_push_subscription_table(db)


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


def list_admin_push_subscriptions(db: Session, *, admin_user: AdminUser) -> list[AdminPushSubscription]:
    for attempt in range(2):
        try:
            return db.scalars(
                select(AdminPushSubscription)
                .where(AdminPushSubscription.admin_user_id == admin_user.id, AdminPushSubscription.is_active == 1)
                .order_by(AdminPushSubscription.updated_at.desc(), AdminPushSubscription.id.desc())
            ).all()
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_admin_push_subscription_table(db)
    return []


def list_transcriber_push_subscriptions(db: Session, *, transcriber: Transcriber) -> list[TranscriberPushSubscription]:
    for attempt in range(2):
        try:
            return db.scalars(
                select(TranscriberPushSubscription)
                .where(TranscriberPushSubscription.transcriber_id == transcriber.id, TranscriberPushSubscription.is_active == 1)
                .order_by(TranscriberPushSubscription.updated_at.desc(), TranscriberPushSubscription.id.desc())
            ).all()
        except (OperationalError, ProgrammingError):
            if attempt == 1:
                raise
            _ensure_transcriber_push_subscription_table(db)
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


def send_web_push_to_admin(db: Session, *, admin_user: AdminUser, payload: dict[str, Any]) -> int:
    if not web_push_enabled():
        return 0
    delivered = 0
    for subscription in list_admin_push_subscriptions(db, admin_user=admin_user):
        try:
            _send_payload_to_subscription(subscription, payload)
            delivered += 1
        except WebPushException as exc:
            logger.warning("Web push failed for admin=%s subscription=%s: %s", admin_user.id, subscription.id, exc)
            subscription.is_active = 0
            db.commit()
        except Exception:
            logger.exception("Unexpected web push failure for admin=%s subscription=%s", admin_user.id, subscription.id)
    return delivered


def send_web_push_to_transcriber(db: Session, *, transcriber: Transcriber, payload: dict[str, Any]) -> int:
    if not web_push_enabled():
        return 0
    delivered = 0
    for subscription in list_transcriber_push_subscriptions(db, transcriber=transcriber):
        try:
            _send_payload_to_subscription(subscription, payload)
            delivered += 1
        except WebPushException as exc:
            logger.warning(
                "Web push failed for transcriber=%s subscription=%s: %s",
                transcriber.id,
                subscription.id,
                exc,
            )
            subscription.is_active = 0
            db.commit()
        except Exception:
            logger.exception(
                "Unexpected web push failure for transcriber=%s subscription=%s",
                transcriber.id,
                subscription.id,
            )
    return delivered


def _client_job_url(job: Job) -> str:
    base = settings.public_client_url.rstrip("/")
    return f"{base}?job_id={job.job_id}" if base else ""


def _admin_job_url(job: Job) -> str:
    base = settings.public_admin_url.rstrip("/")
    if not base:
        return ""
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}job_id={job.job_id}"


def _admin_members_url() -> str:
    base = settings.public_admin_url.rstrip("/")
    if not base:
        return ""
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}menu=members"


def _transcriber_job_url(job: Job) -> str:
    base = settings.public_transcriber_url.rstrip("/")
    return f"{base}?job_id={job.job_id}" if base else ""


def send_client_status_web_push(db: Session, *, member: Member, job: Job, note: str | None = None) -> int:
    status_text = {
        "assigned": "작업이 배정되었습니다.",
        "working": "작업이 시작되었습니다.",
        "first_done": "초벌본 검토가 가능합니다.",
        "client_editing": "의뢰인 수정본이 저장되었습니다.",
        "review_waiting": "녹취록 요청이 접수되었습니다.",
        "transcriber_review": "속기사 검토가 진행 중입니다.",
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


def broadcast_admin_web_push(db: Session, payload: dict[str, Any]) -> int:
    if not web_push_enabled():
        return 0

    delivered = 0
    admins = db.scalars(select(AdminUser).where(AdminUser.is_active == 1)).all()
    for admin in admins:
        delivered += send_web_push_to_admin(db, admin_user=admin, payload=payload)
    return delivered


def send_admin_inquiry_web_push(
    db: Session,
    *,
    job: Job,
    sender_name: str,
    message_preview: str,
    sender_role: str,
) -> int:
    role_label = "의뢰인" if sender_role == "client" else "속기사" if sender_role == "transcriber" else "사용자"
    return broadcast_admin_web_push(
        db,
        _payload(
            title=f"{role_label} 문의 도착",
            body=f"{job.original_filename}: {sender_name} - {message_preview}",
            url=_admin_job_url(job),
            tag=f"admin-inquiry-{job.job_id}",
            job_id=job.job_id,
            kind="admin_inquiry",
        ),
    )


def send_admin_review_request_web_push(db: Session, *, job: Job, note: str | None = None) -> int:
    extra = f" {note.strip()}" if note and note.strip() else ""
    return broadcast_admin_web_push(
        db,
        _payload(
            title="의뢰인 검토 요청",
            body=f"{job.original_filename}: 속기사 재검토 요청이 접수되었습니다.{extra}",
            url=_admin_job_url(job),
            tag=f"admin-review-{job.job_id}",
            job_id=job.job_id,
            kind="admin_review_request",
        ),
    )


def send_admin_member_signup_web_push(
    db: Session,
    *,
    member_name: str,
    member_email: str,
    member_id: int,
) -> int:
    return broadcast_admin_web_push(
        db,
        _payload(
            title="신규 회원 가입",
            body=f"{member_name} ({member_email}) 님이 가입했습니다.",
            url=_admin_members_url(),
            tag=f"admin-member-signup-{member_id}",
            job_id=None,
            kind="admin_member_signup",
        ),
    )


def send_transcriber_assignment_web_push(
    db: Session,
    *,
    transcriber: Transcriber,
    job: Job,
    note: str | None = None,
) -> int:
    extra = f" {note.strip()}" if note and note.strip() else ""
    return send_web_push_to_transcriber(
        db,
        transcriber=transcriber,
        payload=_payload(
            title="새 작업 배정",
            body=f"{job.original_filename}: 관리자가 작업을 배정했습니다.{extra}",
            url=_transcriber_job_url(job),
            tag=f"transcriber-assignment-{job.job_id}",
            job_id=job.job_id,
            kind="transcriber_assignment",
        ),
    )


def send_transcriber_client_request_web_push(
    db: Session,
    *,
    transcriber: Transcriber,
    job: Job,
    note: str | None = None,
) -> int:
    if job.status == "transcriber_review":
        title = "검토 요청"
        body = f"{job.original_filename}: 의뢰인이 검토를 요청했습니다."
        kind = "transcriber_review_request"
        tag = f"transcriber-review-{job.job_id}"
    elif job.status == "review_waiting":
        title = "녹취록 요청"
        body = f"{job.original_filename}: 의뢰인이 녹취록을 요청했습니다."
        kind = "transcriber_transcript_request"
        tag = f"transcriber-transcript-{job.job_id}"
    else:
        return 0
    extra = f" {note.strip()}" if note and note.strip() else ""
    return send_web_push_to_transcriber(
        db,
        transcriber=transcriber,
        payload=_payload(
            title=title,
            body=f"{body}{extra}",
            url=_transcriber_job_url(job),
            tag=tag,
            job_id=job.job_id,
            kind=kind,
        ),
    )
