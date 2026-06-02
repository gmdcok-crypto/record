from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_CANDIDATES = (
    FONT_DIR / "NotoSansKR-Regular.ttf",
    FONT_DIR / "NotoSansCJKkr-Regular.otf",
)
FONT_FAMILY = "NotoKR"


def _speaker_label(speaker: str, labels: dict) -> str:
    custom = (labels.get(speaker) or "").strip()
    if custom:
        return custom
    if str(speaker).isdigit():
        return f"화자 {speaker}"
    return str(speaker)


def _safe_filename(name: str) -> str:
    stem = Path(name).stem if name else "transcript"
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in stem)
    return cleaned or "transcript"


def _resolve_font_path() -> Path:
    for path in FONT_CANDIDATES:
        if path.is_file() and path.stat().st_size > 10_000:
            return path
    searched = ", ".join(str(path) for path in FONT_CANDIDATES)
    raise RuntimeError(f"Korean PDF font not found (checked: {searched})")


def _register_font(pdf: FPDF) -> str:
    pdf.add_font(FONT_FAMILY, "", str(_resolve_font_path()))
    return FONT_FAMILY


def build_transcript_pdf(transcript: dict) -> tuple[bytes, str]:
    pdf = FPDF()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    font = _register_font(pdf)
    title = transcript.get("filename") or "녹취록"
    segments = transcript.get("segments") or []
    labels = transcript.get("speaker_labels") or {}

    pdf.set_font(font, size=16)
    pdf.multi_cell(0, 10, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(6)

    if segments:
        for segment in segments:
            speaker = _speaker_label(str(segment.get("speaker", "")), labels)
            text = (segment.get("text") or "").strip()
            if not text:
                continue

            pdf.set_font(font, size=12)
            pdf.multi_cell(0, 8, speaker, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font(font, size=11)
            pdf.multi_cell(0, 7, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(4)
    else:
        body = (transcript.get("text") or transcript.get("plain_text") or "").strip()
        pdf.set_font(font, size=11)
        pdf.multi_cell(0, 7, body or "(내용 없음)", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf_bytes = pdf.output()
    download_name = f"{_safe_filename(title)}_녹취록.pdf"
    return bytes(pdf_bytes), download_name
