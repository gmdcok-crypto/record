from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.models.admin_models import AdminUser, SalesMonthlyTarget

MONTH_KEY_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
KST = timezone(timedelta(hours=9))


def current_kst_month_key(reference: datetime | None = None) -> str:
    moment = reference or datetime.now(KST)
    return moment.strftime("%Y-%m")


def normalize_month_key(month: str | None) -> str:
    candidate = (month or "").strip()
    if not candidate:
        return current_kst_month_key()
    if not MONTH_KEY_PATTERN.fullmatch(candidate):
        raise ValueError("month는 YYYY-MM 형식이어야 합니다.")
    return candidate


def _ensure_sales_monthly_targets_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'sales_monthly_targets'
                LIMIT 1
                """
            )
        ).first()
        if exists:
            return
        conn.execute(
            text(
                """
                CREATE TABLE sales_monthly_targets (
                  month_key CHAR(7) NOT NULL PRIMARY KEY,
                  target_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                  updated_by_admin_id BIGINT NULL,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  KEY idx_sales_monthly_targets_updated_by (updated_by_admin_id),
                  CONSTRAINT fk_sales_monthly_targets_admin
                    FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users(id)
                    ON UPDATE CASCADE ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
        )


def serialize_sales_monthly_target(row: SalesMonthlyTarget | None, *, month_key: str) -> dict:
    amount = float(row.target_amount) if row is not None else 0.0
    return {
        "month_key": month_key,
        "target_amount": amount,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def get_sales_monthly_target(db: Session, month_key: str) -> dict:
    normalized = normalize_month_key(month_key)
    for attempt in range(2):
        try:
            row = db.get(SalesMonthlyTarget, normalized)
            return serialize_sales_monthly_target(row, month_key=normalized)
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if attempt == 1 or "sales_monthly_targets" not in message:
                raise
            _ensure_sales_monthly_targets_table(db)
    return serialize_sales_monthly_target(None, month_key=normalized)


def set_sales_monthly_target(
    db: Session,
    *,
    month_key: str,
    target_amount: float,
    admin: AdminUser | None = None,
) -> dict:
    normalized = normalize_month_key(month_key)
    if target_amount < 0:
        raise ValueError("목표 금액은 0 이상이어야 합니다.")

    for attempt in range(2):
        try:
            row = db.get(SalesMonthlyTarget, normalized)
            if row is None:
                row = SalesMonthlyTarget(
                    month_key=normalized,
                    target_amount=target_amount,
                    updated_by_admin_id=admin.id if admin else None,
                )
                db.add(row)
            else:
                row.target_amount = target_amount
                row.updated_by_admin_id = admin.id if admin else None
            db.commit()
            db.refresh(row)
            return serialize_sales_monthly_target(row, month_key=normalized)
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            message = str(exc).lower()
            if attempt == 1 or "sales_monthly_targets" not in message:
                raise
            _ensure_sales_monthly_targets_table(db)
    raise RuntimeError("매출 목표를 저장하지 못했습니다.")
