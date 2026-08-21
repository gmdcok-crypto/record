import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.admin_auth import require_admin_permission
from app.models.admin_models import AdminUser
from app.services.phone_consultation_store import get_phone_consultation, list_phone_consultations

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/phone-consultations", tags=["admin-phone-consultations"])

PhoneConsultationsAdminAuth = Annotated[
    AdminUser, Depends(require_admin_permission("menu:phone_consultations"))
]


@router.get("")
def get_phone_consultations(
    db: Annotated[Session, Depends(get_db)],
    _admin: PhoneConsultationsAdminAuth,
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    try:
        consultations = list_phone_consultations(db, status=status, q=q, limit=limit)
    except Exception as exc:
        logger.exception("Failed to load phone consultations")
        raise HTTPException(status_code=500, detail="전화상담 내역을 불러올 수 없습니다.") from exc
    return {"consultations": consultations, "total": len(consultations)}


@router.get("/{consultation_id}")
def get_phone_consultation_detail(
    consultation_id: int,
    db: Annotated[Session, Depends(get_db)],
    _admin: PhoneConsultationsAdminAuth,
) -> dict:
    try:
        row = get_phone_consultation(db, consultation_id)
    except Exception as exc:
        logger.exception("Failed to load phone consultation %s", consultation_id)
        raise HTTPException(status_code=500, detail="전화상담 내역을 불러올 수 없습니다.") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="전화상담 내역을 찾을 수 없습니다.")
    return {"consultation": row}
