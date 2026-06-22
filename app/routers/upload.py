import logging
from time import perf_counter
from pathlib import Path

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.member_auth import get_optional_current_member
from app.models.admin_models import Member
from app.services.audio import remux_faststart, should_faststart
from app.services.admin_events import publish_admin_event
from app.services.job_store import create_job_record, ensure_seed_data, find_job_by_filename, get_or_create_client_for_member
from app.services.project_store import ProjectAccessError, resolve_upload_project
from app.services.r2 import create_voice_upload_url, delete_object, ensure_filename_with_extension, get_object_metadata, upload_voice_bytes

router = APIRouter(prefix="/api/upload", tags=["upload"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4", ".aac", ".wma"}

ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/x-aac",
    "audio/flac",
    "audio/x-flac",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/octet-stream",
}


def is_allowed_upload(content_type: str, filename: str) -> bool:
    ct = content_type.split(";")[0].strip().lower()
    if ct in ALLOWED_CONTENT_TYPES or ct.startswith("audio/"):
        return True
    if ct in {"video/mp4", "video/webm", "video/quicktime"}:
        return True
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_EXTENSIONS


class PresignRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream")
    project_id: str | None = None
    selected_segments: list[dict] | None = None
    billable_duration_ms: int | None = None


class PresignResponse(BaseModel):
    job_id: str
    object_key: str
    upload_url: str
    expires_in: int
    bucket: str


class VoiceUploadResponse(BaseModel):
    job_id: str
    project_id: str | None = None
    object_key: str
    bucket: str
    status: str
    transcript_text: str | None = None
    transcript_key: str | None = None
    transcript_json: dict | None = None
    error: str | None = None


class VoiceUploadCompleteRequest(BaseModel):
    job_id: str = Field(..., min_length=4, max_length=32)
    object_key: str = Field(..., min_length=1, max_length=255)
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream")
    project_id: str | None = None
    selected_segments: list[dict] | None = None
    billable_duration_ms: int | None = None


@router.post("/voice", response_model=VoiceUploadResponse)
async def upload_voice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
    project_id: Annotated[str | None, Form()] = None,
    selected_segments_json: Annotated[str | None, Form()] = None,
    billable_duration_ms: Annotated[int | None, Form()] = None,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> VoiceUploadResponse:
    import json

    started = perf_counter()
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    logger.info(
        "client_upload_backend_start request_id=%s filename=%s content_type=%s project_id=%s member_id=%s",
        request_id,
        file.filename,
        content_type,
        project_id,
        member.id if member else None,
    )
    if not is_allowed_upload(content_type, file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

    content = await file.read()
    logger.info(
        "client_upload_backend_read request_id=%s filename=%s bytes=%s elapsed_ms=%s",
        request_id,
        file.filename,
        len(content),
        round((perf_counter() - started) * 1000, 1),
    )
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
        logger.exception("client_upload_backend_r2_config_error request_id=%s filename=%s", request_id, file.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("client_upload_backend_r2_error request_id=%s filename=%s", request_id, file.filename)
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {exc}") from exc

    response = VoiceUploadResponse(
        job_id=upload_result["job_id"],
        object_key=upload_result["object_key"],
        bucket=upload_result["bucket"],
        status="UPLOADED",
    )

    if member is not None:
        client = get_or_create_client_for_member(db, member)
    else:
        client = ensure_seed_data(db)

    resolved_project_id: str | None = None
    selected_segments: list[dict] | None = None
    if selected_segments_json:
        try:
            parsed = json.loads(selected_segments_json)
            if isinstance(parsed, list):
                selected_segments = parsed
        except Exception:
            selected_segments = None
    if member is not None or project_id:
        if member is None:
            raise HTTPException(status_code=401, detail="프로젝트 업로드는 회원 로그인이 필요합니다.")
        try:
            project = resolve_upload_project(
                db,
                member=member,
                client=client,
                project_id=project_id,
                filename=safe_name,
            )
            resolved_project_id = project.project_id
        except ProjectAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = create_job_record(
        db,
        job_id=upload_result["job_id"],
        filename=upload_result.get("filename", file.filename),
        content_type=content_type,
        voice_key=upload_result["object_key"],
        member=member,
        project_id=resolved_project_id,
        selected_segments=selected_segments,
        duration_seconds=int(billable_duration_ms // 1000) if billable_duration_ms and billable_duration_ms > 0 else None,
    )
    publish_admin_event(
        "job_created",
        {"job_id": job.job_id, "status": job.status, "project_id": job.project_id},
    )

    response.project_id = job.project_id
    logger.info(
        "client_upload_backend_success request_id=%s job_id=%s object_key=%s project_id=%s elapsed_ms=%s",
        request_id,
        job.job_id,
        upload_result["object_key"],
        job.project_id,
        round((perf_counter() - started) * 1000, 1),
    )
    return response


@router.post("/presign", response_model=PresignResponse)
def presign_upload(
    body: PresignRequest,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> PresignResponse:
    started = perf_counter()
    content_type = body.content_type.split(";")[0].strip().lower()
    logger.info(
        "client_upload_presign_start request_id=%s filename=%s content_type=%s project_id=%s member_id=%s",
        request_id,
        body.filename,
        content_type,
        body.project_id,
        member.id if member else None,
    )
    if not is_allowed_upload(content_type, body.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

    safe_name = ensure_filename_with_extension(body.filename, content_type)
    existing_job = find_job_by_filename(db, safe_name)
    if existing_job is not None:
        raise HTTPException(status_code=409, detail=f"이미 업로드된 파일입니다: {safe_name}")
    if body.project_id:
        if member is None:
            raise HTTPException(status_code=401, detail="프로젝트 업로드는 회원 로그인이 필요합니다.")
        client = get_or_create_client_for_member(db, member)
        try:
            resolve_upload_project(
                db,
                member=member,
                client=client,
                project_id=body.project_id,
                filename=safe_name,
            )
        except ProjectAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = create_voice_upload_url(body.filename, content_type)
    except ValueError as exc:
        logger.exception("client_upload_presign_config_error request_id=%s filename=%s", request_id, body.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("client_upload_presign_error request_id=%s filename=%s", request_id, body.filename)
        raise HTTPException(status_code=502, detail=f"R2 presign failed: {exc}") from exc

    logger.info(
        "client_upload_presign_success request_id=%s job_id=%s object_key=%s elapsed_ms=%s",
        request_id,
        result["job_id"],
        result["object_key"],
        round((perf_counter() - started) * 1000, 1),
    )
    return PresignResponse(**result)


@router.post("/voice/complete", response_model=VoiceUploadResponse)
def complete_voice_upload(
    body: VoiceUploadCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
    request_id: Annotated[str | None, Header(alias="X-Upload-Request-Id")] = None,
) -> VoiceUploadResponse:
    started = perf_counter()
    content_type = body.content_type.split(";")[0].strip().lower()
    logger.info(
        "client_upload_complete_start request_id=%s job_id=%s object_key=%s filename=%s project_id=%s member_id=%s",
        request_id,
        body.job_id,
        body.object_key,
        body.filename,
        body.project_id,
        member.id if member else None,
    )
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
        logger.exception(
            "client_upload_complete_metadata_error request_id=%s job_id=%s object_key=%s",
            request_id,
            body.job_id,
            body.object_key,
        )
        raise HTTPException(status_code=400, detail=f"업로드된 파일을 확인할 수 없습니다: {exc}") from exc
    if int(metadata.get("size") or 0) <= 0:
        raise HTTPException(status_code=400, detail="업로드된 파일이 비어 있습니다.")

    if member is not None:
        client = get_or_create_client_for_member(db, member)
    else:
        client = ensure_seed_data(db)

    resolved_project_id: str | None = None
    if member is not None or body.project_id:
        if member is None:
            raise HTTPException(status_code=401, detail="프로젝트 업로드는 회원 로그인이 필요합니다.")
        try:
            project = resolve_upload_project(
                db,
                member=member,
                client=client,
                project_id=body.project_id,
                filename=safe_name,
            )
            resolved_project_id = project.project_id
        except ProjectAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = create_job_record(
        db,
        job_id=body.job_id,
        filename=safe_name,
        content_type=content_type,
        voice_key=body.object_key,
        member=member,
        project_id=resolved_project_id,
        selected_segments=body.selected_segments if isinstance(body.selected_segments, list) else None,
        duration_seconds=int(body.billable_duration_ms // 1000)
        if body.billable_duration_ms and body.billable_duration_ms > 0
        else None,
    )
    publish_admin_event(
        "job_created",
        {"job_id": job.job_id, "status": job.status, "project_id": job.project_id},
    )

    logger.info(
        "client_upload_complete_success request_id=%s job_id=%s object_key=%s project_id=%s size=%s elapsed_ms=%s",
        request_id,
        job.job_id,
        body.object_key,
        job.project_id,
        metadata.get("size"),
        round((perf_counter() - started) * 1000, 1),
    )
    return VoiceUploadResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        object_key=body.object_key,
        bucket=settings.r2_bucket_name,
        status="UPLOADED",
    )
