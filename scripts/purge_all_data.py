#!/usr/bin/env python3
"""Delete all application rows for a fresh test start."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import create_engine, text

from app.config import settings
from app.services.database_reset import purge_all_data


def resolve_database_url(explicit_url: str | None) -> str:
    url = (explicit_url or os.getenv("DATABASE_URL") or os.getenv("MYSQL_URL") or settings.resolved_database_url).strip()
    if not url:
        raise SystemExit(
            "DATABASE_URL or MYSQL_URL is required.\n"
            "Example:\n"
            '  $env:DATABASE_URL="mysql://user:pass@host:port/railway"; python scripts/purge_all_data.py --yes'
        )
    if url.startswith("mysql://"):
        return url.replace("mysql://", "mysql+pymysql://", 1)
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete all application data rows.")
    parser.add_argument("--database-url", help="MySQL URL (overrides env/.env)")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    database_url = resolve_database_url(args.database_url)
    if not args.yes:
        print("This will DELETE all jobs, transcribers, clients, and related rows.")
        answer = input("Type RESET to continue: ").strip()
        if answer != "RESET":
            raise SystemExit("Cancelled.")

    engine = create_engine(database_url, pool_pre_ping=True)
    with engine.connect() as conn:
        jobs = conn.execute(text("SELECT COUNT(*) FROM jobs")).scalar()
        transcribers = conn.execute(text("SELECT COUNT(*) FROM transcribers")).scalar()
        print(f"before jobs={jobs} transcribers={transcribers}")

    purge_all_data(engine)

    with engine.connect() as conn:
        jobs = conn.execute(text("SELECT COUNT(*) FROM jobs")).scalar()
        transcribers = conn.execute(text("SELECT COUNT(*) FROM transcribers")).scalar()
        clients = conn.execute(text("SELECT COUNT(*) FROM clients")).scalar()
        print(f"after jobs={jobs} transcribers={transcribers} clients={clients}")
    print("Purge complete.")


if __name__ == "__main__":
    main()
