import logging
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.admin_auth import require_admin_permission
from app.models.admin_models import AdminUser, Member
from app.routers.upload import (
    ALLOWED_EXTENSIONS,
    VoiceUploadCompleteRequest,
    VoiceUploadResponse,
    is_allowed_upload,
)
from app.services.admin_events import publish_admin_event
from app.services.admin_permissions import normalize_admin_role
from app.services.audio import remux_faststart, should_faststart
from app.services.job_store import create_job_record, find_job_by_filename, get_or_create_client_for_member
from app.services.member_auth import (
    get_member_by_id,
    get_member_by_phone,
    normalize_phone,
    register_or_login_member_with_phone,
    serialize_member,
)
from app.services.project_store import (
    ProjectAccessError,
    create_project_for_member,
    list_projects,
    resolve_upload_project,
    serialize_project_summary,
)
from app.services.r2 import (
    create_voice_upload_url,
    delete_object,
    ensure_filename_with_extension,
    get_object_metadata,
    upload_voice_bytes,
)

router = APIRouter(prefix="/api/admin/upload", tags=["admin-upload"])
logger = logging.getLogger(__name__)

JobsAdminAuth = Annotated[AdminUser, Depends(require_admin_permission("menu:jobs"))]


def _require_upload_operator(admin: AdminUser) -> AdminUser:
    if normalize_admin_role(admin.role) == "viewer":
        raise HTTPException(status_code=403, detail="조회전용 계정은 대리 업로드를 할 수 없습니다.")
    return admin


def _proxy_note(admin: AdminUser) -> str:
    return f"관리자 대리 업로드 ({admin.name})"


def _load_member(db: Session, member_id: int) -> Member:
    member = get_member_by_id(db, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")
    if not member.is_active:
        raise HTTPException(status_code=400, detail="비활성 회원에는 파일을 업로드할 수 없습니다.")
    return member


class AdminPresignRequest(BaseModel):
    member_id: int = Field(..., ge=1)
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream")
    project_id: str | None = None
    project_title: str | None = Field(default=None, max_length=200)


class AdminPresignResponse(BaseModel):
    job_id: str
    object_key: str
    upload_url: str
    expires_in: int
    bucket: str


class AdminVoiceCompleteRequest(VoiceUploadCompleteRequest):
    member_id: int = Field(..., ge=1)
    project_title: str | None = Field(default=None, max_length=200)


class AdminCreateProjectRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    memo: str | None = Field(default=None, max_length=500)


class ResolveMemberRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=30)
    name: str | None = Field(default=None, max_length=100)
    ensure: bool = True


@router.post("/resolve-member")
def resolve_member_for_upload(
    body: ResolveMemberRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
) -> dict:
    _require_upload_operator(admin)
    normalized = normalize_phone(body.phone)
    if not normalized or len(normalized) < 10:
        raise HTTPException(status_code=400, detail="전화번호를 확인해 주세요.")

    member = get_member_by_phone(db, normalized)
    created = False
    if member is None:
        if not body.ensure:
            raise HTTPException(status_code=404, detail="해당 전화의 회원이 없습니다.")
        try:
            member, created = register_or_login_member_with_phone(
                db,
                phone=normalized,
                name=(body.name or "").strip() or f"전화고객-{normalized[-4:]}",
            )
        except Exception as exc:
            logger.exception("admin resolve-member register failed phone=%s", normalized)
            raise HTTPException(status_code=400, detail=str(exc) or "회원 연결에 실패했습니다.") from exc

    get_or_create_client_for_member(db, member)
    return {
        "member": {**serialize_member(member), "is_active": bool(member.is_active)},
        "member_created": created,
    }


@router.get("/members/{member_id}/projects")
def list_member_projects_for_upload(
    member_id: int,
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
) -> dict:
    _require_upload_operator(admin)
    member = _load_member(db, member_id)
    projects = list_projects(db, member=member, include_files=False)
    return {"projects": projects, "member": serialize_member(member)}


@router.post("/members/{member_id}/projects")
def create_member_project_for_upload(
    member_id: int,
    body: AdminCreateProjectRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
) -> dict:
    _require_upload_operator(admin)
    member = _load_member(db, member_id)
    project = create_project_for_member(
        db,
        member,
        title=body.title.strip(),
        memo=(body.memo or "").strip() or None,
    )
    return {"project": serialize_project_summary(db, project, include_files=False)}


