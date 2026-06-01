import os
import tempfile
from pathlib import Path

from soniox import SonioxClient
from soniox.types import CreateTranscriptionConfig

from app.config import settings
from app.services.r2 import ensure_filename_with_extension


def _build_config() -> CreateTranscriptionConfig | None:
    if not settings.language_hint_list:
        return None
    return CreateTranscriptionConfig(language_hints=settings.language_hint_list)


def _format_transcription_error(transcription) -> str:
    error_type = getattr(transcription, "error_type", None) or "unknown_error"
    error_message = getattr(transcription, "error_message", None) or "Transcription failed"
    return f"{error_type}: {error_message}"


def transcribe_file(file_path: Path, filename: str, content_type: str = "") -> dict:
    if not settings.soniox_api_key:
        raise ValueError("SONIOX_API_KEY is not configured")

    resolved_name = ensure_filename_with_extension(filename, content_type)

    os.environ["SONIOX_API_KEY"] = settings.soniox_api_key
    client = SonioxClient()
    config = _build_config()

    try:
        transcription = client.stt.transcribe_and_wait(
            model=settings.soniox_model,
            file=str(file_path),
            filename=resolved_name,
            config=config,
            delete_after=True,
            wait_timeout_sec=600,
        )

        if transcription.status != "completed":
            raise ValueError(_format_transcription_error(transcription))

        transcript = client.stt.get_transcript(transcription.id)
    finally:
        client.close()

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
        "filename": resolved_name,
        "text": transcript.text,
        "tokens": tokens,
    }


def transcribe_upload(content: bytes, filename: str, content_type: str = "") -> dict:
    resolved_name = ensure_filename_with_extension(filename, content_type)
    suffix = Path(resolved_name).suffix or ".m4a"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        return transcribe_file(tmp_path, filename, content_type)
    finally:
        tmp_path.unlink(missing_ok=True)
