from datetime import datetime, date

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    client_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    billing_policy: Mapped[str | None] = mapped_column(String(100), nullable=True)
    default_unit_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    default_turnaround_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="operator")
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[int] = mapped_column(default=1)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Transcriber(Base):
    __tablename__ = "transcribers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    transcriber_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    login_id: Mapped[str | None] = mapped_column(String(8), unique=True, nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending_signup", index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    specialty: Mapped[str | None] = mapped_column(String(200), nullable=True)
    unit_price_type: Mapped[str] = mapped_column(String(20), nullable=False, default="per_minute")
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    monthly_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_load: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quality_score: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_holder: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resident_id_masked: Mapped[str | None] = mapped_column(String(30), nullable=True)
    license_r2_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    license_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Project(Base):
    __tablename__ = "projects"

    project_id: Mapped[str] = mapped_column(String(12), primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    pdf_delivery_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="individual")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    client: Mapped[Client | None] = relationship()
    jobs: Mapped[list["Job"]] = relationship(back_populates="project")


class Job(Base):
    __tablename__ = "jobs"

    job_id: Mapped[str] = mapped_column(String(12), primary_key=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.project_id"), nullable=True, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_language: Mapped[str | None] = mapped_column(String(20), nullable=True, default="ko")
    requested_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="uploaded", index=True)
    assigned_transcriber_id: Mapped[int | None] = mapped_column(ForeignKey("transcribers.id"), nullable=True, index=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    assigned_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    r2_voice_key: Mapped[str] = mapped_column(String(255), nullable=False)
    r2_transcript_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    final_pdf_r2_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    final_pdf_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    selected_segments_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    transcript_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    speaker_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sales_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    extra_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    final_bill_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    settlement_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    payment_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unpaid", index=True)
    settlement_status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting", index=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    final_pdf_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    client: Mapped[Client | None] = relationship()
    project: Mapped[Project | None] = relationship(back_populates="jobs")
    transcriber: Mapped[Transcriber | None] = relationship()


class JobAssignment(Base):
    __tablename__ = "job_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    from_transcriber_id: Mapped[int | None] = mapped_column(ForeignKey("transcribers.id"), nullable=True)
    to_transcriber_id: Mapped[int | None] = mapped_column(ForeignKey("transcribers.id"), nullable=True, index=True)
    assigned_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    assignment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class JobStatusLog(Base):
    __tablename__ = "job_status_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    changed_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    changed_by_transcriber_id: Mapped[int | None] = mapped_column(ForeignKey("transcribers.id"), nullable=True)
    change_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class TranscriptChangeLog(Base):
    __tablename__ = "transcript_change_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    editor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    editor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    save_kind: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    changes_json: Mapped[list] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class TranscriptShare(Base):
    __tablename__ = "transcript_shares"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(96), unique=True, nullable=False, index=True)
    created_by_member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    allow_audio: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    allow_pdf_download: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class JobInquiryMessage(Base):
    __tablename__ = "job_inquiry_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    thread_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    sender_role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    sender_name: Mapped[str] = mapped_column(String(100), nullable=False)
    sender_member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True, index=True)
    sender_transcriber_id: Mapped[int | None] = mapped_column(ForeignKey("transcribers.id"), nullable=True, index=True)
    sender_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class MemberPushSubscription(Base):
    __tablename__ = "member_push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    p256dh_key: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AdminPushSubscription(Base):
    __tablename__ = "admin_push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    admin_user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    p256dh_key: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    base_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    extra_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    vat_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    invoice_status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class InvoicePayment(Base):
    __tablename__ = "invoice_payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False, default="bank_transfer")
    payer_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reference_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    settlement_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    transcriber_id: Mapped[int] = mapped_column(ForeignKey("transcribers.id"), nullable=False, index=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_jobs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gross_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    adjustment_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    final_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    confirmed_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class SettlementItem(Base):
    __tablename__ = "settlement_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    settlement_id: Mapped[int] = mapped_column(ForeignKey("settlements.id"), nullable=False, index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), nullable=False, index=True)
    transcriber_id: Mapped[int] = mapped_column(ForeignKey("transcribers.id"), nullable=False, index=True)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    quantity_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    adjustment_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    final_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TranscriberGradeRate(Base):
    __tablename__ = "transcriber_grade_rates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    per_minute_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
