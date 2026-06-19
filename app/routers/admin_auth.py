import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.admin_auth import AdminAuth
from app.models.admin_models import AdminUser
from app.services.admin_auth import AdminAuthError, authenticate_admin, serialize_admin
from app.services.jwt_tokens import create_admin_access_token

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])
logger = logging.getLogger(__name__)


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=16)


class AdminAuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: dict


@router.post("/login", response_model=AdminAuthTokenResponse)
def admin_login(body: AdminLoginRequest, db: Annotated[Session, Depends(get_db)]) -> AdminAuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    try:
        admin = authenticate_admin(db, email=body.email, password=body.password)
    except AdminAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    access_token = create_admin_access_token(admin_id=admin.id, email=admin.email, role=admin.role)
    return AdminAuthTokenResponse(access_token=access_token, admin=serialize_admin(admin))


@router.get("/me")
def admin_me(admin: AdminAuth) -> dict:
    return {"admin": serialize_admin(admin)}
