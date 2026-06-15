import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ProgrammingError

from app.services.database_reset import _run_sql_file

logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"

STARTUP_MIGRATIONS = [
    SCRIPTS_DIR / "migrate_transcriber_profile.sql",
    SCRIPTS_DIR / "migrate_transcriber_auth.sql",
    SCRIPTS_DIR / "migrate_transcriber_auth_status.sql",
    SCRIPTS_DIR / "migrate_member_auth.sql",
    SCRIPTS_DIR / "migrate_member_phone_optional.sql",
    SCRIPTS_DIR / "migrate_projects.sql",
    SCRIPTS_DIR / "migrate_project_pdf_delivery_mode.sql",
    SCRIPTS_DIR / "migrate_job_assignment_timestamp.sql",
    SCRIPTS_DIR / "migrate_transcript_change_logs.sql",
    SCRIPTS_DIR / "migrate_transcriber_license.sql",
    SCRIPTS_DIR / "migrate_member_push_subscriptions.sql",
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

    return False


def run_sql_migration(engine: Engine, sql_path: Path) -> None:
    if not sql_path.exists():
        logger.warning("Skipping migration; SQL file not found: %s", sql_path)
        return
    try:
        _run_sql_file(engine, sql_path)
    except ProgrammingError as exc:
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
