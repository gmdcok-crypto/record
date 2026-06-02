import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.transcript_history import TranscriptHistory
from app.services.r2 import (
    get_transcript_history_json,
    save_transcript_history_snapshot,
    save_transcript_json,
)


def _next_version(db: Session, job_id: str) -> int:
    current = db.scalar(
        select(func.max(TranscriptHistory.version)).where(TranscriptHistory.job_id == job_id)
    )
    return (current or 0) + 1


def record_transcript_revision(
    db: Session,
    job_id: str,
    transcript_json: dict,
    *,
    editor: str | None = None,
    change_summary: str | None = None,
) -> dict:
    revision_id = str(uuid.uuid4())
    r2_key = save_transcript_history_snapshot(job_id, revision_id, transcript_json)
    version = _next_version(db, job_id)

    row = TranscriptHistory(
        job_id=job_id,
        revision_id=revision_id,
        version=version,
        editor=editor,
        change_summary=change_summary,
        r2_key=r2_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    latest_key = save_transcript_json(job_id, transcript_json)
    return {
        "revision_id": revision_id,
        "version": version,
        "transcript_key": latest_key,
        "r2_key": r2_key,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_transcript_history(db: Session, job_id: str) -> list[dict]:
    rows = db.scalars(
        select(TranscriptHistory)
        .where(TranscriptHistory.job_id == job_id)
        .order_by(TranscriptHistory.version.desc())
    ).all()
    return [
        {
            "revision_id": row.revision_id,
            "version": row.version,
            "editor": row.editor,
            "change_summary": row.change_summary,
            "r2_key": row.r2_key,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def get_history_row(db: Session, job_id: str, revision_id: str) -> TranscriptHistory | None:
    return db.scalar(
        select(TranscriptHistory).where(
            TranscriptHistory.job_id == job_id,
            TranscriptHistory.revision_id == revision_id,
        )
    )


def get_transcript_revision(db: Session, job_id: str, revision_id: str) -> dict | None:
    row = get_history_row(db, job_id, revision_id)
    if not row:
        return None
    transcript_json = get_transcript_history_json(row.r2_key)
    return {
        "revision_id": row.revision_id,
        "version": row.version,
        "editor": row.editor,
        "change_summary": row.change_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "transcript_json": transcript_json,
    }


def restore_transcript_revision(
    db: Session,
    job_id: str,
    revision_id: str,
    *,
    editor: str | None = None,
) -> dict:
    row = get_history_row(db, job_id, revision_id)
    if not row:
        raise ValueError("Revision not found")

    transcript_json = get_transcript_history_json(row.r2_key)
    summary = f"v{row.version} 복원"
    return record_transcript_revision(
        db,
        job_id,
        transcript_json,
        editor=editor,
        change_summary=summary,
    )


def save_transcript_with_optional_history(
    db: Session | None,
    job_id: str,
    transcript_json: dict,
    *,
    editor: str | None = None,
    change_summary: str | None = None,
) -> dict:
    if db is not None and settings.database_configured:
        return record_transcript_revision(
            db,
            job_id,
            transcript_json,
            editor=editor,
            change_summary=change_summary,
        )

    key = save_transcript_json(job_id, transcript_json)
    return {"transcript_key": key, "revision_id": None, "version": None}
