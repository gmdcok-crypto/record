import re
import uuid

import boto3
from botocore.config import Config

from app.config import settings


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
    return name or "audio.wav"


def create_voice_upload_url(filename: str, content_type: str) -> dict:
    if not settings.r2_configured:
        raise ValueError("R2 is not configured")

    job_id = str(uuid.uuid4())
    safe_name = _safe_filename(filename)
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
