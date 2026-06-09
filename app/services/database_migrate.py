import logging
from pathlib import Path

from sqlalchemy.engine import Engine

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
    SCRIPTS_DIR / "migrate_transcript_change_logs.sql",
]


def run_sql_migration(engine: Engine, sql_path: Path) -> None:
    if not sql_path.exists():
        logger.warning("Skipping migration; SQL file not found: %s", sql_path)
        return
    _run_sql_file(engine, sql_path)


def run_startup_migrations(engine: Engine) -> None:
    for sql_path in STARTUP_MIGRATIONS:
        try:
            run_sql_migration(engine, sql_path)
        except Exception:
            logger.exception("Startup migration failed: %s", sql_path.name)
