#!/usr/bin/env python3
"""Run a SQL migration file against the configured MySQL database."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import create_engine

from app.config import settings
from app.services.database_migrate import run_sql_migration


def resolve_database_url(explicit_url: str | None) -> str:
    url = (explicit_url or os.getenv("DATABASE_URL") or os.getenv("MYSQL_URL") or settings.resolved_database_url).strip()
    if not url:
        raise SystemExit(
            "DATABASE_URL or MYSQL_URL is required.\n"
            "Example:\n"
            '  $env:DATABASE_URL="mysql://user:pass@host:port/railway"; python scripts/run_migration.py scripts/migrate_transcriber_profile.sql'
        )
    if url.startswith("mysql://"):
        return url.replace("mysql://", "mysql+pymysql://", 1)
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a SQL migration file.")
    parser.add_argument("sql_file", nargs="?", default="scripts/migrate_transcriber_profile.sql")
    parser.add_argument("--database-url", help="MySQL URL (overrides env/.env)")
    args = parser.parse_args()

    sql_path = Path(args.sql_file)
    if not sql_path.is_absolute():
        sql_path = ROOT_DIR / sql_path

    engine = create_engine(resolve_database_url(args.database_url), pool_pre_ping=True)
    run_sql_migration(engine, sql_path)
    print(f"Migration complete: {sql_path.name}")


if __name__ == "__main__":
    main()
