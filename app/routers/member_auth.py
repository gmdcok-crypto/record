from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.member_auth import get_current_member
from app.models.admin_models import Member
from app.services.jwt_tokens import create_member_access_token
from app.services.member_auth import (
    MemberAuthError,
    get_member_by_email,
    register_member,
    serialize_member,
    validate_email,
)

router = APIRouter(prefix="/api/member/auth", tags=["member-auth"])


class MemberSignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=16)
    name: str
    phone: str | None = None


class MemberLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=16)


class MemberAuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    member: dict


def _auth_error_to_http(exc: MemberAuthError) -> HTTPException:
    message = str(exc)
    if "이미" in message:
        return HTTPException(status_code=409, detail=message)
    if "이메일 또는 비밀번호" in message:
        return HTTPException(status_code=401, detail=message)
    if "비활성화" in message:
        return HTTPException(status_code=403, detail=message)
    return HTTPException(status_code=400, detail=message)


def _issue_token(member) -> MemberAuthTokenResponse:
    try:
        access_token = create_member_access_token(member_id=member.id, email=member.email)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return MemberAuthTokenResponse(
        access_token=access_token,
        member=serialize_member(member),
    )


@router.get("/check-email")
def check_email_available(
    db: Annotated[Session, Depends(get_db)],
    email: str = Query(..., min_length=5, max_length=150),
) -> dict:
    try:
        normalized = validate_email(email)
    except MemberAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    taken = get_member_by_email(db, normalized) is not None
    return {"available": not taken, "email": normalized}


@router.post("/signup", response_model=MemberAuthTokenResponse)
def member_signup(body: MemberSignupRequest, db: Annotated[Session, Depends(get_db)]) -> MemberAuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    try:
        member = register_member(
            db,
            email=body.email,
            password=body.password,
            name=body.name,
            phone=body.phone,
        )
    except MemberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    return _issue_token(member)


@router.get("/me")
def member_me(current: Annotated[Member, Depends(get_current_member)]) -> dict:
    return {"member": serialize_member(current)}


@router.post("/login", response_model=MemberAuthTokenResponse)
def member_login(body: MemberLoginRequest, db: Annotated[Session, Depends(get_db)]) -> MemberAuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    from app.services.member_auth import authenticate_member

    try:
        member = authenticate_member(db, email=body.email, password=body.password)
    except MemberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    return _issue_token(member)
