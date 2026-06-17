import logging
import json
import time
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.transcriber_auth import get_current_transcriber
from app.models.admin_models import Transcriber
from app.services.jwt_tokens import create_transcriber_access_token
from app.services.r2 import get_object_bytes, get_object_metadata, upload_transcriber_license_bytes
from app.services.transcriber_auth import (
    TranscriberAuthError,
    authenticate_transcriber,
    get_transcriber_by_login_id,
    register_transcriber,
    serialize_transcriber_auth,
    update_transcriber_license,
    update_transcriber_profile,
    validate_login_id,
)
from app.services.web_push import deactivate_transcriber_push_subscription, upsert_transcriber_push_subscription

router = APIRouter(prefix="/api/transcriber/auth", tags=["transcriber-auth"])
logger = logging.getLogger(__name__)

LICENSE_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}
MAX_LICENSE_BYTES = 10 * 1024 * 1024


class TranscriberSignupRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=8)
    password: str = Field(min_length=8)
    name: str
    phone: str | None = None
    resident_id: str | None = None
    bank_name: str | None = None
    account_number: str | None = None

    @field_validator("login_id")
    @classmethod
    def check_login_id(cls, value: str) -> str:
        return validate_login_id(value)


class TranscriberLoginRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=8)
    password: str = Field(min_length=8)


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: str | None = None


class TranscriberProfileUpdateRequest(BaseModel):
    phone: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    resident_id: str | None = None


class PortOneIdentityCompleteRequest(BaseModel):
    identity_verification_id: str = Field(alias="identityVerificationId", min_length=1)

    model_config = {"populate_by_name": True}


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    transcriber: dict


