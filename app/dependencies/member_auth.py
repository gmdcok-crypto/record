from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.admin_models import Member
from app.services.jwt_tokens import decode_member_access_token
from app.services.member_auth import get_member_by_id

bearer_scheme = HTTPBearer(auto_error=False)


def get_optional_current_member(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Member | None:
    if not settings.jwt_configured:
        return None
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None

    try:
        payload = decode_member_access_token(credentials.credentials)
        member_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None

    member = get_member_by_id(db, member_id)
    if member is None or not member.is_active:
        return None

    return member


def get_current_member(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Member:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        payload = decode_member_access_token(credentials.credentials)
        member_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    member = get_member_by_id(db, member_id)
    if member is None or not member.is_active:
        raise HTTPException(status_code=401, detail="Member not found")

    return member
