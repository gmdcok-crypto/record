from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.admin_models import TelWorkAssignee
from app.services.member_auth import MemberAuthError, validate_password
from app.services.passwords import hash_password, verify_password

DEFAULT_ASSIGNEES = ("권혁균", "운영팀", "상담팀")
_schema_ready = False


class TelWorkAssigneeAuthError(ValueError):
    pass


def _ensure_schema(db: Session) -> None:
    """Ensure password_hash exists before ORM reads tel_work_assignees."""
    global _schema_ready
    if _schema_ready:
        return
    bind = db.get_bind()
    if bind is None:
        return
    from app.services.database_migrate import ensure_tel_work_assignees_table

    ensure_tel_work_assignees_table(bind)
    _schema_ready = True


def _serialize(row: TelWorkAssignee) -> dict:
    return {
        "id": row.id,
        "name": row.name or "",
        "sort_order": int(row.sort_order or 0),
        "is_active": bool(row.is_active),
        "has_password": bool(row.password_hash),
        "created_at": row.created_at.isoformat(sep=" ") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(sep=" ") if row.updated_at else None,
    }


def _serialize_staff(row: TelWorkAssignee) -> dict:
    return {
        "id": row.id,
        "name": row.name or "",
        "is_active": bool(row.is_active),
        "has_password": bool(row.password_hash),
    }


def ensure_default_assignees(db: Session) -> None:
    _ensure_schema(db)
    count = int(db.scalar(select(func.count()).select_from(TelWorkAssignee)) or 0)
    if count > 0:
        return
    for index, name in enumerate(DEFAULT_ASSIGNEES):
        db.add(TelWorkAssignee(name=name, sort_order=index, is_active=1))
    db.commit()


def list_assignees(db: Session, *, active_only: bool = False) -> list[dict]:
    _ensure_schema(db)
    ensure_default_assignees(db)
    stmt = select(TelWorkAssignee).order_by(
        TelWorkAssignee.sort_order.asc(),
        TelWorkAssignee.id.asc(),
    )
    if active_only:
        stmt = stmt.where(TelWorkAssignee.is_active == 1)
    return [_serialize(row) for row in db.scalars(stmt).all()]


def get_assignee_by_id(db: Session, assignee_id: int) -> TelWorkAssignee | None:
    _ensure_schema(db)
    return db.get(TelWorkAssignee, assignee_id)


def get_active_assignee_by_name(db: Session, name: str) -> TelWorkAssignee | None:
    _ensure_schema(db)
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    return db.scalar(
        select(TelWorkAssignee).where(
            TelWorkAssignee.name == cleaned,
            TelWorkAssignee.is_active == 1,
        )
    )


def check_assignee_auth(db: Session, *, name: str) -> dict:
    _ensure_schema(db)
    row = get_active_assignee_by_name(db, name)
    if row is None:
        return {"found": False, "has_password": False, "name": (name or "").strip()}
    return {
        "found": True,
        "has_password": bool(row.password_hash),
        "name": row.name or "",
        "id": row.id,
    }


def register_assignee_password(db: Session, *, name: str, password: str) -> TelWorkAssignee:
    _ensure_schema(db)
    row = get_active_assignee_by_name(db, name)
    if row is None:
        raise TelWorkAssigneeAuthError("등록되지 않은 담당자 이름입니다. 관리자에게 문의해 주세요.")
    if row.password_hash:
        raise TelWorkAssigneeAuthError("이미 비밀번호가 설정된 계정입니다. 로그인하세요.")
    try:
        cleaned_password = validate_password(password.strip())
    except MemberAuthError as exc:
        raise TelWorkAssigneeAuthError(str(exc)) from exc
    row.password_hash = hash_password(cleaned_password)
    db.commit()
    db.refresh(row)
    return row


def authenticate_assignee(db: Session, *, name: str, password: str) -> TelWorkAssignee:
    _ensure_schema(db)
    row = get_active_assignee_by_name(db, name)
    if row is None:
        raise TelWorkAssigneeAuthError("이름 또는 비밀번호가 올바르지 않습니다.")
    if not row.password_hash:
        raise TelWorkAssigneeAuthError("비밀번호가 아직 없습니다. 먼저 비밀번호를 생성해 주세요.")
    try:
        cleaned_password = validate_password(password.strip())
    except MemberAuthError as exc:
        raise TelWorkAssigneeAuthError(str(exc)) from exc
    if not verify_password(cleaned_password, row.password_hash):
        raise TelWorkAssigneeAuthError("이름 또는 비밀번호가 올바르지 않습니다.")
    return row


def reset_assignee_password(db: Session, assignee_id: int) -> dict:
    _ensure_schema(db)
    row = get_assignee_by_id(db, assignee_id)
    if row is None:
        raise ValueError("담당자를 찾을 수 없습니다.")
    row.password_hash = None
    db.commit()
    db.refresh(row)
    return _serialize(row)


def create_assignee(db: Session, *, name: str, sort_order: int | None = None) -> dict:
    _ensure_schema(db)
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
    _ensure_schema(db)
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
    _ensure_schema(db)
    row = db.get(TelWorkAssignee, assignee_id)
    if row is None:
        raise ValueError("담당자를 찾을 수 없습니다.")
    db.delete(row)
    db.commit()
