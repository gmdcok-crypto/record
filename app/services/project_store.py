from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_models import Client, Job, Member, Project, Transcriber
from app.services.id_factory import generate_project_id
from app.services.job_store import (
    DEFAULT_CLIENT_NAME,
    _display_status_for_job,
    _visible_transcriber_for_job,
    assign_job,
    get_or_create_client_for_member,
    infer_title,
    inquiry_summary_for_job,
)

FINAL_JOB_STATUSES = frozenset({"final_done", "pdf_sent"})
WAITING_JOB_STATUSES = frozenset({"uploaded", "waiting_assignment"})
WORKING_JOB_STATUSES = frozenset({"assigned", "working", "client_editing", "review_waiting"})


class ProjectAccessError(ValueError):
    pass


def compute_project_status(display_statuses: list[str]) -> str:
    if not display_statuses:
        return "empty"
    if all(status in FINAL_JOB_STATUSES for status in display_statuses):
        return "completed"
    if any(status in WAITING_JOB_STATUSES for status in display_statuses):
        return "waiting_assignment"
    if any(status in WORKING_JOB_STATUSES for status in display_statuses):
        return "working"
    if all(status in FINAL_JOB_STATUSES | {"first_done"} for status in display_statuses):
        return "client_review"
    return "working"


def _project_due_default() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)


