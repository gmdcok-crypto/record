import logging
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def moov_after_mdat(data: bytes) -> bool:
    moov = data.find(b"moov")
    mdat = data.find(b"mdat")
    return moov > 0 and mdat > 0 and moov > mdat


def should_faststart(content: bytes, voice_key: str) -> bool:
    ext = Path(voice_key).suffix.lower()
    if ext not in {".m4a", ".mp4", ".mov"}:
        return False
    return moov_after_mdat(content)


def remux_faststart(content: bytes) -> bytes | None:
    try:
        with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as src:
            src.write(content)
            src_path = Path(src.name)
        dst_path = src_path.with_suffix(".faststart.m4a")
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(src_path),
                    "-c",
                    "copy",
                    "-movflags",
                    "+faststart",
                    str(dst_path),
                ],
                capture_output=True,
                check=False,
            )
            if result.returncode != 0:
                logger.warning("ffmpeg faststart failed: %s", result.stderr.decode(errors="replace")[:500])
                return None
            return dst_path.read_bytes()
        finally:
            src_path.unlink(missing_ok=True)
            dst_path.unlink(missing_ok=True)
    except FileNotFoundError:
        logger.warning("ffmpeg not installed; skipping faststart remux")
        return None
    except Exception as exc:
        logger.warning("faststart remux error: %s", exc)
        return None
