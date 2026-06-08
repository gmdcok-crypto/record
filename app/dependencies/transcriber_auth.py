from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.admin_models import Transcriber
from app.services.jwt_tokens import decode_transcriber_access_token
from app.services.transcriber_auth import get_transcriber_by_id

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_transcriber(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Transcriber:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        payload = decode_transcriber_access_token(credentials.credentials)
        transcriber_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    transcriber = get_transcriber_by_id(db, transcriber_id)
    if transcriber is None or not transcriber.is_active:
        raise HTTPException(status_code=401, detail="Transcriber not found")
    if not transcriber.login_id or transcriber.auth_status != "active":
        raise HTTPException(status_code=401, detail="로그인 초기화된 계정입니다. 다시 가입해 주세요")

    return transcriber


def get_optional_current_transcriber(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Transcriber | None:
    if not settings.jwt_configured:
        return None
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None

    try:
        payload = decode_transcriber_access_token(credentials.credentials)
        transcriber_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None

    transcriber = get_transcriber_by_id(db, transcriber_id)
    if transcriber is None or not transcriber.is_active:
        return None
    if not transcriber.login_id or transcriber.auth_status != "active":
        return None

    return transcriber
