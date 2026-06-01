import os
import tempfile
from pathlib import Path

from soniox import SonioxClient
from soniox.types import CreateTranscriptionConfig

from app.config import settings


def _build_config() -> CreateTranscriptionConfig | None:
    if not settings.language_hint_list:
        return None
    return CreateTranscriptionConfig(language_hints=settings.language_hint_list)


def transcribe_file(file_path: Path, filename: str) -> dict:
    if not settings.soniox_api_key:
        raise ValueError("SONIOX_API_KEY is not configured")

    os.environ["SONIOX_API_KEY"] = settings.soniox_api_key
    client = SonioxClient()
    config = _build_config()

    try:
        transcript = client.stt.transcribe_and_wait_with_tokens(
            model=settings.soniox_model,
            file=str(file_path),
            filename=filename,
            config=config,
            delete_after=True,
            wait_timeout_sec=600,
        )
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
        "transcription_id": getattr(transcript, "id", None),
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
