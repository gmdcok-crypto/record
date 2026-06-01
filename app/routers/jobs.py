import io

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.r2 import (
    get_object_bytes,
    get_transcript_json,
    get_voice_object_key,
    save_transcript_json,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class SaveTranscriptRequest(BaseModel):
    transcript_json: dict


@router.get("/{job_id}")
def get_job(job_id: str) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    transcript = get_transcript_json(job_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    return {
        "job_id": job_id,
        "voice_key": voice_key,
        "transcript_key": f"text/{job_id}/transcript.json",
        "audio_url": f"/api/jobs/{job_id}/audio",
        "transcript_json": transcript,
    }


@router.get("/{job_id}/audio")
def stream_audio(job_id: str) -> StreamingResponse:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        content = get_object_bytes(voice_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to load audio: {exc}") from exc

    media_type = "audio/mp4" if voice_key.endswith(".m4a") else "application/octet-stream"
    return StreamingResponse(io.BytesIO(content), media_type=media_type)


@router.put("/{job_id}/transcript")
def save_transcript(job_id: str, body: SaveTranscriptRequest) -> dict:
    voice_key = get_voice_object_key(job_id)
    if not voice_key:
        raise HTTPException(status_code=404, detail="Voice file not found")

    try:
        key = save_transcript_json(job_id, body.transcript_json)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Save failed: {exc}") from exc

    return {"job_id": job_id, "transcript_key": key, "status": "saved"}
