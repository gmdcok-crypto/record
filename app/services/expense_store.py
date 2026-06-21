from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session, joinedload

from app.models.admin_models import AdminUser, ExpenseCategory, ExpenseRecord

logger = logging.getLogger(__name__)

DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, int], ...] = (
    ("속기사비용", 1),
    ("광고비", 2),
    ("사이트운영비", 3),
    ("API비용", 4),
    ("결제수수료", 5),
    ("부가세예수금", 6),
)


def _ensure_expense_categories_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        categories_exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'expense_categories'
                LIMIT 1
                """
            )
        ).first()
        if categories_exists:
            return
        conn.execute(
            text(
                """
                CREATE TABLE expense_categories (
                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                  name VARCHAR(100) NOT NULL,
                  sort_order INT NOT NULL DEFAULT 0,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY uk_expense_categories_name (name),
                  KEY idx_expense_categories_sort (sort_order)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
        )


def _ensure_expense_records_table(db: Session) -> None:
    bind = db.get_bind()
    db.rollback()
    records_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'expense_records'
            LIMIT 1
            """
        )
    ).first()
    if records_exists:
        return

    ddl_with_admin_fk = """
        CREATE TABLE expense_records (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          category_id BIGINT NOT NULL,
          amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
          expense_date DATE NOT NULL,
          note VARCHAR(255) NULL,
          source_type VARCHAR(30) NULL,
          source_id VARCHAR(120) NULL,
          created_by_admin_id BIGINT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_expense_records_date (expense_date),
          KEY idx_expense_records_category_id (category_id),
          KEY idx_expense_records_source (source_type, source_id),
          CONSTRAINT fk_expense_records_category
            FOREIGN KEY (category_id) REFERENCES expense_categories(id)
            ON UPDATE CASCADE ON DELETE RESTRICT,
          CONSTRAINT fk_expense_records_admin
            FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id)
            ON UPDATE CASCADE ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """
    ddl_without_admin_fk = """
        CREATE TABLE expense_records (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          category_id BIGINT NOT NULL,
          amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
          expense_date DATE NOT NULL,
          note VARCHAR(255) NULL,
          source_type VARCHAR(30) NULL,
          source_id VARCHAR(120) NULL,
          created_by_admin_id BIGINT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_expense_records_date (expense_date),
          KEY idx_expense_records_category_id (category_id),
          KEY idx_expense_records_source (source_type, source_id),
          CONSTRAINT fk_expense_records_category
            FOREIGN KEY (category_id) REFERENCES expense_categories(id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """
    try:
        with bind.begin() as conn:
            conn.execute(text(ddl_with_admin_fk))
    except Exception:
        logger.warning("Creating expense_records without admin_users FK fallback")
        with bind.begin() as conn:
            conn.execute(text(ddl_without_admin_fk))


def _ensure_expense_storage(db: Session) -> None:
    _ensure_expense_categories_table(db)
    _ensure_expense_records_table(db)


def seed_default_expense_categories(db: Session) -> None:
    _ensure_expense_categories_table(db)
    bind = db.get_bind()
    db.rollback()
    with bind.begin() as conn:
        for name, sort_order in DEFAULT_EXPENSE_CATEGORIES:
            conn.execute(
                text(
                    """
                    INSERT IGNORE INTO expense_categories (name, sort_order)
                    VALUES (:name, :sort_order)
                    """
                ),
                {"name": name, "sort_order": sort_order},
            )
    db.expire_all()


def _expense_records_table_exists(db: Session) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'expense_records'
                LIMIT 1
                """
            )
        ).first()
        is not None
    )


def ensure_expense_storage(db: Session) -> None:
    try:
        _ensure_expense_storage(db)
    except Exception:
        logger.exception("Failed to ensure expense storage")


def ensure_default_expense_data(db: Session) -> None:
    try:
        seed_default_expense_categories(db)
    except Exception:
        logger.exception("Failed to seed default expense categories")


