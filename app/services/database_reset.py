from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT_DIR / "scripts"

DROP_TABLES = [
    "settlement_items",
    "settlements",
    "invoice_payments",
    "invoices",
    "job_notes",
    "job_status_logs",
    "job_assignments",
    "jobs",
    "transcribers",
    "admin_users",
    "clients",
    "transcript_history",
]

INIT_SQL_FILES = [
    SCRIPTS_DIR / "init_admin_schema.sql",
    SCRIPTS_DIR / "init_transcript_history.sql",
]


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    for raw_line in sql.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("--"):
            continue
        buffer.append(raw_line)
        if line.endswith(";"):
            statement = "\n".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
    if buffer:
        trailing = "\n".join(buffer).strip()
        if trailing:
            statements.append(trailing)
    return statements


def _run_sql_file(engine: Engine, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    statements = _split_sql_statements(sql)
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def reset_database_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in DROP_TABLES:
            conn.execute(text(f"DROP TABLE IF EXISTS `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

    for sql_file in INIT_SQL_FILES:
        if not sql_file.exists():
            raise FileNotFoundError(f"Missing SQL file: {sql_file}")
        _run_sql_file(engine, sql_file)
