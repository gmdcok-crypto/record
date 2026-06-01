import os
import tempfile
from pathlib import Path

from soniox import SonioxClient

from app.config import settings


def transcribe_file(file_path: Path, filename: str) -> dict:
    if not settings.soniox_api_key:
        raise ValueError("SONIOX_API_KEY is not configured")

    os.environ["SONIOX_API_KEY"] = settings.soniox_api_key
    client = SonioxClient()

    kwargs: dict = {
        "model": settings.soniox_model,
        "file": str(file_path),
    }
    if settings.language_hint_list:
        kwargs["language_hints"] = settings.language_hint_list

    transcription = client.stt.transcribe(**kwargs)
    client.stt.wait(transcription.id)
    transcript = client.stt.get_transcript(transcription.id)

    tokens = []
    for token in transcript.tokens or []:
        tokens.append(
            {
                "text": token.text,
                "start_ms": getattr(token, "start_ms", None),
                "end_ms": getattr(token, "end_ms", None),
                "speaker": getattr(token, "speaker", None),
            }
        )

    return {
        "transcription_id": transcription.id,
        "filename": filename,
        "text": transcript.text,
        "tokens": tokens,
    }


def transcribe_upload(content: bytes, filename: str) -> dict:
    suffix = Path(filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        return transcribe_file(tmp_path, filename)
    finally:
        tmp_path.unlink(missing_ok=True)
