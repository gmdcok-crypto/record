import json
import re
import uuid
from pathlib import Path

import boto3
from botocore.config import Config

from app.config import settings

CONTENT_TYPE_TO_EXT = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/vnd.wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/x-aac": ".aac",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _safe_filename(filename: str) -> str:
    name = filename.strip().replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "audio"


def ensure_filename_with_extension(filename: str, content_type: str = "") -> str:
    safe_name = _safe_filename(filename)
    if Path(safe_name).suffix:
        return safe_name

    ct = content_type.split(";")[0].strip().lower()
    ext = CONTENT_TYPE_TO_EXT.get(ct, ".m4a")
    return f"{safe_name}{ext}"


def create_voice_upload_url(filename: str, content_type: str) -> dict:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    job_id = str(uuid.uuid4())
    safe_name = ensure_filename_with_extension(filename, content_type)
    object_key = f"{settings.r2_voice_prefix}{job_id}/{safe_name}"

    client = _client()
    upload_url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": object_key,
            "ContentType": content_type,
        },
        ExpiresIn=settings.r2_presign_expires,
    )

    return {
        "job_id": job_id,
        "object_key": object_key,
        "upload_url": upload_url,
        "expires_in": settings.r2_presign_expires,
        "bucket": settings.r2_bucket_name,
    }


def upload_voice_bytes(data: bytes, filename: str, content_type: str) -> dict:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    job_id = str(uuid.uuid4())
    safe_name = ensure_filename_with_extension(filename, content_type)
    object_key = f"{settings.r2_voice_prefix}{job_id}/{safe_name}"

    client = _client()
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        Body=data,
        ContentType=content_type,
    )

    return {
        "job_id": job_id,
        "object_key": object_key,
        "bucket": settings.r2_bucket_name,
        "filename": safe_name,
        "content_type": content_type,
    }


def get_object_bytes(object_key: str) -> bytes:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    client = _client()
    response = client.get_object(Bucket=settings.r2_bucket_name, Key=object_key)
    return response["Body"].read()


def put_object_bytes(object_key: str, data: bytes, content_type: str) -> None:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    client = _client()
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        Body=data,
        ContentType=content_type,
    )


def get_object_metadata(object_key: str) -> dict:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    client = _client()
    response = client.head_object(Bucket=settings.r2_bucket_name, Key=object_key)
    return {
        "content_type": response.get("ContentType", "application/octet-stream"),
        "size": response.get("ContentLength", 0),
    }


def get_voice_object_key(job_id: str) -> str | None:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    prefix = f"{settings.r2_voice_prefix}{job_id}/"
    client = _client()
    response = client.list_objects_v2(Bucket=settings.r2_bucket_name, Prefix=prefix)

    for item in response.get("Contents", []):
        key = item["Key"]
        if not key.endswith("/"):
            return key

    return None


def save_transcript_json(job_id: str, transcript: dict) -> str:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    object_key = f"{settings.r2_text_prefix}{job_id}/transcript.json"
    body = json.dumps(transcript, ensure_ascii=False, indent=2).encode("utf-8")

    client = _client()
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        Body=body,
        ContentType="application/json; charset=utf-8",
    )

    return object_key


def save_transcript_history_snapshot(job_id: str, revision_id: str, transcript: dict) -> str:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    object_key = f"{settings.r2_text_prefix}{job_id}/history/{revision_id}.json"
    body = json.dumps(transcript, ensure_ascii=False, indent=2).encode("utf-8")

    client = _client()
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        Body=body,
        ContentType="application/json; charset=utf-8",
    )

    return object_key


def get_transcript_history_json(object_key: str) -> dict:
    return json.loads(get_object_bytes(object_key).decode("utf-8"))


def get_transcript_json(job_id: str) -> dict | None:
    object_key = f"{settings.r2_text_prefix}{job_id}/transcript.json"
    try:
        return json.loads(get_object_bytes(object_key).decode("utf-8"))
    except Exception:
        return None


def create_download_url(object_key: str, expires_in: int | None = None) -> str:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    client = _client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": object_key},
        ExpiresIn=expires_in or settings.r2_presign_expires,
    )
