from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.admin_models import AdminUser
from app.services.admin_permissions import menus_for_role, permissions_for_role, role_label
from app.services.job_store import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME
from app.services.member_auth import MemberAuthError, normalize_email, validate_email, validate_password
from app.services.passwords import hash_password, verify_password

logger = logging.getLogger(__name__)


class AdminAuthError(ValueError):
    pass


def get_admin_by_email(db: Session, email: str) -> AdminUser | None:
    return db.scalar(select(AdminUser).where(AdminUser.email == normalize_email(email)))


def get_admin_by_id(db: Session, admin_id: int) -> AdminUser | None:
    return db.get(AdminUser, admin_id)


def serialize_admin(admin: AdminUser) -> dict:
    role = admin.role
    return {
        "id": admin.id,
        "email": admin.email,
        "name": admin.name,
        "role": role,
        "role_label": role_label(role),
        "phone": admin.phone,
        "is_active": bool(admin.is_active),
        "menus": menus_for_role(role),
        "permissions": permissions_for_role(role),
        "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
    }


def authenticate_admin(db: Session, *, email: str, password: str) -> AdminUser:
    try:
        normalized_email = validate_email(email)
        validate_password(password)
    except MemberAuthError as exc:
        raise AdminAuthError(str(exc)) from exc

    admin = get_admin_by_email(db, normalized_email)
    if admin is None or not admin.is_active:
        raise AdminAuthError("이메일 또는 비밀번호가 올바르지 않습니다.")
    if not admin.password_hash:
        raise AdminAuthError("관리자 비밀번호가 아직 설정되지 않았습니다. ADMIN_BOOTSTRAP_PASSWORD를 확인하세요.")
    if not verify_password(password, admin.password_hash):
        raise AdminAuthError("이메일 또는 비밀번호가 올바르지 않습니다.")

    admin.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(admin)
    return admin


def ensure_admin_bootstrap_password(db: Session) -> None:
    bootstrap_password = settings.admin_bootstrap_password.strip()
    admin = db.scalar(select(AdminUser).where(AdminUser.email == DEFAULT_ADMIN_EMAIL))
    if admin is None:
        admin = AdminUser(email=DEFAULT_ADMIN_EMAIL, name=DEFAULT_ADMIN_NAME, role="owner")
        db.add(admin)
        db.flush()

    if admin.password_hash:
        return
    if not bootstrap_password:
        logger.warning(
            "Default admin %s has no password. Set ADMIN_BOOTSTRAP_PASSWORD to enable admin login.",
            DEFAULT_ADMIN_EMAIL,
        )
        return

    try:
        validate_password(bootstrap_password)
    except MemberAuthError as exc:
        logger.warning("ADMIN_BOOTSTRAP_PASSWORD is invalid: %s", exc)
        return

    admin.password_hash = hash_password(bootstrap_password)
    if not admin.role:
        admin.role = "owner"
    db.commit()
