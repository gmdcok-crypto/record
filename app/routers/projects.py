from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.member_auth import get_optional_current_member
from app.models.admin_models import Member
from app.services.admin_events import publish_admin_event
from app.services.project_store import (
    ProjectAccessError,
    assign_project_jobs,
    create_project_for_member,
    ensure_member_project_access,
    get_project_record,
    list_project_jobs,
    list_projects,
    serialize_project_file,
    serialize_project_summary,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    memo: str | None = None
    priority: str = "normal"
    due_at: datetime | None = None


class ProjectAssignRequest(BaseModel):
    transcriber_code: str
    job_ids: list[str] | None = None
    note: str | None = None
    reassign: bool = False


@router.get("")
def get_projects(
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
    include_files: bool = Query(default=False),
) -> dict:
    return {"projects": list_projects(db, member=member, include_files=include_files)}


@router.post("")
def create_project(
    body: ProjectCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    if member is None:
        raise HTTPException(status_code=401, detail="회원 로그인이 필요합니다.")

    project = create_project_for_member(
        db,
        member,
        title=body.title,
        due_at=body.due_at,
        memo=body.memo,
        priority=body.priority,
    )
    publish_admin_event("project_created", {"project_id": project.project_id})
    return {"project": serialize_project_summary(db, project, include_files=True)}


@router.get("/{project_id}")
def get_project(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    try:
        ensure_member_project_access(db, project, member)
    except ProjectAccessError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return {"project": serialize_project_summary(db, project, include_files=True)}


@router.get("/{project_id}/files")
def get_project_files(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
) -> dict:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    try:
        ensure_member_project_access(db, project, member)
    except ProjectAccessError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    jobs = list_project_jobs(db, project_id)
    return {
        "project_id": project_id,
        "files": [serialize_project_file(db, job) for job in jobs],
    }


@router.post("/{project_id}/assign")
def assign_project(
    project_id: str,
    body: ProjectAssignRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    project = get_project_record(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    try:
        assigned_job_ids = assign_project_jobs(
            db,
            project,
            transcriber_code=body.transcriber_code,
            job_ids=body.job_ids,
            note=body.note,
            reassign=body.reassign,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    for job_id in assigned_job_ids:
        publish_admin_event("job_assigned", {"job_id": job_id, "project_id": project_id})

    return {
        "project_id": project_id,
        "assigned_job_ids": assigned_job_ids,
        "project": serialize_project_summary(db, project, include_files=True),
    }
