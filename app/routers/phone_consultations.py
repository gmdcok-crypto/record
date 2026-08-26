import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.admin_auth import require_admin_permission
from app.models.admin_models import AdminUser
from app.services.phone_consultation_store import (
    create_phone_consultation,
    get_phone_consultation,
    list_phone_consultations,
    lookup_customer_by_phone,
)
from app.services.member_auth import normalize_phone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/phone-consultations", tags=["admin-phone-consultations"])
intake_router = APIRouter(prefix="/api/phone-consultations", tags=["phone-consultations"])

PhoneConsultationsAdminAuth = Annotated[
    AdminUser, Depends(require_admin_permission("menu:phone_consultations"))
]


class PhoneConsultationCreateRequest(BaseModel):
    customer_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=10, max_length=30)
    inquiry_type: str = Field(default="", max_length=30)
    order_type: str = Field(default="", max_length=20)
    file_kind: str = Field(default="", max_length=20)
    file_count: str = Field(default="", max_length=30)
    ranges: list[dict] | None = None
    range_start: str = Field(default="", max_length=16)
    range_end: str = Field(default="", max_length=16)
    duration_seconds: int = Field(default=0, ge=0)
    estimated_amount: int = Field(default=0, ge=0)
    deadline: str | None = Field(default=None, max_length=40)
    delivery_method: str = Field(default="", max_length=20)
    memo: str | None = Field(default="", max_length=500)
    assignee: str = Field(default="", max_length=100)
    status: str = Field(default="completed", max_length=20)
    auto_register_member: bool = True


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


def _create_consultation_response(
    db: Session,
    body: PhoneConsultationCreateRequest,
) -> dict:
    try:
        return create_phone_consultation(
            db,
            customer_name=body.customer_name,
            phone=body.phone,
            inquiry_type=body.inquiry_type,
            order_type=body.order_type,
            file_kind=body.file_kind,
            file_count=body.file_count,
            ranges=body.ranges,
            range_start=body.range_start,
            range_end=body.range_end,
            duration_seconds=body.duration_seconds,
            estimated_amount=body.estimated_amount,
            deadline=body.deadline,
            delivery_method=body.delivery_method,
            memo=body.memo,
            assignee=body.assignee,
            status=body.status,
            auto_register_member=body.auto_register_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            logger.exception("Failed to rollback after phone consultation create error")
        logger.exception("Failed to create phone consultation")
        raise HTTPException(
            status_code=500,
            detail=f"전화상담 저장에 실패했습니다: {exc}",
        ) from exc


@intake_router.get("/lookup")
def lookup_phone_customer(
    db: Annotated[Session, Depends(get_db)],
    phone: str = Query(min_length=10, max_length=30),
) -> dict:
    normalized = normalize_phone(phone)
    if not normalized or len(normalized) < 10:
        raise HTTPException(status_code=400, detail="전화번호를 확인해 주세요.")
    try:
        return lookup_customer_by_phone(db, normalized)
    except Exception as exc:
        logger.exception("Failed to lookup phone customer phone=%s", normalized)
        raise HTTPException(status_code=500, detail="고객 조회에 실패했습니다.") from exc


@intake_router.post("")
def intake_phone_consultation(
    body: PhoneConsultationCreateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """TelWork PWA intake: save consultation and auto-register member by phone."""
    return _create_consultation_response(db, body)


@router.post("")
def admin_create_phone_consultation(
    body: PhoneConsultationCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: PhoneConsultationsAdminAuth,
) -> dict:
    return _create_consultation_response(db, body)
