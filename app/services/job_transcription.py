from app.config import settings
from app.services.r2 import get_object_bytes, get_object_metadata, get_voice_object_key, save_transcript_json
from app.services.soniox import transcribe_upload


def transcribe_job_voice(job_id: str) -> tuple[dict, str, str]:
    if not settings.soniox_api_key:
        raise ValueError("SONIOX_API_KEY is not configured")

    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise ValueError(f"Voice file not found for job: {job_id}")

    filename = voice_key.rsplit("/", 1)[-1]
    metadata = get_object_metadata(voice_key)
    content = get_object_bytes(voice_key)
    transcript_json = transcribe_upload(
        content,
        filename,
        metadata.get("content_type", "audio/x-m4a"),
    )
    transcript_key = save_transcript_json(job_id, transcript_json)
    return transcript_json, transcript_key, voice_key
