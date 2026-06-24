import os
import tempfile
from pathlib import Path

from soniox import SonioxClient
from soniox.types import CreateTranscriptionConfig

from app.config import settings
from app.services.r2 import ensure_filename_with_extension


def _build_config() -> CreateTranscriptionConfig:
    kwargs: dict = {
        "enable_speaker_diarization": settings.soniox_enable_speaker_diarization,
    }
    if settings.language_hint_list:
        kwargs["language_hints"] = settings.language_hint_list
    return CreateTranscriptionConfig(**kwargs)


UNCERTAIN_CONFIDENCE_THRESHOLD = 0.5


def _build_segments(tokens: list[dict]) -> list[dict]:
    segments: list[dict] = []
    current_speaker: str | None = None
    current_parts: list[str] = []
    current_start: int | None = None
    current_end: int | None = None

    def flush() -> None:
        nonlocal current_speaker, current_parts, current_start, current_end
        if not current_parts:
            return
        segments.append(
            {
                "speaker": current_speaker or "unknown",
                "text": "".join(current_parts).strip(),
                "start_ms": current_start,
                "end_ms": current_end,
            }
        )
        current_speaker = None
        current_parts = []
        current_start = None
        current_end = None

    for token in tokens:
        speaker = token.get("speaker") or "unknown"
        if current_speaker is not None and speaker != current_speaker:
            flush()

        if not current_parts:
            current_speaker = speaker
            current_start = token.get("start_ms")

        current_parts.append(token.get("text", ""))
        if token.get("end_ms") is not None:
            current_end = token.get("end_ms")

    flush()
    return segments


def _format_diarized_text(segments: list[dict]) -> str:
    lines = []
    for segment in segments:
        speaker = segment["speaker"]
        label = f"화자 {speaker}" if str(speaker).isdigit() else str(speaker)
        lines.append(f"[{label}] {segment['text']}")
    return "\n\n".join(lines)


def transcribe_file(file_path: Path, filename: str, content_type: str = "") -> dict:
    if not settings.soniox_api_key:
        raise ValueError("SONIOX_API_KEY is not configured")

    resolved_name = ensure_filename_with_extension(filename, content_type)

    os.environ["SONIOX_API_KEY"] = settings.soniox_api_key
    client = SonioxClient()
    config = _build_config()

    try:
        transcript = client.stt.transcribe_and_wait_with_tokens(
            model=settings.soniox_model,
            file=str(file_path),
            filename=resolved_name,
            config=config,
            delete_after=True,
            wait_timeout_sec=600,
        )
    finally:
        client.close()

    tokens = []
    for token in transcript.tokens or []:
        confidence = getattr(token, "confidence", None)
        tokens.append(
            {
                "text": token.text,
                "start_ms": getattr(token, "start_ms", None),
                "end_ms": getattr(token, "end_ms", None),
                "speaker": getattr(token, "speaker", None),
                "confidence": confidence if isinstance(confidence, (int, float)) else None,
                "uncertain": bool(isinstance(confidence, (int, float)) and confidence <= UNCERTAIN_CONFIDENCE_THRESHOLD),
            }
        )

    segments = _build_segments(tokens)
    diarized_text = _format_diarized_text(segments) if segments else transcript.text

    return {
        "transcription_id": getattr(transcript, "id", None),
        "filename": resolved_name,
        "text": diarized_text,
        "plain_text": transcript.text,
        "segments": segments,
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
