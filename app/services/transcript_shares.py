from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import Job, Member, TranscriptShare

SHARE_EXPIRE_DAYS = 7


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_transcript_share(
    db: Session,
    *,
    job: Job,
    member: Member | None,
    allow_audio: bool = True,
    allow_pdf_download: bool = True,
) -> TranscriptShare:
    share = TranscriptShare(
        job_id=job.job_id,
        token=secrets.token_urlsafe(32),
        created_by_member_id=member.id if member else None,
        expires_at=_utc_now() + timedelta(days=SHARE_EXPIRE_DAYS),
        is_active=1,
        allow_audio=1 if allow_audio else 0,
        allow_pdf_download=1 if allow_pdf_download else 0,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return share


def get_transcript_share_by_token(db: Session, token: str) -> TranscriptShare | None:
    return db.scalar(select(TranscriptShare).where(TranscriptShare.token == token))


def deactivate_transcript_share(db: Session, share: TranscriptShare) -> TranscriptShare:
    share.is_active = 0
    db.commit()
    db.refresh(share)
    return share


def transcript_share_is_valid(share: TranscriptShare) -> bool:
    return bool(share.is_active) and share.expires_at > _utc_now()

