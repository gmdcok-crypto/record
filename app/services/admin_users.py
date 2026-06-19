from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.admin_models import AdminUser
from app.services.admin_auth import AdminAuthError, get_admin_by_email
from app.services.admin_permissions import ADMIN_ROLES, normalize_admin_role, role_label
from app.services.member_auth import MemberAuthError, validate_email, validate_password
from app.services.passwords import hash_password


def serialize_admin_account(admin: AdminUser) -> dict:
    return {
        "id": admin.id,
        "email": admin.email,
        "name": admin.name,
        "role": admin.role,
        "role_label": role_label(admin.role),
        "phone": admin.phone,
        "is_active": bool(admin.is_active),
        "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
        "created_at": admin.created_at.isoformat() if admin.created_at else None,
    }


def list_admin_users(db: Session) -> list[dict]:
    rows = db.scalars(select(AdminUser).order_by(AdminUser.id.asc())).all()
    return [serialize_admin_account(row) for row in rows]


def _count_active_owners(db: Session, *, exclude_id: int | None = None) -> int:
    stmt = select(func.count()).select_from(AdminUser).where(
        AdminUser.role == "owner",
        AdminUser.is_active == 1,
    )
    if exclude_id is not None:
        stmt = stmt.where(AdminUser.id != exclude_id)
    return int(db.scalar(stmt) or 0)


def _normalize_phone(phone: str | None) -> str | None:
    if phone is None:
        return None
    cleaned = phone.strip()
    return cleaned or None


def _validate_role(role: str) -> str:
    normalized = normalize_admin_role(role)
    if normalized not in ADMIN_ROLES:
        raise AdminAuthError("유효하지 않은 관리자 등급입니다.")
    return normalized


def create_admin_user(
    db: Session,
    *,
    email: str,
    password: str,
    name: str,
    role: str,
    phone: str | None = None,
) -> AdminUser:
    try:
        normalized_email = validate_email(email)
        normalized_password = validate_password(password)
    except MemberAuthError as exc:
        raise AdminAuthError(str(exc)) from exc

    normalized_name = name.strip()
    if not normalized_name:
        raise AdminAuthError("이름을 입력해 주세요.")

    normalized_role = _validate_role(role)
    normalized_phone = _normalize_phone(phone)

    if get_admin_by_email(db, normalized_email) is not None:
        raise AdminAuthError("이미 사용 중인 이메일입니다.")

    admin = AdminUser(
        email=normalized_email,
        name=normalized_name,
        role=normalized_role,
        phone=normalized_phone,
        password_hash=hash_password(normalized_password),
        is_active=1,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def update_admin_user(
    db: Session,
    target: AdminUser,
    *,
    actor: AdminUser,
    name: str | None = None,
    role: str | None = None,
    phone: str | None = None,
    phone_provided: bool = False,
    is_active: bool | None = None,
    password: str | None = None,
) -> AdminUser:
    if target.id == actor.id:
        if is_active is False:
            raise AdminAuthError("본인 계정은 비활성화할 수 없습니다.")
        if role is not None and _validate_role(role) != normalize_admin_role(actor.role):
            raise AdminAuthError("본인 계정의 등급은 변경할 수 없습니다.")

    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise AdminAuthError("이름을 입력해 주세요.")
        target.name = normalized_name

    if role is not None:
        next_role = _validate_role(role)
        if normalize_admin_role(target.role) == "owner" and next_role != "owner" and target.is_active:
            if _count_active_owners(db, exclude_id=target.id) == 0:
                raise AdminAuthError("마지막 최고관리자의 등급은 변경할 수 없습니다.")
        target.role = next_role

    if phone_provided:
        target.phone = _normalize_phone(phone)

    if is_active is not None:
        if not is_active and target.id == actor.id:
            raise AdminAuthError("본인 계정은 비활성화할 수 없습니다.")
        if not is_active and normalize_admin_role(target.role) == "owner" and target.is_active:
            if _count_active_owners(db, exclude_id=target.id) == 0:
                raise AdminAuthError("마지막 최고관리자는 비활성화할 수 없습니다.")
        target.is_active = 1 if is_active else 0

    if password is not None:
        cleaned_password = password.strip()
        if cleaned_password:
            try:
                validate_password(cleaned_password)
            except MemberAuthError as exc:
                raise AdminAuthError(str(exc)) from exc
            target.password_hash = hash_password(cleaned_password)

    db.commit()
    db.refresh(target)
    return target


def deactivate_admin_user(db: Session, target: AdminUser, *, actor: AdminUser) -> AdminUser:
    return update_admin_user(db, target, actor=actor, is_active=False)