def create_project(
    db: Session,
    *,
    client: Client,
    title: str,
    due_at: datetime | None = None,
    memo: str | None = None,
    priority: str = "normal",
) -> Project:
    project = Project(
        project_id=generate_project_id(),
        client_id=client.id,
        title=title.strip() or "새 녹취 프로젝트",
        due_at=due_at or _project_due_default(),
        memo=memo,
        priority=priority,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def create_project_for_member(
    db: Session,
    member: Member,
    *,
    title: str,
    due_at: datetime | None = None,
    memo: str | None = None,
    priority: str = "normal",
) -> Project:
    client = get_or_create_client_for_member(db, member)
    return create_project(
        db,
        client=client,
        title=title,
        due_at=due_at,
        memo=memo,
        priority=priority,
    )


def create_project_for_upload(
    db: Session,
    *,
    client: Client,
    filename: str,
    title: str | None = None,
) -> Project:
    return create_project(
        db,
        client=client,
        title=(title or infer_title(filename)).strip() or "새 녹취 프로젝트",
    )


def get_project_record(db: Session, project_id: str) -> Project | None:
    try:
        return db.scalar(select(Project).where(Project.project_id == project_id))
    except (OperationalError, ProgrammingError) as exc:
        message = str(exc).lower()
        if "pdf_delivery_mode" not in message:
            raise
        row = db.execute(
            select(
                Project.project_id,
                Project.client_id,
                Project.title,
                Project.due_at,
                Project.memo,
                Project.priority,
                Project.created_at,
                Project.updated_at,
            ).where(Project.project_id == project_id)
        ).mappings().first()
        if row is None:
            return None
        project = Project(
            project_id=row["project_id"],
            client_id=row["client_id"],
            title=row["title"],
            due_at=row["due_at"],
            memo=row["memo"],
            priority=row["priority"],
        )
        project.created_at = row["created_at"]
        project.updated_at = row["updated_at"]
        project.pdf_delivery_mode = "individual"
        return project


def list_project_jobs(db: Session, project_id: str) -> list[Job]:
    return list(
        db.scalars(
            select(Job).where(Job.project_id == project_id).order_by(Job.uploaded_at.asc(), Job.job_id.asc())
        ).all()
    )


def serialize_project_file(db: Session, job: Job) -> dict:
    visible_transcriber = _visible_transcriber_for_job(db, job)
    display_status = _display_status_for_job(db, job)
    inquiry = inquiry_summary_for_job(db, job.job_id)
    return {
        "job_id": job.job_id,
        "title": job.title,
        "filename": job.original_filename,
        "status": display_status,
        "workflow_status": job.status,
        "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
        "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
        "due_at": job.due_at.isoformat() if job.due_at else None,
        "assignee": visible_transcriber.name if visible_transcriber else None,
        "assignee_code": visible_transcriber.transcriber_code if visible_transcriber else None,
        "pdf_ready": job.status == "pdf_sent",
        "has_inquiry": inquiry["has_inquiry"],
        "client_inquiry_status": inquiry["client_inquiry_status"],
        "transcriber_inquiry_status": inquiry["transcriber_inquiry_status"],
        "admin_inquiry_badges": inquiry["admin_inquiry_badges"],
    }


def serialize_project_summary(db: Session, project: Project, *, include_files: bool = False) -> dict:
    jobs = list_project_jobs(db, project.project_id)
    display_statuses = [_display_status_for_job(db, job) for job in jobs]
    completed_count = sum(1 for status in display_statuses if status in FINAL_JOB_STATUSES)
    pdf_delivery_mode = getattr(project, "pdf_delivery_mode", "individual") or "individual"
    assignees = {
        transcriber.name
        for job in jobs
        if (transcriber := _visible_transcriber_for_job(db, job)) is not None
    }
    assignee_codes = {
        transcriber.transcriber_code
        for job in jobs
        if (transcriber := _visible_transcriber_for_job(db, job)) is not None
    }

    payload = {
        "project_id": project.project_id,
        "title": project.title,
        "client": {
            "id": project.client.id if project.client else project.client_id,
            "name": project.client.name if project.client else DEFAULT_CLIENT_NAME,
        },
        "due_at": project.due_at.isoformat() if project.due_at else None,
        "memo": project.memo,
        "priority": project.priority,
        "pdf_delivery_mode": pdf_delivery_mode,
        "status": compute_project_status(display_statuses),
        "file_count": len(jobs),
        "completed_count": completed_count,
        "assignee": next(iter(assignees)) if len(assignees) == 1 else ("-" if not assignees else "복수"),
        "assignee_code": next(iter(assignee_codes)) if len(assignee_codes) == 1 else None,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }
    if include_files:
        payload["files"] = [serialize_project_file(db, job) for job in jobs]
    return payload


def list_projects(
    db: Session,
    *,
    member: Member | None = None,
    include_files: bool = False,
) -> list[dict]:
    stmt = select(Project).order_by(Project.updated_at.desc())
    if member is not None:
        client = get_or_create_client_for_member(db, member)
        stmt = stmt.where(Project.client_id == client.id)
    projects = db.scalars(stmt).all()
    return [serialize_project_summary(db, project, include_files=include_files) for project in projects]


def ensure_member_project_access(db: Session, project: Project, member: Member | None) -> None:
    if member is None:
        return
    client = get_or_create_client_for_member(db, member)
    if project.client_id != client.id:
        raise ProjectAccessError("이 프로젝트에 접근할 수 없습니다.")


def resolve_upload_project(
    db: Session,
    *,
    member: Member | None,
    client: Client,
    project_id: str | None,
    filename: str,
    project_title: str | None = None,
) -> Project:
    if project_id:
        project = get_project_record(db, project_id)
        if project is None:
            raise ProjectAccessError("프로젝트를 찾을 수 없습니다.")
        if project.client_id != client.id:
            raise ProjectAccessError("이 프로젝트에 파일을 추가할 수 없습니다.")
        ensure_member_project_access(db, project, member)
        return project

    return create_project_for_upload(db, client=client, filename=filename, title=project_title)


def list_transcriber_projects(db: Session, transcriber_code: str) -> list[dict]:
    from app.models.admin_models import Transcriber
    from app.services.job_store import (
        DEFAULT_CLIENT_NAME,
        TRANSCRIBER_VISIBLE_JOB_STATUSES,
        _display_status_for_job,
        _has_manual_assignment,
    )

    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        return []

    rows = db.scalars(
        select(Job)
        .where(Job.assigned_transcriber_id == transcriber.id, Job.status.in_(TRANSCRIBER_VISIBLE_JOB_STATUSES))
        .order_by(Job.updated_at.desc())
    ).all()

    assigned_jobs = [job for job in rows if _has_manual_assignment(db, job.job_id)]
    grouped: dict[str, list[Job]] = {}
    standalone: list[Job] = []

    for job in assigned_jobs:
        if job.project_id:
            grouped.setdefault(job.project_id, []).append(job)
        else:
            standalone.append(job)

    result: list[dict] = []
    for project_id, project_jobs in grouped.items():
        project = get_project_record(db, project_id)
        if project is None:
            continue
        display_statuses = [_display_status_for_job(db, job) for job in project_jobs]
        result.append(
            {
                "project_id": project.project_id,
                "title": project.title,
                "client": {
                    "id": project.client.id if project.client else project.client_id,
                    "name": project.client.name if project.client else DEFAULT_CLIENT_NAME,
                },
                "due_at": project.due_at.isoformat() if project.due_at else None,
                "status": compute_project_status(display_statuses),
                "file_count": len(project_jobs),
                "completed_count": sum(1 for status in display_statuses if status in FINAL_JOB_STATUSES),
                "files": [serialize_project_file(db, job) for job in project_jobs],
            }
        )

    for job in standalone:
        display_status = _display_status_for_job(db, job)
        result.append(
            {
                "project_id": None,
                "title": job.title,
                "client": {
                    "id": job.client.id if job.client else None,
                    "name": job.client.name if job.client else DEFAULT_CLIENT_NAME,
                },
                "due_at": job.due_at.isoformat() if job.due_at else None,
                "status": compute_project_status([display_status]),
                "file_count": 1,
                "completed_count": 1 if display_status in FINAL_JOB_STATUSES else 0,
                "files": [serialize_project_file(db, job)],
            }
        )

    result.sort(key=lambda item: item.get("due_at") or "", reverse=True)
    return result


def assign_project_jobs(
    db: Session,
    project: Project,
    *,
    transcriber_code: str,
    job_ids: list[str] | None = None,
    note: str | None = None,
    reassign: bool = False,
) -> list[str]:
    transcriber = db.scalar(select(Transcriber).where(Transcriber.transcriber_code == transcriber_code))
    if transcriber is None:
        raise ValueError("Transcriber not found")

    jobs = list_project_jobs(db, project.project_id)
    if job_ids is not None:
        allowed = set(job_ids)
        jobs = [job for job in jobs if job.job_id in allowed]

    eligible: list[Job] = []
    for job in jobs:
        display_status = _display_status_for_job(db, job)
        if display_status in FINAL_JOB_STATUSES:
            continue
        if reassign:
            eligible.append(job)
        elif display_status in WAITING_JOB_STATUSES | {"review_waiting"}:
            eligible.append(job)

    if not eligible:
        raise ValueError("배정할 파일이 없습니다.")

    assigned: list[str] = []
    assignment_note = note or ("관리자 배정 변경" if reassign else "관리자 프로젝트 일괄 배정")
    for job in eligible:
        if job.assigned_transcriber_id == transcriber.id:
            continue
        assign_job(db, job, transcriber_code=transcriber_code, note=assignment_note)
        assigned.append(job.job_id)

    if not assigned:
        raise ValueError("변경할 배정이 없습니다. 선택한 속기사에게 이미 배정된 파일입니다.")

    return assigned
