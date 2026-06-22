"""Canonical job workflow statuses and legacy normalization."""

from __future__ import annotations

WAITING_ASSIGNMENT = "waiting_assignment"
WORKING = "working"
CLIENT_REVIEW = "client_review"
TRANSCRIBER_REVIEW = "transcriber_review"
TRANSCRIPT_REQUEST = "transcript_request"
PDF_SENT = "pdf_sent"
CANCELLED = "cancelled"

LEGACY_TO_CANONICAL: dict[str, str] = {
    "uploaded": WAITING_ASSIGNMENT,
    "assigned": WORKING,
    "first_done": CLIENT_REVIEW,
    "client_editing": CLIENT_REVIEW,
    "review_waiting": TRANSCRIPT_REQUEST,
    "final_done": PDF_SENT,
}

ALL_CANONICAL_STATUSES = frozenset(
    {
        WAITING_ASSIGNMENT,
        WORKING,
        CLIENT_REVIEW,
        TRANSCRIBER_REVIEW,
        TRANSCRIPT_REQUEST,
        PDF_SENT,
        CANCELLED,
    }
)

ACTIVE_JOB_STATUSES = frozenset({WORKING, CLIENT_REVIEW, TRANSCRIBER_REVIEW, TRANSCRIPT_REQUEST})
TRANSCRIBER_DRAFT_STATUSES = frozenset({WORKING})
CLIENT_VISIBLE_TRANSCRIPT_STATUSES = frozenset({CLIENT_REVIEW, TRANSCRIBER_REVIEW, TRANSCRIPT_REQUEST, PDF_SENT})
TRANSCRIBER_VISIBLE_JOB_STATUSES = ACTIVE_JOB_STATUSES | {PDF_SENT}
FINAL_JOB_STATUSES = frozenset({PDF_SENT})
WAITING_JOB_STATUSES = frozenset({WAITING_ASSIGNMENT})
WORKING_JOB_STATUSES = frozenset({WORKING, TRANSCRIPT_REQUEST})
REVIEW_JOB_STATUSES = frozenset({CLIENT_REVIEW, TRANSCRIBER_REVIEW})

DELIVER_DRAFT_ALLOWED_STATUSES = TRANSCRIBER_DRAFT_STATUSES | REVIEW_JOB_STATUSES | {TRANSCRIPT_REQUEST}
PUSH_NOTIFY_TRANSCRIBER_STATUSES = frozenset({TRANSCRIBER_REVIEW, TRANSCRIPT_REQUEST})


def normalize_job_status(status: str | None) -> str:
    raw = (status or "").strip()
    if not raw:
        return WAITING_ASSIGNMENT
    return LEGACY_TO_CANONICAL.get(raw, raw)


def is_canonical_status(status: str) -> bool:
    return normalize_job_status(status) in ALL_CANONICAL_STATUSES