def _serialize_category(row: ExpenseCategory) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _serialize_record(row: ExpenseRecord) -> dict:
    return {
        "id": row.id,
        "category_id": row.category_id,
        "category_name": row.category.name if row.category else "",
        "amount": float(row.amount or 0),
        "expense_date": row.expense_date.isoformat() if row.expense_date else None,
        "note": row.note or "",
        "source_type": row.source_type,
        "source_id": row.source_id,
        "created_by_admin_id": row.created_by_admin_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_expense_categories(db: Session) -> list[dict]:
    for attempt in range(2):
        try:
            _ensure_expense_categories_table(db)
            rows = db.scalars(
                select(ExpenseCategory).order_by(ExpenseCategory.sort_order.asc(), ExpenseCategory.id.asc())
            ).all()
            if rows:
                return [_serialize_category(row) for row in rows]
            seed_default_expense_categories(db)
            rows = db.scalars(
                select(ExpenseCategory).order_by(ExpenseCategory.sort_order.asc(), ExpenseCategory.id.asc())
            ).all()
            return [_serialize_category(row) for row in rows]
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            if attempt == 1 or "expense_" not in str(exc).lower():
                break
            _ensure_expense_categories_table(db)
        except Exception:
            logger.exception("ORM expense category query failed")
            break

    try:
        _ensure_expense_categories_table(db)
        result = db.execute(
            text(
                """
                SELECT id, name, sort_order, created_at
                FROM expense_categories
                ORDER BY sort_order ASC, id ASC
                """
            )
        )
        rows = []
        for row in result.mappings():
            created_at = row["created_at"]
            rows.append(
                {
                    "id": int(row["id"]),
                    "name": row["name"],
                    "sort_order": int(row["sort_order"] or 0),
                    "created_at": created_at.isoformat() if created_at else None,
                }
            )
        return rows
    except Exception:
        logger.exception("Raw SQL expense category query failed")
        raise


def create_expense_category(db: Session, *, name: str, sort_order: int | None = None) -> ExpenseCategory:
    _ensure_expense_categories_table(db)
    safe_name = name.strip()[:100]
    if not safe_name:
        raise ValueError("지출항목 이름을 입력해 주세요.")
    if sort_order is None:
        max_order = db.scalar(select(ExpenseCategory.sort_order).order_by(ExpenseCategory.sort_order.desc()).limit(1))
        sort_order = int(max_order or 0) + 1
    row = ExpenseCategory(name=safe_name, sort_order=sort_order)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("이미 같은 이름의 지출항목이 있습니다.") from exc
    db.refresh(row)
    return row


def update_expense_category(
    db: Session,
    category: ExpenseCategory,
    *,
    name: str | None = None,
    sort_order: int | None = None,
) -> ExpenseCategory:
    if name is not None:
        safe_name = name.strip()[:100]
        if not safe_name:
            raise ValueError("지출항목 이름을 입력해 주세요.")
        category.name = safe_name
    if sort_order is not None:
        category.sort_order = sort_order
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("이미 같은 이름의 지출항목이 있습니다.") from exc
    db.refresh(category)
    return category


def delete_expense_category(db: Session, category: ExpenseCategory) -> None:
    linked = None
    if _expense_records_table_exists(db):
        linked = db.scalar(
            select(ExpenseRecord.id).where(ExpenseRecord.category_id == category.id).limit(1)
        )
    if linked is not None:
        raise ValueError("사용 중인 지출항목은 삭제할 수 없습니다.")
    db.delete(category)
    db.commit()


def get_expense_category(db: Session, category_id: int) -> ExpenseCategory | None:
    _ensure_expense_categories_table(db)
    return db.scalar(select(ExpenseCategory).where(ExpenseCategory.id == category_id))


def list_expense_records(
    db: Session,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> list[dict]:
    if not _expense_records_table_exists(db):
        return []

    for attempt in range(2):
        try:
            query = select(ExpenseRecord).options(joinedload(ExpenseRecord.category))
            if date_from is not None:
                query = query.where(ExpenseRecord.expense_date >= date_from)
            if date_to is not None:
                query = query.where(ExpenseRecord.expense_date <= date_to)
            rows = db.scalars(
                query.order_by(ExpenseRecord.expense_date.desc(), ExpenseRecord.id.desc()).limit(limit)
            ).all()
            return [_serialize_record(row) for row in rows]
        except (OperationalError, ProgrammingError) as exc:
            db.rollback()
            if attempt == 1 or "expense_" not in str(exc).lower():
                logger.exception("Failed to query expense records")
                return []
        except Exception:
            logger.exception("Failed to query expense records")
            return []
    return []


def create_expense_record(
    db: Session,
    *,
    category_id: int,
    amount: float,
    expense_date: date,
    note: str | None,
    admin: AdminUser | None,
) -> ExpenseRecord:
    _ensure_expense_records_table(db)
    category = get_expense_category(db, category_id)
    if category is None:
        raise ValueError("지출항목을 찾을 수 없습니다.")
    if amount <= 0:
        raise ValueError("지출 금액은 0보다 커야 합니다.")
    row = ExpenseRecord(
        category_id=category.id,
        amount=amount,
        expense_date=expense_date,
        note=(note or "").strip()[:255] or None,
        created_by_admin_id=admin.id if admin else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row.category = category
    return row


def get_expense_record(db: Session, record_id: int) -> ExpenseRecord | None:
    _ensure_expense_records_table(db)
    return db.scalar(
        select(ExpenseRecord)
        .options(joinedload(ExpenseRecord.category))
        .where(ExpenseRecord.id == record_id)
    )


def update_expense_record(
    db: Session,
    record: ExpenseRecord,
    *,
    category_id: int | None = None,
    amount: float | None = None,
    expense_date: date | None = None,
    note: str | None = None,
) -> ExpenseRecord:
    if category_id is not None:
        category = get_expense_category(db, category_id)
        if category is None:
            raise ValueError("지출항목을 찾을 수 없습니다.")
        record.category_id = category.id
        record.category = category
    if amount is not None:
        if amount <= 0:
            raise ValueError("지출 금액은 0보다 커야 합니다.")
        record.amount = amount
    if expense_date is not None:
        record.expense_date = expense_date
    if note is not None:
        record.note = note.strip()[:255] or None
    record.updated_at = datetime.now().replace(tzinfo=None)
    db.commit()
    db.refresh(record)
    return record


def delete_expense_record(db: Session, record: ExpenseRecord) -> None:
    if record.source_type:
        raise ValueError("자동 연동된 지출은 삭제할 수 없습니다.")
    db.delete(record)
    db.commit()