@router.post("/presign", response_model=AdminPresignResponse)
def admin_presign_upload(
    body: AdminPresignRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> AdminPresignResponse:
    _require_upload_operator(admin)
    started = perf_counter()
    member = _load_member(db, body.member_id)
    content_type = body.content_type.split(";")[0].strip().lower()
    if not is_allowed_upload(content_type, body.filename):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")

    safe_name = ensure_filename_with_extension(body.filename, content_type)
    existing_job = find_job_by_filename(db, safe_name)
    if existing_job is not None:
        raise HTTPException(status_code=409, detail=f"이미 업로드된 파일입니다: {safe_name}")

    client = get_or_create_client_for_member(db, member)
    if body.project_id:
        try:
            resolve_upload_project(
                db,
                member=member,
                client=client,
                project_id=body.project_id,
                filename=safe_name,
                project_title=body.project_title,
            )
        except ProjectAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = create_voice_upload_url(body.filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("admin_upload_presign_error request_id=%s filename=%s", request_id, body.filename)
        raise HTTPException(status_code=502, detail=f"R2 presign failed: {exc}") from exc

    logger.info(
        "admin_upload_presign_success request_id=%s admin_id=%s member_id=%s job_id=%s elapsed_ms=%s",
        request_id,
        admin.id,
        member.id,
        result["job_id"],
        round((perf_counter() - started) * 1000, 1),
    )
    return AdminPresignResponse(**result)


@router.post("/voice/complete", response_model=VoiceUploadResponse)
def admin_complete_voice_upload(
    body: AdminVoiceCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> VoiceUploadResponse:
    _require_upload_operator(admin)
    started = perf_counter()
    member = _load_member(db, body.member_id)
    content_type = body.content_type.split(";")[0].strip().lower()
    safe_name = ensure_filename_with_extension(body.filename, content_type)
    if not is_allowed_upload(content_type, safe_name):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")

    expected_prefix = f"{settings.r2_voice_prefix}{body.job_id}/"
    if not body.object_key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="업로드 객체 경로가 올바르지 않습니다.")

    existing_job = find_job_by_filename(db, safe_name)
    if existing_job is not None:
        try:
            delete_object(body.object_key)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail=f"이미 업로드된 파일입니다: {safe_name}")

    try:
        metadata = get_object_metadata(body.object_key)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"업로드된 파일을 확인할 수 없습니다: {exc}") from exc
    if int(metadata.get("size") or 0) <= 0:
        raise HTTPException(status_code=400, detail="업로드된 파일이 비어 있습니다.")

    client = get_or_create_client_for_member(db, member)
    try:
        project = resolve_upload_project(
            db,
            member=member,
            client=client,
            project_id=body.project_id,
            filename=safe_name,
            project_title=body.project_title,
        )
    except ProjectAccessError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    note = _proxy_note(admin)
    job = create_job_record(
        db,
        job_id=body.job_id,
        filename=safe_name,
        content_type=content_type,
        voice_key=body.object_key,
        member=member,
        project_id=project.project_id,
        selected_segments=body.selected_segments if isinstance(body.selected_segments, list) else None,
        duration_seconds=int(body.billable_duration_ms // 1000)
        if body.billable_duration_ms and body.billable_duration_ms > 0
        else None,
        internal_note=note,
        change_note=note,
    )
    publish_admin_event(
        "job_created",
        {
            "job_id": job.job_id,
            "status": job.status,
            "project_id": job.project_id,
            "proxy_admin_id": admin.id,
        },
    )
    logger.info(
        "admin_upload_complete_success request_id=%s admin_id=%s member_id=%s job_id=%s elapsed_ms=%s",
        request_id,
        admin.id,
        member.id,
        job.job_id,
        round((perf_counter() - started) * 1000, 1),
    )
    return VoiceUploadResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        object_key=body.object_key,
        bucket=settings.r2_bucket_name,
        status="UPLOADED",
    )


@router.post("/voice", response_model=VoiceUploadResponse)
async def admin_upload_voice(
    db: Annotated[Session, Depends(get_db)],
    admin: JobsAdminAuth,
    member_id: Annotated[int, Form()],
    file: UploadFile = File(...),
    project_id: Annotated[str | None, Form()] = None,
    project_title: Annotated[str | None, Form()] = None,
    selected_segments_json: Annotated[str | None, Form()] = None,
    billable_duration_ms: Annotated[int | None, Form()] = None,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> VoiceUploadResponse:
    import json

    _require_upload_operator(admin)
    started = perf_counter()
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    member = _load_member(db, member_id)
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if not is_allowed_upload(content_type, file.filename):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    safe_name = ensure_filename_with_extension(file.filename, content_type)
    existing_job = find_job_by_filename(db, safe_name)
    if existing_job is not None:
        raise HTTPException(status_code=409, detail=f"이미 업로드된 파일입니다: {safe_name}")
    if should_faststart(content, safe_name):
        remuxed = remux_faststart(content)
        if remuxed:
            content = remuxed

    try:
        upload_result = upload_voice_bytes(content, file.filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("admin_upload_voice_r2_error request_id=%s", request_id)
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {exc}") from exc

    client = get_or_create_client_for_member(db, member)
    try:
        project = resolve_upload_project(
            db,
            member=member,
            client=client,
            project_id=project_id,
            filename=safe_name,
            project_title=project_title,
        )
    except ProjectAccessError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    selected_segments: list[dict] | None = None
    if selected_segments_json:
        try:
            parsed = json.loads(selected_segments_json)
            if isinstance(parsed, list):
                selected_segments = parsed
        except Exception:
            selected_segments = None

    note = _proxy_note(admin)
    job = create_job_record(
        db,
        job_id=upload_result["job_id"],
        filename=upload_result.get("filename", file.filename),
        content_type=content_type,
        voice_key=upload_result["object_key"],
        member=member,
        project_id=project.project_id,
        selected_segments=selected_segments,
        duration_seconds=int(billable_duration_ms // 1000) if billable_duration_ms and billable_duration_ms > 0 else None,
        internal_note=note,
        change_note=note,
    )
    publish_admin_event(
        "job_created",
        {
            "job_id": job.job_id,
            "status": job.status,
            "project_id": job.project_id,
            "proxy_admin_id": admin.id,
        },
    )
    logger.info(
        "admin_upload_voice_success request_id=%s admin_id=%s member_id=%s job_id=%s elapsed_ms=%s",
        request_id,
        admin.id,
        member.id,
        job.job_id,
        round((perf_counter() - started) * 1000, 1),
    )
    return VoiceUploadResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        object_key=upload_result["object_key"],
        bucket=upload_result["bucket"],
        status="UPLOADED",
    )


@router.get("/allowed-extensions")
def admin_upload_allowed_extensions(admin: JobsAdminAuth) -> dict:
    _require_upload_operator(admin)
    return {"extensions": sorted(ALLOWED_EXTENSIONS)}
