#!/usr/bin/env python3
"""Ensure expense_categories and expense_records exist. Run on Railway API service."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.db import ensure_db_initialized, get_engine
from app.services.database_migrate import ensure_expense_tables_on_engine


def main() -> None:
    try:
        ensure_db_initialized()
        engine = get_engine()
        if engine is None:
            print("Database engine is not available. Check DATABASE_URL on the API service.", file=sys.stderr)
            return
        ensure_expense_tables_on_engine(engine)
        print("expense tables ensured")
    except Exception as exc:
        print(f"expense tables ensure failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
