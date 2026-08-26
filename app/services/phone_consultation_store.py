from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.models.admin_models import PhoneConsultation
from app.services.member_auth import MemberAuthError, normalize_phone, register_or_login_member_with_phone, serialize_member

logger = logging.getLogger(__name__)
_schema_ready = False


def _ensure_schema(db: Session) -> None:
    global _schema_ready
    if _schema_ready:
        return
    bind = db.get_bind()
    if bind is None:
        return
    from app.services.database_migrate import ensure_phone_consultations_table

    ensure_phone_consultations_table(bind)
    _schema_ready = True


def _normalize_ranges(ranges: list[dict[str, Any]] | None, *, range_start: str = "", range_end: str = "") -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    if ranges:
        for item in ranges:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "start": str(item.get("start") or "").strip(),
                    "end": str(item.get("end") or "").strip(),
                }
            )
    if not normalized and (range_start or range_end):
        normalized.append({"start": (range_start or "").strip(), "end": (range_end or "").strip()})
    if not normalized:
        normalized.append({"start": "", "end": ""})
    return normalized[:20]


def _parse_ranges_json(raw: str | None) -> list[dict[str, str]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return _normalize_ranges(data)


def _serialize(row: PhoneConsultation) -> dict:
    ranges = _parse_ranges_json(row.ranges_json)
    if not ranges:
        ranges = _normalize_ranges(None, range_start=row.range_start or "", range_end=row.range_end or "")
    return {
        "id": row.id,
        "customer_name": row.customer_name or "",
        "phone": row.phone or "",
        "inquiry_type": row.inquiry_type or "",
        "order_type": row.order_type or "",
        "file_kind": row.file_kind or "",
        "file_count": row.file_count or "",
        "range_start": row.range_start or "",
        "range_end": row.range_end or "",
        "ranges": ranges,
        "duration_seconds": int(row.duration_seconds or 0),
        "estimated_amount": int(row.estimated_amount or 0),
        "deadline": row.deadline.isoformat(sep=" ") if row.deadline else None,
        "delivery_method": row.delivery_method or "",
        "memo": row.memo or "",
        "assignee": row.assignee or "",
        "status": row.status or "draft",
        "created_at": row.created_at.isoformat(sep=" ") if row.created_at else None,
        "updated_at": row.updated_at.isoformat(sep=" ") if row.updated_at else None,
    }


def _parse_deadline(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    for candidate in (normalized, normalized.replace(" ", "T")):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    # datetime-local without seconds: 2026-08-21T15:00
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?", raw)
    if match:
        seconds = match.group(3) or "00"
        try:
            return datetime.fromisoformat(f"{match.group(1)}T{match.group(2)}:{seconds}")
        except ValueError:
            return None
    return None


def list_phone_consultations(
    db: Session,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 200,
) -> list[dict]:
    stmt: Select[tuple[PhoneConsultation]] = select(PhoneConsultation).order_by(
        PhoneConsultation.created_at.desc(),
        PhoneConsultation.id.desc(),
    )
    if status:
        stmt = stmt.where(PhoneConsultation.status == status.strip())
    query = (q or "").strip()
    if query:
        like = f"%{query}%"
        stmt = stmt.where(
            or_(
                PhoneConsultation.customer_name.like(like),
                PhoneConsultation.phone.like(like),
                PhoneConsultation.assignee.like(like),
                PhoneConsultation.memo.like(like),
            )
        )
    stmt = stmt.limit(max(1, min(limit, 500)))
    rows = db.scalars(stmt).all()
    return [_serialize(row) for row in rows]


def get_phone_consultation(db: Session, consultation_id: int) -> dict | None:
    row = db.get(PhoneConsultation, consultation_id)
    if row is None:
        return None
    return _serialize(row)


def lookup_customer_by_phone(db: Session, phone: str) -> dict:
    from app.models.admin_models import Client, Job, PaymentRecord
    from app.services.job_store import member_client_code
    from app.services.member_auth import get_member_by_phone, serialize_member

    normalized = normalize_phone(phone)
    empty_deals = {"jobs": [], "payments": [], "consultations": [], "total_count": 0}
    if not normalized:
        return {
            "found": False,
            "is_new": True,
            "member": None,
            "recent_consultations": [],
            "deals": empty_deals,
            "has_deals": False,
        }

    member = get_member_by_phone(db, normalized)
    stmt = (
        select(PhoneConsultation)
        .where(PhoneConsultation.phone == normalized)
        .order_by(PhoneConsultation.created_at.desc(), PhoneConsultation.id.desc())
        .limit(5)
    )
    recent = [_serialize(row) for row in db.scalars(stmt).all()]

    jobs: list[dict] = []
    payments: list[dict] = []
    if member is not None:
        client = db.scalar(select(Client).where(Client.client_code == member_client_code(member.id)))
        if client is not None:
            job_rows = db.scalars(
                select(Job)
                .where(Job.client_id == client.id)
                .order_by(Job.updated_at.desc(), Job.job_id.desc())
                .limit(10)
            ).all()
            for job in job_rows:
                jobs.append(
                    {
                        "job_id": job.job_id,
                        "title": job.title,
                        "filename": job.original_filename,
                        "status": job.status,
                        "payment_status": job.payment_status,
                        "final_bill_amount": float(job.final_bill_amount or 0),
                        "updated_at": job.updated_at.isoformat(sep=" ") if job.updated_at else None,
                    }
                )
        payment_rows = db.scalars(
            select(PaymentRecord)
            .where(PaymentRecord.member_id == member.id)
            .order_by(PaymentRecord.paid_at.desc(), PaymentRecord.id.desc())
            .limit(10)
        ).all()
        for row in payment_rows:
            payments.append(
                {
                    "id": row.id,
                    "payment_id": row.payment_id,
                    "order_name": row.order_name,
                    "amount": float(row.amount or 0),
                    "pay_method": row.pay_method,
                    "paid_at": row.paid_at.isoformat(sep=" ") if row.paid_at else None,
                    "status": "paid",
                }
            )

    consultation_deals = [
        {
            "id": row["id"],
            "title": row.get("customer_name") or "전화상담",
            "inquiry_type": row.get("inquiry_type") or "",
            "order_type": row.get("order_type") or "",
            "status": row.get("status") or "",
            "estimated_amount": int(row.get("estimated_amount") or 0),
            "created_at": row.get("created_at"),
        }
        for row in recent
    ]
    deals = {
        "jobs": jobs,
        "payments": payments,
        "consultations": consultation_deals,
        "total_count": len(jobs) + len(payments) + len(consultation_deals),
    }

    if member is not None:
        return {
            "found": True,
            "is_new": False,
            "member": {
                **serialize_member(member),
                "is_active": bool(member.is_active),
                "created_at": member.created_at.isoformat(sep=" ") if member.created_at else None,
            },
            "recent_consultations": recent,
            "deals": deals,
            "has_deals": deals["total_count"] > 0,
        }

    if recent:
        latest = recent[0]
        return {
            "found": True,
            "is_new": False,
            "member": {
                "id": None,
                "email": None,
                "name": latest.get("customer_name") or "",
                "phone": normalized,
                "is_active": True,
                "created_at": latest.get("created_at"),
                "from_consultation": True,
            },
            "recent_consultations": recent,
            "deals": deals,
            "has_deals": deals["total_count"] > 0,
        }

    return {
        "found": False,
        "is_new": True,
        "member": None,
        "recent_consultations": [],
        "deals": empty_deals,
        "has_deals": False,
    }


def create_phone_consultation(
    db: Session,
    *,
    customer_name: str,
    phone: str,
    inquiry_type: str = "",
    order_type: str = "",
    file_kind: str = "",
    file_count: str = "",
    ranges: list[dict[str, Any]] | None = None,
    range_start: str = "",
    range_end: str = "",
    duration_seconds: int = 0,
    estimated_amount: int = 0,
    deadline: str | None = None,
    delivery_method: str = "",
    memo: str | None = "",
    assignee: str = "",
    status: str = "completed",
    auto_register_member: bool = True,
) -> dict:
    _ensure_schema(db)
    normalized_phone = normalize_phone(phone) or re.sub(r"\D", "", (phone or "").strip())
    normalized_name = (customer_name or "").strip()
    if not normalized_name:
        raise ValueError("의뢰인 이름을 입력해 주세요.")
    if len(normalized_phone) < 10:
        raise ValueError("전화번호를 확인해 주세요.")

    status_value = (status or "completed").strip() or "completed"
    if status_value not in {"draft", "completed"}:
        status_value = "completed"

    normalized_ranges = _normalize_ranges(ranges, range_start=range_start, range_end=range_end)
    first = normalized_ranges[0]
    ranges_json = json.dumps(normalized_ranges, ensure_ascii=False)

    member_payload = None
    member_created = False
    member_error = None
    if auto_register_member:
        try:
            member, member_created = register_or_login_member_with_phone(
                db,
                phone=normalized_phone,
                name=normalized_name,
            )
            member_payload = serialize_member(member)
        except MemberAuthError as exc:
            member_error = str(exc)
            logger.warning(
                "phone consultation member auto-register skipped phone=%s error=%s",
                normalized_phone,
                member_error,
            )
            db.rollback()
        except Exception:
            member_error = "회원 자동가입에 실패했습니다."
            logger.exception("phone consultation member auto-register failed phone=%s", normalized_phone)
            db.rollback()

    try:
        row = PhoneConsultation(
            customer_name=normalized_name,
            phone=normalized_phone,
            inquiry_type=(inquiry_type or "").strip(),
            order_type=(order_type or "").strip(),
            file_kind=(file_kind or "").strip(),
            file_count=(file_count or "").strip() or str(len(normalized_ranges)),
            range_start=first["start"],
            range_end=first["end"],
            ranges_json=ranges_json,
            duration_seconds=max(0, int(duration_seconds or 0)),
            estimated_amount=max(0, int(estimated_amount or 0)),
            deadline=_parse_deadline(deadline),
            delivery_method=(delivery_method or "").strip(),
            memo=((memo or "").strip()[:500] or None),
            assignee=(assignee or "").strip(),
            status=status_value,
            purpose="",
            priority="",
            region="",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise

    return {
        "consultation": _serialize(row),
        "member": member_payload,
        "member_created": member_created,
        "member_error": member_error,
    }
