from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.admin_models import TelWorkAssignee

DEFAULT_ASSIGNEES = ("권혁균", "운영팀", "상담팀")


def _serialize(row: TelWorkAssignee) -> dict:
    return {
        "id": row.id,
        "name": row.name or "",
        "sort_order": int(row.sort_order or 0),
        "is_active": bool(row.is_active),
        "created_at": row.created_at.isoformat(sep=" ") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(sep=" ") if row.updated_at else None,
    }


def ensure_default_assignees(db: Session) -> None:
    count = int(db.scalar(select(func.count()).select_from(TelWorkAssignee)) or 0)
    if count > 0:
        return
    for index, name in enumerate(DEFAULT_ASSIGNEES):
        db.add(TelWorkAssignee(name=name, sort_order=index, is_active=1))
    db.commit()


def list_assignees(db: Session, *, active_only: bool = False) -> list[dict]:
    ensure_default_assignees(db)
    stmt = select(TelWorkAssignee).order_by(
        TelWorkAssignee.sort_order.asc(),
        TelWorkAssignee.id.asc(),
    )
    if active_only:
        stmt = stmt.where(TelWorkAssignee.is_active == 1)
    return [_serialize(row) for row in db.scalars(stmt).all()]


def create_assignee(db: Session, *, name: str, sort_order: int | None = None) -> dict:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("담당자 이름을 입력해 주세요.")
    existing = db.scalar(select(TelWorkAssignee).where(TelWorkAssignee.name == cleaned))
    if existing is not None:
        raise ValueError("이미 등록된 담당자입니다.")
    if sort_order is None:
        max_order = db.scalar(select(func.max(TelWorkAssignee.sort_order)))
        sort_order = int(max_order or 0) + 1
    row = TelWorkAssignee(name=cleaned, sort_order=int(sort_order), is_active=1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def update_assignee(
    db: Session,
    assignee_id: int,
    *,
    name: str | None = None,
    is_active: bool | None = None,
    sort_order: int | None = None,
) -> dict:
    row = db.get(TelWorkAssignee, assignee_id)
    if row is None:
        raise ValueError("담당자를 찾을 수 없습니다.")
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("담당자 이름을 입력해 주세요.")
        dup = db.scalar(
            select(TelWorkAssignee).where(
                TelWorkAssignee.name == cleaned,
                TelWorkAssignee.id != assignee_id,
            )
        )
        if dup is not None:
            raise ValueError("이미 등록된 담당자입니다.")
        row.name = cleaned
    if is_active is not None:
        row.is_active = 1 if is_active else 0
    if sort_order is not None:
        row.sort_order = int(sort_order)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def delete_assignee(db: Session, assignee_id: int) -> None:
    row = db.get(TelWorkAssignee, assignee_id)
    if row is None:
        raise ValueError("담당자를 찾을 수 없습니다.")
    db.delete(row)
    db.commit()
