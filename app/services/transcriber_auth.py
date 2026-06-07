import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.admin_models import Transcriber
from app.services.job_store import generate_transcriber_code
from app.services.passwords import hash_password, verify_password

LOGIN_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{8}$")
MIN_PASSWORD_LENGTH = 8


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
    }


def register_transcriber(
    db: Session,
    *,
    login_id: str,
    password: str,
    name: str,
    phone: str,
    resident_id: str,
    bank_name: str,
    account_number: str,
) -> Transcriber:
    normalized_login_id = validate_login_id(login_id)
    normalized_password = validate_password(password)
    normalized_name = name.strip()
    normalized_phone = phone.strip()
    normalized_resident_id = resident_id.strip()
    normalized_bank_name = bank_name.strip()
    normalized_account_number = account_number.strip()

    if not normalized_name:
        raise TranscriberAuthError("이름을 입력해 주세요")
    if not normalized_phone:
        raise TranscriberAuthError("휴대폰 번호를 입력해 주세요")
    if not normalized_resident_id:
        raise TranscriberAuthError("주민등록번호를 입력해 주세요")
    if not normalized_bank_name:
        raise TranscriberAuthError("은행명을 입력해 주세요")
    if not normalized_account_number:
        raise TranscriberAuthError("계좌번호를 입력해 주세요")

    if get_transcriber_by_login_id(db, normalized_login_id) is not None:
        raise TranscriberAuthError("이미 사용 중인 로그인 ID입니다")

    duplicate = db.scalar(
        select(Transcriber).where(
            or_(
                Transcriber.phone == normalized_phone,
                Transcriber.resident_id_masked == normalized_resident_id,
            )
        )
    )
    if duplicate is not None:
        raise TranscriberAuthError("이미 가입된 휴대폰 번호 또는 주민등록번호입니다")

    transcriber = Transcriber(
        transcriber_code=generate_transcriber_code(db),
        login_id=normalized_login_id,
        password_hash=hash_password(normalized_password),
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

    if not verify_password(normalized_password, transcriber.password_hash):
        raise TranscriberAuthError("로그인 ID 또는 비밀번호가 올바르지 않습니다")

    return transcriber
