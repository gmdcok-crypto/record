from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.transcriber_auth import get_current_transcriber
from app.models.admin_models import Transcriber
from app.services.jwt_tokens import create_transcriber_access_token
from app.services.transcriber_auth import (
    TranscriberAuthError,
    authenticate_transcriber,
    get_transcriber_by_login_id,
    register_transcriber,
    serialize_transcriber_auth,
    validate_login_id,
)

router = APIRouter(prefix="/api/transcriber/auth", tags=["transcriber-auth"])


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

    @field_validator("login_id")
    @classmethod
    def check_login_id(cls, value: str) -> str:
        return validate_login_id(value)


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

    try:
        transcriber = authenticate_transcriber(db, login_id=body.login_id, password=body.password)
    except TranscriberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    return _issue_token(transcriber)


@router.get("/me")
def transcriber_me(current: Annotated[Transcriber, Depends(get_current_transcriber)]) -> dict:
    return {"transcriber": serialize_transcriber_auth(current)}
