from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.admin_auth import require_admin_permission
from app.models.admin_models import AdminUser
from app.services.admin_auth import AdminAuthError, get_admin_by_id
from app.services.admin_users import (
    create_admin_user,
    deactivate_admin_user,
    list_admin_users,
    serialize_admin_account,
    update_admin_user,
)

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

OwnerAdminAuth = Annotated[AdminUser, Depends(require_admin_permission("menu:admins"))]


class AdminUserCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=8, max_length=16)
    name: str = Field(min_length=1, max_length=100)
    role: Literal["owner", "manager", "operator", "accounting", "viewer"] = "operator"
    phone: str | None = Field(default=None, max_length=30)


class AdminUserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Literal["owner", "manager", "operator", "accounting", "viewer"] | None = None
    phone: str | None = Field(default=None, max_length=30)
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=16)


@router.get("")
def list_admin_accounts(db: Annotated[Session, Depends(get_db)], _owner: OwnerAdminAuth) -> dict:
    return {"admins": list_admin_users(db)}


@router.post("")
def create_admin_account(
    body: AdminUserCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    _owner: OwnerAdminAuth,
) -> dict:
    try:
        admin = create_admin_user(
            db,
            email=body.email,
            password=body.password,
            name=body.name,
            role=body.role,
            phone=body.phone,
        )
    except AdminAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"admin": serialize_admin_account(admin)}


@router.patch("/{admin_id}")
def update_admin_account(
    admin_id: int,
    body: AdminUserUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    actor: OwnerAdminAuth,
) -> dict:
    target = get_admin_by_id(db, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail="관리자를 찾을 수 없습니다.")

    payload = body.model_dump(exclude_unset=True)
    try:
        admin = update_admin_user(
            db,
            target,
            actor=actor,
            name=payload.get("name"),
            role=payload.get("role"),
            phone=payload.get("phone"),
            phone_provided="phone" in payload,
            is_active=payload.get("is_active"),
            password=payload.get("password"),
        )
    except AdminAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"admin": serialize_admin_account(admin)}


@router.delete("/{admin_id}")
def deactivate_admin_account(
    admin_id: int,
    db: Annotated[Session, Depends(get_db)],
    actor: OwnerAdminAuth,
) -> dict:
    target = get_admin_by_id(db, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail="관리자를 찾을 수 없습니다.")
    try:
        admin = deactivate_admin_user(db, target, actor=actor)
    except AdminAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"admin": serialize_admin_account(admin), "deactivated": True}
