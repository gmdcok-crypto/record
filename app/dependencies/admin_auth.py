from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.admin_models import AdminUser
from app.services.admin_auth import get_admin_by_id
from app.services.admin_permissions import has_permission
from app.services.jwt_tokens import decode_admin_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def _decode_admin_token(raw_token: str) -> int:
    payload = decode_admin_access_token(raw_token)
    return int(payload["sub"])


def _load_active_admin(db: Session, admin_id: int) -> AdminUser | None:
    try:
        admin = get_admin_by_id(db, admin_id)
    except SQLAlchemyError:
        return None
    if admin is None or not admin.is_active:
        return None
    return admin


def _resolve_admin_token(
    credentials: HTTPAuthorizationCredentials | None,
    query_token: str | None,
) -> str | None:
    if credentials is not None and credentials.scheme.lower() == "bearer" and credentials.credentials.strip():
        return credentials.credentials.strip()
    if query_token and query_token.strip():
        return query_token.strip()
    return None


def get_current_admin(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUser:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    raw_token = _resolve_admin_token(credentials, None)
    if raw_token is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        admin_id = _decode_admin_token(raw_token)
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    try:
        admin = _load_active_admin(db, admin_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="관리자 정보를 확인할 수 없습니다.") from exc

    if admin is None:
        raise HTTPException(status_code=401, detail="Admin not found")

    return admin


def get_current_admin_from_query_or_bearer(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str | None, Query()] = None,
) -> AdminUser:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    raw_token = _resolve_admin_token(credentials, token)
    if raw_token is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        admin_id = _decode_admin_token(raw_token)
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    try:
        admin = _load_active_admin(db, admin_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="관리자 정보를 확인할 수 없습니다.") from exc

    if admin is None:
        raise HTTPException(status_code=401, detail="Admin not found")

    return admin


def require_admin_permission(permission: str):
    def _dependency(
        admin: Annotated[AdminUser, Depends(get_current_admin)],
    ) -> AdminUser:
        if not has_permission(admin.role, permission):
            raise HTTPException(status_code=403, detail="이 작업을 수행할 권한이 없습니다.")
        return admin

    return _dependency


AdminAuth = Annotated[AdminUser, Depends(get_current_admin)]
AdminEventAuth = Annotated[AdminUser, Depends(get_current_admin_from_query_or_bearer)]


def get_optional_current_admin(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUser | None:
    if not settings.jwt_configured:
        return None

    raw_token = _resolve_admin_token(credentials, None)
    if raw_token is None:
        return None

    try:
        admin_id = _decode_admin_token(raw_token)
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None

    try:
        return _load_active_admin(db, admin_id)
    except SQLAlchemyError:
        return None


OptionalAdminAuth = Annotated[AdminUser | None, Depends(get_optional_current_admin)]
