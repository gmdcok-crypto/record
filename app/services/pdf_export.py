from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_CANDIDATES = (
    FONT_DIR / "NotoSansKR-Regular.ttf",
    FONT_DIR / "NotoSansCJKkr-Regular.otf",
)
FONT_BOLD_CANDIDATES = (
    FONT_DIR / "NotoSansKR-Bold.ttf",
)
FONT_FAMILY = "NotoKR"
CONFIRMATION_NOTE = "※대화자는 의뢰인이 확인함."
END_MARKER = "*****************************************〔끝〕****************************************"
FOOTER_OFFICE = "통합증거센터 녹취사무소 010-8271-4970"
FOOTER_HEIGHT = 24
FOOTER_TEXT_H = 8


class TranscriptPDF(FPDF):
    def __init__(self, font_family: str):
        super().__init__()
        self._font_family = font_family
        self._bold_available = False

    def footer(self) -> None:
        footer_top = self.h - FOOTER_HEIGHT
        line_y = footer_top + 2

        self.set_draw_color(0, 0, 0)
        self.set_line_width(0.2)
        self.line(self.l_margin, line_y, self.w - self.r_margin, line_y)

        self.set_y(footer_top + 5)
        content_w = self.w - self.l_margin - self.r_margin
        y = self.get_y()
        self.set_font(
            self._font_family,
            style="B" if self._bold_available else "",
            size=10,
        )
        self.set_x(self.l_margin)
        self.cell(content_w, FOOTER_TEXT_H, FOOTER_OFFICE, align="L")
        self.set_xy(self.l_margin, y)
        self.cell(content_w, FOOTER_TEXT_H, str(self.page_no()), align="C")


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


def _resolve_font_path(candidates: tuple[Path, ...]) -> Path | None:
    for path in candidates:
        if path.is_file() and path.stat().st_size > 10_000:
            return path
    return None


def _register_fonts(pdf: FPDF) -> tuple[str, bool]:
    regular = _resolve_font_path(FONT_CANDIDATES)
    if not regular:
        searched = ", ".join(str(path) for path in FONT_CANDIDATES)
        raise RuntimeError(f"Korean PDF font not found (checked: {searched})")

    pdf.add_font(FONT_FAMILY, "", str(regular))

    bold = _resolve_font_path(FONT_BOLD_CANDIDATES)
    if bold:
        pdf.add_font(FONT_FAMILY, "B", str(bold))
    return FONT_FAMILY, bold is not None


def _append_document_end(pdf: FPDF, font: str, bold_available: bool) -> None:
    pdf.ln(8)
    pdf.set_font(font, style="B" if bold_available else "", size=11)
    pdf.multi_cell(0, 8, CONFIRMATION_NOTE, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)
    pdf.set_font(font, size=11)
    pdf.multi_cell(
        0,
        8,
        END_MARKER,
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )


def build_transcript_pdf(transcript: dict) -> tuple[bytes, str]:
    pdf = TranscriptPDF(FONT_FAMILY)
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20 + FOOTER_HEIGHT)
    pdf.add_page()

    font, bold_available = _register_fonts(pdf)
    pdf._font_family = font
    pdf._bold_available = bold_available

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

    _append_document_end(pdf, font, bold_available)

    pdf_bytes = pdf.output()
    download_name = f"{_safe_filename(title)}_녹취록.pdf"
    return bytes(pdf_bytes), download_name
