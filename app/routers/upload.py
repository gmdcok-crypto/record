from pathlib import Path

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from app.services.r2 import create_voice_upload_url, ensure_filename_with_extension, get_object_bytes, get_voice_object_key, upload_voice_bytes

router = APIRouter(prefix="/api/upload", tags=["upload"])

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


class PresignResponse(BaseModel):
    job_id: str
    object_key: str
    upload_url: str
    expires_in: int
    bucket: str


class VoiceUploadResponse(BaseModel):
    job_id: str
    object_key: str
    bucket: str
    status: str
    transcript_text: str | None = None
    transcript_key: str | None = None
    transcript_json: dict | None = None
    error: str | None = None


@router.post("/voice", response_model=VoiceUploadResponse)
async def upload_voice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    member: Annotated[Member | None, Depends(get_optional_current_member)] = None,
    project_id: Annotated[str | None, Form()] = None,
) -> VoiceUploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if not is_allowed_upload(content_type, file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

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
    )
    publish_admin_event(
        "job_created",
        {"job_id": job.job_id, "status": job.status, "project_id": job.project_id},
    )

    return response


@router.post("/presign", response_model=PresignResponse)
def presign_upload(body: PresignRequest) -> PresignResponse:
    content_type = body.content_type.split(";")[0].strip().lower()
    if not is_allowed_upload(content_type, body.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}",
        )

    try:
        result = create_voice_upload_url(body.filename, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"R2 presign failed: {exc}") from exc

    return PresignResponse(**result)
