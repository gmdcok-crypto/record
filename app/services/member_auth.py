import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import Member
from app.services.passwords import hash_password, verify_password

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
PASSWORD_PATTERN = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[#?!@$%^&*\-]).{8,16}$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 16


class MemberAuthError(ValueError):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email(email: str) -> str:
    normalized = normalize_email(email)
    if not EMAIL_PATTERN.fullmatch(normalized):
        raise MemberAuthError("올바른 이메일 형식이 아닙니다")
    return normalized


def validate_password(password: str) -> str:
    if not PASSWORD_PATTERN.fullmatch(password):
        raise MemberAuthError("비밀번호는 영문, 숫자, 특수문자(#?!@$%^&*-) 포함 8~16자리여야 합니다")
    return password


def get_member_by_email(db: Session, email: str) -> Member | None:
    return db.scalar(select(Member).where(Member.email == normalize_email(email)))


def get_member_by_id(db: Session, member_id: int) -> Member | None:
    return db.get(Member, member_id)


def serialize_member(member: Member) -> dict:
    return {
        "id": member.id,
        "email": member.email,
        "name": member.name,
        "phone": member.phone,
    }


def register_member(
    db: Session,
    *,
    email: str,
    password: str,
    name: str,
    phone: str,
) -> Member:
    normalized_email = validate_email(email)
    normalized_password = validate_password(password)
    normalized_name = name.strip()
    normalized_phone = re.sub(r"\D", "", phone.strip())

    if not normalized_name:
        raise MemberAuthError("이름을 입력해 주세요")
    if len(normalized_phone) < 10:
        raise MemberAuthError("휴대폰 번호를 올바르게 입력해 주세요")

    if get_member_by_email(db, normalized_email) is not None:
        raise MemberAuthError("이미 사용 중인 이메일입니다")

    member = Member(
        email=normalized_email,
        password_hash=hash_password(normalized_password),
        name=normalized_name,
        phone=normalized_phone,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def authenticate_member(db: Session, *, email: str, password: str) -> Member:
    normalized_email = validate_email(email)
    if not password:
        raise MemberAuthError("이메일 또는 비밀번호가 올바르지 않습니다")

    member = get_member_by_email(db, normalized_email)
    if member is None or not member.password_hash:
        raise MemberAuthError("이메일 또는 비밀번호가 올바르지 않습니다")
    if not member.is_active:
        raise MemberAuthError("비활성화된 계정입니다")
    if not verify_password(password, member.password_hash):
        raise MemberAuthError("이메일 또는 비밀번호가 올바르지 않습니다")
    return member
