import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.services.database_reset import _run_sql_file

logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"

STARTUP_MIGRATIONS = [
    SCRIPTS_DIR / "migrate_transcriber_profile.sql",
    SCRIPTS_DIR / "migrate_transcriber_grade.sql",
    SCRIPTS_DIR / "migrate_transcriber_auth.sql",
    SCRIPTS_DIR / "migrate_transcriber_auth_status.sql",
    SCRIPTS_DIR / "migrate_member_auth.sql",
    SCRIPTS_DIR / "migrate_member_phone_optional.sql",
    SCRIPTS_DIR / "migrate_projects.sql",
    SCRIPTS_DIR / "migrate_project_pdf_delivery_mode.sql",
    SCRIPTS_DIR / "migrate_job_assignment_timestamp.sql",
    SCRIPTS_DIR / "migrate_job_selected_segments.sql",
    SCRIPTS_DIR / "migrate_transcript_change_logs.sql",
    SCRIPTS_DIR / "migrate_transcriber_license.sql",
    SCRIPTS_DIR / "migrate_transcriber_grade_rates.sql",
    SCRIPTS_DIR / "migrate_settlement_payments.sql",
    SCRIPTS_DIR / "migrate_payment_records.sql",
    SCRIPTS_DIR / "migrate_member_push_subscriptions.sql",
    SCRIPTS_DIR / "migrate_admin_push_subscriptions.sql",
    SCRIPTS_DIR / "migrate_admin_auth.sql",
    SCRIPTS_DIR / "migrate_transcriber_push_subscriptions.sql",
    SCRIPTS_DIR / "migrate_job_transcriber_review_status.sql",
]


def _run_railway_safe_migration(engine: Engine, sql_path: Path, message: str) -> bool:
    lowered = message.lower()
    sql = sql_path.read_text(encoding="utf-8").strip()

    if sql_path.name == "migrate_project_pdf_delivery_mode.sql" and "if not exists" in lowered:
        with engine.begin() as conn:
            exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'projects'
                      AND COLUMN_NAME = 'pdf_delivery_mode'
                    LIMIT 1
                    """
                )
            ).first()
            if not exists:
                conn.execute(
                    text(
                        "ALTER TABLE projects "
                        "ADD COLUMN pdf_delivery_mode VARCHAR(20) NOT NULL DEFAULT 'individual'"
                    )
                )
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_job_assignment_timestamp.sql" and "if not exists" in lowered:
        with engine.begin() as conn:
            column_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'jobs'
                      AND COLUMN_NAME = 'assigned_at'
                    LIMIT 1
                    """
                )
            ).first()
            if not column_exists:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN assigned_at DATETIME NULL"))

            index_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'jobs'
                      AND INDEX_NAME = 'idx_jobs_assigned_at'
                    LIMIT 1
                    """
                )
            ).first()
            if not index_exists:
                conn.execute(text("CREATE INDEX idx_jobs_assigned_at ON jobs (assigned_at)"))

            conn.execute(
                text(
                    """
                    UPDATE jobs j
                    LEFT JOIN (
                      SELECT job_id, MAX(assigned_at) AS latest_assigned_at
                      FROM job_assignments
                      WHERE to_transcriber_id IS NOT NULL
                      GROUP BY job_id
                    ) a ON a.job_id = j.job_id
                    SET j.assigned_at = CASE
                      WHEN j.assigned_transcriber_id IS NOT NULL THEN a.latest_assigned_at
                      ELSE NULL
                    END
                    WHERE j.assigned_at IS NULL
                    """
                )
            )
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_job_selected_segments.sql":
        with engine.begin() as conn:
            exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'jobs'
                      AND COLUMN_NAME = 'selected_segments_json'
                    LIMIT 1
                    """
                )
            ).first()
            if not exists:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN selected_segments_json JSON NULL"))
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_transcriber_grade.sql":
        with engine.begin() as conn:
            exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'transcribers'
                      AND COLUMN_NAME = 'grade_level'
                    LIMIT 1
                    """
                )
            ).first()
            if not exists:
                conn.execute(text("ALTER TABLE transcribers ADD COLUMN grade_level INT NOT NULL DEFAULT 1 AFTER status"))
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_transcriber_grade_rates.sql":
        with engine.begin() as conn:
            table_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'transcriber_grade_rates'
                    LIMIT 1
                    """
                )
            ).first()
            if not table_exists:
                conn.execute(
                    text(
                        """
                        CREATE TABLE transcriber_grade_rates (
                          id BIGINT AUTO_INCREMENT PRIMARY KEY,
                          grade_level INT NOT NULL,
                          per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
                          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                          UNIQUE KEY uk_transcriber_grade_rates_level (grade_level)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                        """
                    )
                )
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_settlement_payments.sql":
        with engine.begin() as conn:
            paid_column_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'settlements'
                      AND COLUMN_NAME = 'total_paid_amount'
                    LIMIT 1
                    """
                )
            ).first()
            if not paid_column_exists:
                conn.execute(
                    text(
                        "ALTER TABLE settlements "
                        "ADD COLUMN total_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER final_amount"
                    )
                )

            payment_table_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'settlement_payments'
                    LIMIT 1
                    """
                )
            ).first()
            if not payment_table_exists:
                conn.execute(
                    text(
                        """
                        CREATE TABLE settlement_payments (
                          id BIGINT AUTO_INCREMENT PRIMARY KEY,
                          settlement_id BIGINT NOT NULL,
                          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                          paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          note VARCHAR(255) NULL,
                          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          CONSTRAINT fk_settlement_payments_settlement
                            FOREIGN KEY (settlement_id) REFERENCES settlements(id)
                            ON UPDATE CASCADE ON DELETE CASCADE,
                          KEY idx_settlement_payments_settlement_id (settlement_id),
                          KEY idx_settlement_payments_paid_at (paid_at)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                        """
                    )
                )
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name == "migrate_job_transcriber_review_status.sql":
        return ensure_jobs_status_column(engine)

    if sql_path.name == "migrate_payment_records.sql":
        with engine.begin() as conn:
            table_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'payment_records'
                    LIMIT 1
                    """
                )
            ).first()
            if not table_exists:
                conn.execute(
                    text(
                        """
                        CREATE TABLE payment_records (
                          id BIGINT AUTO_INCREMENT PRIMARY KEY,
                          payment_id VARCHAR(120) NOT NULL,
                          member_id BIGINT NULL,
                          member_name VARCHAR(100) NOT NULL,
                          order_name VARCHAR(255) NOT NULL,
                          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                          pay_method VARCHAR(50) NULL,
                          paid_at DATETIME NULL,
                          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          UNIQUE KEY uk_payment_records_payment_id (payment_id),
                          KEY idx_payment_records_member_id (member_id),
                          KEY idx_payment_records_paid_at (paid_at),
                          CONSTRAINT fk_payment_records_member
                            FOREIGN KEY (member_id) REFERENCES members(id)
                            ON UPDATE CASCADE ON DELETE SET NULL
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                        """
                    )
                )
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    if sql_path.name in {
        "migrate_member_push_subscriptions.sql",
        "migrate_admin_push_subscriptions.sql",
        "migrate_transcriber_push_subscriptions.sql",
    }:
        with engine.begin() as conn:
            table_name = sql_path.name.replace("migrate_", "").replace(".sql", "")
            table_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = :table_name
                    LIMIT 1
                    """
                ),
                {"table_name": table_name},
            ).first()
            if not table_exists:
                conn.execute(text(sql))
        logger.info("Railway-safe migration applied: %s", sql_path.name)
        return True

    return False


