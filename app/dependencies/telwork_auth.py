from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.admin_models import TelWorkAssignee
from app.services.jwt_tokens import decode_telwork_access_token
from app.services.tel_work_assignee_store import get_assignee_by_id

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_telwork_staff(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> TelWorkAssignee:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials.strip():
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_telwork_access_token(credentials.credentials.strip())
        assignee_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    row = get_assignee_by_id(db, assignee_id)
    if row is None or not row.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return row


TelWorkAuth = Annotated[TelWorkAssignee, Depends(get_current_telwork_staff)]