def _issue_token(transcriber: Transcriber) -> AuthTokenResponse:
    if not transcriber.login_id:
        raise HTTPException(status_code=500, detail="Transcriber login_id is missing")

    try:
        access_token = create_transcriber_access_token(
            transcriber_id=transcriber.id,
            login_id=transcriber.login_id,
            transcriber_code=transcriber.transcriber_code,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return AuthTokenResponse(
        access_token=access_token,
        transcriber=serialize_transcriber_auth(transcriber),
    )


def _auth_error_to_http(exc: TranscriberAuthError) -> HTTPException:
    message = str(exc)
    if "이미" in message:
        return HTTPException(status_code=409, detail=message)
    if "로그인 ID 또는 비밀번호" in message:
        return HTTPException(status_code=401, detail=message)
    if "비활성화" in message:
        return HTTPException(status_code=403, detail=message)
    return HTTPException(status_code=400, detail=message)


def _fetch_portone_json(path: str) -> dict:
    if not settings.portone_api_secret.strip():
        raise HTTPException(status_code=503, detail="포트원 API 설정이 완료되지 않았습니다.")

    request = Request(
        f"https://api.portone.io{path}",
        headers={
            "Authorization": f"PortOne {settings.portone_api_secret.strip()}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"포트원 조회 실패: {body or exc.reason}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"포트원 연결 실패: {exc.reason}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"포트원 응답 처리 실패: {exc}") from exc


@router.get("/check-login-id")
def check_login_id_available(
    db: Annotated[Session, Depends(get_db)],
    login_id: str = Query(..., min_length=1, max_length=8),
) -> dict:
    try:
        normalized = validate_login_id(login_id)
    except TranscriberAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    taken = get_transcriber_by_login_id(db, normalized) is not None
    return {"available": not taken, "login_id": normalized}


@router.post("/signup", response_model=AuthTokenResponse)
def transcriber_signup(body: TranscriberSignupRequest, db: Annotated[Session, Depends(get_db)]) -> AuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    try:
        transcriber = register_transcriber(
            db,
            login_id=body.login_id,
            password=body.password,
            name=body.name,
            phone=body.phone,
            resident_id=body.resident_id,
            bank_name=body.bank_name,
            account_number=body.account_number,
        )
    except TranscriberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    return _issue_token(transcriber)


@router.post("/login", response_model=AuthTokenResponse)
def transcriber_login(body: TranscriberLoginRequest, db: Annotated[Session, Depends(get_db)]) -> AuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    started = time.perf_counter()
    try:
        auth_started = time.perf_counter()
        transcriber = authenticate_transcriber(db, login_id=body.login_id, password=body.password)
        auth_ms = round((time.perf_counter() - auth_started) * 1000, 1)
    except TranscriberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    token_started = time.perf_counter()
    response = _issue_token(transcriber)
    token_ms = round((time.perf_counter() - token_started) * 1000, 1)
    logger.info(
        "transcriber_login_route_timing login_id=%s auth_ms=%s token_ms=%s total_ms=%s",
        body.login_id.strip(),
        auth_ms,
        token_ms,
        round((time.perf_counter() - started) * 1000, 1),
    )
    return response


@router.get("/me")
def transcriber_me(current: Annotated[Transcriber, Depends(get_current_transcriber)]) -> dict:
    return {"transcriber": serialize_transcriber_auth(current)}


@router.patch("/profile")
def transcriber_update_profile(
    body: TranscriberProfileUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    transcriber = update_transcriber_profile(
        db,
        current,
        phone=body.phone,
        bank_name=body.bank_name,
        account_number=body.account_number,
        resident_id=body.resident_id,
    )
    return {"transcriber": serialize_transcriber_auth(transcriber)}


@router.post("/identity-verifications/complete")
def transcriber_complete_identity_verification(
    body: PortOneIdentityCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    verification = _fetch_portone_json(
        f"/identity-verifications/{body.identity_verification_id}"
    )
    if verification.get("status") != "VERIFIED":
        raise HTTPException(status_code=409, detail="본인인증이 아직 완료되지 않았습니다.")

    verified_customer = verification.get("verifiedCustomer") or {}
    phone = str(verified_customer.get("phoneNumber") or "").strip() or None
    birth_date = str(verified_customer.get("birthDate") or "").strip()
    gender = str(verified_customer.get("gender") or "").strip()
    resident_id = None
    if birth_date:
        compact_birth = birth_date.replace("-", "")
        if len(compact_birth) == 8:
            resident_id = compact_birth[2:]
            if gender:
                gender_code_map = {"MALE": "1", "FEMALE": "2"}
                gender_code = gender_code_map.get(gender.upper(), "")
                if gender_code:
                    resident_id = f"{resident_id}-{gender_code}"

    transcriber = update_transcriber_profile(
        db,
        current,
        phone=phone,
        resident_id=resident_id,
    )
    return {
        "ok": True,
        "identity_verification_id": body.identity_verification_id,
        "transcriber": serialize_transcriber_auth(transcriber),
        "verified_customer": {
            "name": verified_customer.get("name"),
            "phoneNumber": verified_customer.get("phoneNumber"),
            "birthDate": verified_customer.get("birthDate"),
            "gender": verified_customer.get("gender"),
            "ci": verified_customer.get("ci"),
            "di": verified_customer.get("di"),
        },
    }


@router.post("/identity-verifications/lookup")
def lookup_portone_identity_verification(
    body: PortOneIdentityCompleteRequest,
) -> dict:
    verification = _fetch_portone_json(
        f"/identity-verifications/{body.identity_verification_id}"
    )
    if verification.get("status") != "VERIFIED":
        raise HTTPException(status_code=409, detail="본인인증이 아직 완료되지 않았습니다.")

    verified_customer = verification.get("verifiedCustomer") or {}
    phone = str(verified_customer.get("phoneNumber") or "").strip() or None
    birth_date = str(verified_customer.get("birthDate") or "").strip()
    gender = str(verified_customer.get("gender") or "").strip()
    resident_id = None
    if birth_date:
        compact_birth = birth_date.replace("-", "")
        if len(compact_birth) == 8:
            resident_id = compact_birth[2:]
            if gender:
                gender_code_map = {"MALE": "1", "FEMALE": "2"}
                gender_code = gender_code_map.get(gender.upper(), "")
                if gender_code:
                    resident_id = f"{resident_id}-{gender_code}"

    return {
        "ok": True,
        "identity_verification_id": body.identity_verification_id,
        "verified_customer": {
            "name": verified_customer.get("name"),
            "phone": phone,
            "resident_id": resident_id,
            "phoneNumber": verified_customer.get("phoneNumber"),
            "birthDate": verified_customer.get("birthDate"),
            "gender": verified_customer.get("gender"),
            "ci": verified_customer.get("ci"),
            "di": verified_customer.get("di"),
        },
    }


@router.post("/profile/license")
async def transcriber_upload_license(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
    file: UploadFile = File(...),
) -> dict:
    if not settings.r2_configured:
        raise HTTPException(status_code=503, detail="R2 is not configured")

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in LICENSE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="jpg, png, webp, pdf 파일만 업로드할 수 있습니다.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="업로드할 파일이 비어 있습니다.")
    if len(data) > MAX_LICENSE_BYTES:
        raise HTTPException(status_code=400, detail="파일 크기는 10MB 이하여야 합니다.")

    filename = file.filename or "license.jpg"
    try:
        uploaded = upload_transcriber_license_bytes(current.transcriber_code, data, filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"자격증 업로드 실패: {exc}") from exc

    transcriber = update_transcriber_license(
        db,
        current,
        object_key=uploaded["object_key"],
        filename=uploaded["filename"],
    )
    return {"transcriber": serialize_transcriber_auth(transcriber)}


@router.get("/profile/license")
def transcriber_get_license(current: Annotated[Transcriber, Depends(get_current_transcriber)]) -> Response:
    if not current.license_r2_key:
        raise HTTPException(status_code=404, detail="등록된 자격증 파일이 없습니다.")

    try:
        metadata = get_object_metadata(current.license_r2_key)
        content = get_object_bytes(current.license_r2_key)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"자격증 파일을 불러오지 못했습니다: {exc}") from exc

    media_type = metadata.get("content_type") or "application/octet-stream"
    filename = current.license_filename or "license"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/push-subscriptions")
def register_transcriber_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    if not body.endpoint.strip() or not body.keys.p256dh.strip() or not body.keys.auth.strip():
        raise HTTPException(status_code=400, detail="유효한 푸시 구독 정보가 필요합니다.")
    try:
        subscription = upsert_transcriber_push_subscription(
            db,
            transcriber=current,
            endpoint=body.endpoint,
            p256dh_key=body.keys.p256dh,
            auth_key=body.keys.auth,
            user_agent=body.user_agent,
        )
    except Exception as exc:
        logger.exception("push subscription register failed for transcriber=%s", current.id)
        raise HTTPException(status_code=503, detail="웹푸시 구독 저장 중 오류가 발생했습니다.") from exc
    return {"subscription_id": subscription.id, "registered": True}


@router.delete("/push-subscriptions")
def unregister_transcriber_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Transcriber, Depends(get_current_transcriber)],
) -> dict:
    try:
        deactivate_transcriber_push_subscription(db, endpoint=body.endpoint, transcriber=current)
    except Exception as exc:
        logger.exception("push subscription unregister failed for transcriber=%s", current.id)
        raise HTTPException(status_code=503, detail="웹푸시 구독 해제 중 오류가 발생했습니다.") from exc
    return {"unregistered": True}
