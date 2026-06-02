from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TranscriptHistory(Base):
    __tablename__ = "transcript_history"
    __table_args__ = (UniqueConstraint("job_id", "version", name="uk_job_version"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    revision_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    editor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    r2_key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