def ensure_jobs_status_column(engine: Engine) -> bool:
    try:
        with engine.begin() as conn:
            column_type = conn.execute(
                text(
                    """
                    SELECT COLUMN_TYPE
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'jobs'
                      AND COLUMN_NAME = 'status'
                    LIMIT 1
                    """
                )
            ).scalar()
            normalized = str(column_type or "").lower().replace(" ", "")
            if "varchar" in normalized:
                return True
            conn.execute(
                text(
                    """
                    ALTER TABLE jobs
                      MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'uploaded'
                    """
                )
            )
        logger.info("Converted jobs.status to VARCHAR(40) for transcriber_review support")
        return True
    except Exception:
        logger.exception("Failed to migrate jobs.status column")
        return False


def run_sql_migration(engine: Engine, sql_path: Path) -> None:
    if not sql_path.exists():
        logger.warning("Skipping migration; SQL file not found: %s", sql_path)
        return
    try:
        _run_sql_file(engine, sql_path)
    except (ProgrammingError, OperationalError) as exc:
        message = str(exc)
        if _run_railway_safe_migration(engine, sql_path, message):
            return
        lowered = message.lower()
        if any(
            token in lowered
            for token in [
                "duplicate column name",
                "duplicate key name",
                "duplicate entry",
                "already exists",
                "check that column/key exists",
            ]
        ):
            logger.info("Skipping already-applied migration %s: %s", sql_path.name, message)
            return
        raise


def run_startup_migrations(engine: Engine) -> None:
    for sql_path in STARTUP_MIGRATIONS:
        try:
            run_sql_migration(engine, sql_path)
        except Exception:
            logger.exception("Startup migration failed: %s", sql_path.name)
