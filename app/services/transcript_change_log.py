import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import Job, Member, TranscriptChangeLog, Transcriber
from app.services.job_store import get_or_create_client_for_member, mark_transcript_saved
from app.services.r2 import get_transcript_json, save_transcript_json

SAVE_KIND_LABELS: dict[str, str] = {
    "draft": "임시 저장",
    "deliver": "초벌 전달",
    "review_request": "재검수 요청",
    "ai_draft": "AI 초벌",
    "finalize": "최종본 저장",
    "pdf_finalize": "PDF 확정",
}


def save_kind_label(save_kind: str) -> str:
    return SAVE_KIND_LABELS.get(save_kind, save_kind)


def _norm(value: Any) -> str:
    return str(value or "").strip()


def compute_transcript_changes(old: dict | None, new: dict | None) -> list[dict]:
    old = old or {}
    new = new or {}
    changes: list[dict] = []

    old_labels = old.get("speaker_labels") or {}
    new_labels = new.get("speaker_labels") or {}
    speaker_ids = set(old_labels) | set(new_labels)

    def speaker_sort_key(value: str) -> tuple[int, str | int]:
        if str(value).isdigit():
            return (0, int(value))
        return (1, value)

    for speaker_id in sorted(speaker_ids, key=speaker_sort_key):
        before = _norm(old_labels.get(speaker_id))
        after = _norm(new_labels.get(speaker_id))
        if before != after:
            changes.append(
                {
                    "type": "speaker_label",
                    "speaker_id": str(speaker_id),
                    "before": before,
                    "after": after,
                }
            )

    old_segments = old.get("segments") or []
    new_segments = new.get("segments") or []
    max_len = max(len(old_segments), len(new_segments))

    for index in range(max_len):
        old_segment = old_segments[index] if index < len(old_segments) else None
        new_segment = new_segments[index] if index < len(new_segments) else None

        if old_segment is None and new_segment is not None:
            changes.append(
                {
                    "type": "segment_added",
                    "segment_index": index,
                    "speaker": _norm(new_segment.get("speaker")),
                    "after": _norm(new_segment.get("text")),
                }
            )
            continue

        if new_segment is None and old_segment is not None:
            changes.append(
                {
                    "type": "segment_removed",
                    "segment_index": index,
                    "speaker": _norm(old_segment.get("speaker")),
                    "before": _norm(old_segment.get("text")),
                }
            )
            continue

        if old_segment is None or new_segment is None:
            continue

        old_speaker = _norm(old_segment.get("speaker"))
        new_speaker = _norm(new_segment.get("speaker"))
        if old_speaker != new_speaker:
            changes.append(
                {
                    "type": "segment_speaker",
                    "segment_index": index,
                    "before": old_speaker,
                    "after": new_speaker,
                }
            )

        old_text = _norm(old_segment.get("text"))
        new_text = _norm(new_segment.get("text"))
        if old_text != new_text:
            changes.append(
                {
                    "type": "segment_text",
                    "segment_index": index,
                    "speaker": new_speaker or old_speaker,
                    "before": old_text,
                    "after": new_text,
                }
            )

    return changes


def resolve_editor(
    transcriber: Transcriber | None,
    member: Member | None,
) -> tuple[str, int | None, str]:
    if transcriber is not None:
        return "transcriber", transcriber.id, transcriber.name
    if member is not None:
        return "client", member.id, member.name
    return "unknown", None, "알 수 없음"


def record_transcript_change_log(
    db: Session,
    job: Job,
    *,
    changes: list[dict],
    transcriber: Transcriber | None,
    member: Member | None,
    save_kind: str,
) -> TranscriptChangeLog | None:
    if not changes:
        return None

    editor_role, editor_id, editor_name = resolve_editor(transcriber, member)
    row = TranscriptChangeLog(
        job_id=job.job_id,
        version=job.transcript_version or 1,
        editor_role=editor_role,
        editor_id=editor_id,
        editor_name=editor_name,
        save_kind=save_kind,
        changes_json=changes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def persist_job_transcript(
    db: Session,
    job: Job,
    job_id: str,
    transcript_json: dict,
    *,
    transcriber: Transcriber | None = None,
    member: Member | None = None,
    save_kind: str = "draft",
    previous: dict | None = None,
) -> str:
    if previous is None:
        previous = get_transcript_json(job_id) or {}

    changes = compute_transcript_changes(previous, transcript_json)
    transcript_key = save_transcript_json(job_id, transcript_json)
    mark_transcript_saved(db, job, transcript_key, transcript_json)

    if changes:
        record_transcript_change_log(
            db,
            job,
            changes=changes,
            transcriber=transcriber,
            member=member,
            save_kind=save_kind,
        )

    return transcript_key


def can_view_transcript_changes(
    db: Session,
    job: Job,
    *,
    transcriber: Transcriber | None,
    member: Member | None,
) -> bool:
    if transcriber is not None and job.assigned_transcriber_id == transcriber.id:
        return True
    if member is not None:
        client = get_or_create_client_for_member(db, member)
        return job.client_id == client.id
    return False


def list_transcript_change_logs(db: Session, job_id: str) -> list[dict]:
    rows = db.scalars(
        select(TranscriptChangeLog)
        .where(TranscriptChangeLog.job_id == job_id)
        .order_by(TranscriptChangeLog.version.desc(), TranscriptChangeLog.id.desc())
    ).all()

    result: list[dict] = []
    for row in rows:
        changes = row.changes_json
        if isinstance(changes, str):
            changes = json.loads(changes)
        result.append(
            {
                "version": row.version,
                "save_kind": row.save_kind,
                "save_kind_label": save_kind_label(row.save_kind),
                "editor_role": row.editor_role,
                "editor_name": row.editor_name,
                "changes": changes or [],
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return result
