from collections.abc import Generator
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

engine = None
SessionLocal: Optional[sessionmaker[Session]] = None


class Base(DeclarativeBase):
    pass


def init_db(database_url: str) -> None:
    global engine, SessionLocal
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        pool_recycle=3600,
    )
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def create_tables() -> None:
    if engine is None:
        return
    from app.models import admin_models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def get_engine():
    return engine


def get_db() -> Generator[Session, None, None]:
    if SessionLocal is None:
        raise RuntimeError("Database is not configured")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
