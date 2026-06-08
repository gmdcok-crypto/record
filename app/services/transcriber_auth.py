import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.admin_models import Job, Transcriber
from app.services.job_store import ACTIVE_JOB_STATUSES, generate_transcriber_code, _sync_transcriber_load
from app.services.passwords import hash_password, verify_password

LOGIN_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{8}$")
MIN_PASSWORD_LENGTH = 8
AUTH_STATUS_ACTIVE = "active"
AUTH_STATUS_PENDING_SIGNUP = "pending_signup"


class TranscriberAuthError(ValueError):
    pass


def validate_login_id(login_id: str) -> str:
    normalized = login_id.strip()
    if not LOGIN_ID_PATTERN.fullmatch(normalized):
        raise TranscriberAuthError("로그인 ID는 영문·숫자 8자여야 합니다")
    return normalized


def validate_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise TranscriberAuthError(f"비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다")
    return password


def get_transcriber_by_login_id(db: Session, login_id: str) -> Transcriber | None:
    normalized = login_id.strip()
    return db.scalar(select(Transcriber).where(Transcriber.login_id == normalized))


def get_transcriber_by_id(db: Session, transcriber_id: int) -> Transcriber | None:
    return db.get(Transcriber, transcriber_id)


def find_transcriber_by_identity(db: Session, *, phone: str, resident_id: str) -> Transcriber | None:
    return db.scalar(
        select(Transcriber).where(
            or_(
                Transcriber.phone == phone,
                Transcriber.resident_id_masked == resident_id,
            )
        )
    )


def serialize_transcriber_auth(transcriber: Transcriber) -> dict:
    return {
        "id": transcriber.id,
        "code": transcriber.transcriber_code,
        "login_id": transcriber.login_id,
        "name": transcriber.name,
        "phone": transcriber.phone,
        "bank_name": transcriber.bank_name,
        "account_number": transcriber.account_number,
        "status": transcriber.status,
        "auth_status": transcriber.auth_status,
    }


def unassign_transcriber_jobs(db: Session, transcriber_id: int) -> None:
    assigned_jobs = db.scalars(select(Job).where(Job.assigned_transcriber_id == transcriber_id)).all()
    for job in assigned_jobs:
        job.assigned_transcriber_id = None
        if job.status in ACTIVE_JOB_STATUSES or job.status == "assigned":
            job.status = "waiting_assignment"
    _sync_transcriber_load(db, transcriber_id)


def revoke_transcriber_auth(db: Session, transcriber: Transcriber) -> Transcriber:
    if transcriber.auth_status == AUTH_STATUS_PENDING_SIGNUP and not transcriber.login_id:
        raise TranscriberAuthError("이미 로그인 초기화된 속기사입니다")

    transcriber.login_id = None
    transcriber.password_hash = None
    transcriber.auth_status = AUTH_STATUS_PENDING_SIGNUP
    unassign_transcriber_jobs(db, transcriber)
    db.commit()
    db.refresh(transcriber)
    return transcriber


def register_transcriber(
    db: Session,
    *,
    login_id: str,
    password: str,
    name: str,
    phone: str | None = None,
    resident_id: str | None = None,
    bank_name: str | None = None,
    account_number: str | None = None,
) -> Transcriber:
    normalized_login_id = validate_login_id(login_id)
    normalized_password = validate_password(password)
    normalized_name = name.strip()
    normalized_phone = (phone or "").strip() or None
    normalized_resident_id = (resident_id or "").strip() or None
    normalized_bank_name = (bank_name or "").strip() or None
    normalized_account_number = (account_number or "").strip() or None

    if not normalized_name:
        raise TranscriberAuthError("이름을 입력해 주세요")

    if get_transcriber_by_login_id(db, normalized_login_id) is not None:
        raise TranscriberAuthError("이미 사용 중인 로그인 ID입니다")

    existing = None
    if normalized_phone and normalized_resident_id:
        existing = find_transcriber_by_identity(db, phone=normalized_phone, resident_id=normalized_resident_id)
    if existing is not None:
        if existing.auth_status == AUTH_STATUS_ACTIVE and existing.login_id:
            raise TranscriberAuthError("이미 가입된 휴대폰 번호 또는 주민등록번호입니다")
        existing.login_id = normalized_login_id
        existing.password_hash = hash_password(normalized_password)
        existing.name = normalized_name
        existing.phone = normalized_phone
        existing.resident_id_masked = normalized_resident_id
        existing.bank_name = normalized_bank_name
        existing.account_number = normalized_account_number
        existing.account_holder = normalized_name
        existing.auth_status = AUTH_STATUS_ACTIVE
        if not existing.is_active:
            existing.is_active = 1
        db.commit()
        db.refresh(existing)
        return existing

    transcriber = Transcriber(
        transcriber_code=generate_transcriber_code(db),
        login_id=normalized_login_id,
        password_hash=hash_password(normalized_password),
        auth_status=AUTH_STATUS_ACTIVE,
        name=normalized_name,
        phone=normalized_phone,
        resident_id_masked=normalized_resident_id,
        bank_name=normalized_bank_name,
        account_number=normalized_account_number,
        account_holder=normalized_name,
        status="available",
        current_load=0,
    )
    db.add(transcriber)
    db.commit()
    db.refresh(transcriber)
    return transcriber


def authenticate_transcriber(db: Session, *, login_id: str, password: str) -> Transcriber:
    normalized_login_id = validate_login_id(login_id)
    normalized_password = validate_password(password)

    transcriber = get_transcriber_by_login_id(db, normalized_login_id)
    if transcriber is None or not transcriber.password_hash:
        raise TranscriberAuthError("로그인 ID 또는 비밀번호가 올바르지 않습니다")

    if not transcriber.is_active:
        raise TranscriberAuthError("비활성화된 계정입니다")

    if transcriber.auth_status != AUTH_STATUS_ACTIVE:
        raise TranscriberAuthError("로그인 초기화된 계정입니다. 다시 가입해 주세요")

    if not verify_password(normalized_password, transcriber.password_hash):
        raise TranscriberAuthError("로그인 ID 또는 비밀번호가 올바르지 않습니다")

    return transcriber
