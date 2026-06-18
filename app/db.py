from collections.abc import Generator
from threading import Lock
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = None
SessionLocal: Optional[sessionmaker[Session]] = None
_init_lock = Lock()


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

    Base.metadata.create_all(bind=engine)


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
