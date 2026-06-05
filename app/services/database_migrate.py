from pathlib import Path

from sqlalchemy.engine import Engine

from app.services.database_reset import _run_sql_file

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"

STARTUP_MIGRATIONS = [
    SCRIPTS_DIR / "migrate_transcriber_profile.sql",
]


def run_sql_migration(engine: Engine, sql_path: Path) -> None:
    if not sql_path.exists():
        raise FileNotFoundError(f"Missing SQL file: {sql_path}")
    _run_sql_file(engine, sql_path)


def run_startup_migrations(engine: Engine) -> None:
    for sql_path in STARTUP_MIGRATIONS:
        run_sql_migration(engine, sql_path)
