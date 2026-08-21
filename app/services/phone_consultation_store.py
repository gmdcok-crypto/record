from __future__ import annotations

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.models.admin_models import PhoneConsultation


def _serialize(row: PhoneConsultation) -> dict:
    return {
        "id": row.id,
        "customer_name": row.customer_name or "",
        "phone": row.phone or "",
        "inquiry_type": row.inquiry_type or "",
        "order_type": row.order_type or "",
        "file_kind": row.file_kind or "",
        "file_count": row.file_count or "",
        "range_start": row.range_start or "",
        "range_end": row.range_end or "",
        "duration_seconds": int(row.duration_seconds or 0),
        "estimated_amount": int(row.estimated_amount or 0),
        "deadline": row.deadline.isoformat(sep=" ") if row.deadline else None,
        "delivery_method": row.delivery_method or "",
        "memo": row.memo or "",
        "assignee": row.assignee or "",
        "status": row.status or "draft",
        "created_at": row.created_at.isoformat(sep=" ") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(sep=" ") if row.updated_at else None,
    }


def list_phone_consultations(
    db: Session,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 200,
) -> list[dict]:
    stmt: Select[tuple[PhoneConsultation]] = select(PhoneConsultation).order_by(
        PhoneConsultation.created_at.desc(),
        PhoneConsultation.id.desc(),
    )
    if status:
        stmt = stmt.where(PhoneConsultation.status == status.strip())
    query = (q or "").strip()
    if query:
        like = f"%{query}%"
        stmt = stmt.where(
            or_(
                PhoneConsultation.customer_name.like(like),
                PhoneConsultation.phone.like(like),
                PhoneConsultation.assignee.like(like),
                PhoneConsultation.memo.like(like),
            )
        )
    stmt = stmt.limit(max(1, min(limit, 500)))
    rows = db.scalars(stmt).all()
    return [_serialize(row) for row in rows]


def get_phone_consultation(db: Session, consultation_id: int) -> dict | None:
    row = db.get(PhoneConsultation, consultation_id)
    if row is None:
        return None
    return _serialize(row)
