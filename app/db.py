import logging
from collections.abc import Generator
from threading import Lock
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

engine = None
SessionLocal: Optional[sessionmaker[Session]] = None
_init_lock = Lock()
_migrations_done = False


def _run_startup_migrations_once() -> None:
    global _migrations_done
    if _migrations_done or engine is None:
        return
    with _init_lock:
        if _migrations_done or engine is None:
            return
        from app.services.database_migrate import ensure_expense_tables_on_engine, run_startup_migrations

        try:
            run_startup_migrations(engine)
            ensure_expense_tables_on_engine(engine)
            _migrations_done = True
        except Exception:
            logger.exception("Startup migrations failed")


class Base(DeclarativeBase):
    pass


def init_db(database_url: str) -> None:
    global engine, SessionLocal
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        pool_recycle=3600,
        connect_args={"connect_timeout": 10},
    )
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def create_tables() -> None:
    if engine is None:
        return
    from app.models import admin_models  # noqa: F401

    try:
        Base.metadata.create_all(bind=engine)
    except OperationalError as exc:
        # Existing Railway/MySQL schemas often use BIGINT ids while create_all may emit INTEGER FKs.
        logger.warning("Skipping metadata create_all; startup SQL migrations will apply schema: %s", exc)


def ensure_db_initialized() -> None:
    global engine, SessionLocal
    if SessionLocal is not None:
        return
    if not settings.database_configured:
        raise RuntimeError("Database is not configured")
    with _init_lock:
        if SessionLocal is not None:
            return
        init_db(settings.resolved_database_url)
        create_tables()
        _run_startup_migrations_once()


def get_engine():
    if SessionLocal is None:
        return None
    return engine


def get_db() -> Generator[Session, None, None]:
    try:
        ensure_db_initialized()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="데이터베이스가 준비되지 않았습니다.") from exc
    if SessionLocal is None:
        raise HTTPException(status_code=503, detail="데이터베이스가 준비되지 않았습니다.")
    try:
        db = SessionLocal()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="데이터베이스 연결에 실패했습니다.") from exc
    try:
        yield db
    finally:
        db.close()
