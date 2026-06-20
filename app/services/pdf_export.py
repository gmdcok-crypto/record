from io import BytesIO
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from pypdf import PdfReader, PdfWriter

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
COVERS_DIR = Path(__file__).resolve().parent.parent / "assets" / "covers"
COVER_FRONT = COVERS_DIR / "cover_front.pdf"
COVER_BACK = COVERS_DIR / "cover_back.pdf"
STAMP_PATH = Path(__file__).resolve().parent.parent / "assets" / "stamp.png"
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
FOOTER_HEIGHT = 26
FOOTER_TEXT_H = 8
STAMP_SIZE_MM = 13


def _segment_selected(segment: dict, selected_segments: list[dict]) -> bool:
    start_ms = segment.get("start_ms")
    end_ms = segment.get("end_ms")
    if start_ms is None and end_ms is None:
        return True
    for item in selected_segments:
        if not item or item.get("selected") is False:
            continue
        selected_start = item.get("start_ms")
        selected_end = item.get("end_ms")
        if selected_start is None or selected_end is None:
            continue
        overlap_start = max(start_ms if start_ms is not None else selected_start, selected_start)
        overlap_end = min(end_ms if end_ms is not None else selected_end, selected_end)
        if overlap_end > overlap_start:
            return True
    return False


def filter_transcript_to_selected_segments(transcript: dict, selected_segments: list[dict] | None) -> dict:
    normalized = [item for item in (selected_segments or []) if isinstance(item, dict) and item.get("selected", True)]
    if not normalized:
        return transcript
    segments = transcript.get("segments") or []
    if not segments:
        return transcript
    filtered_segments = [segment for segment in segments if _segment_selected(segment, normalized)]
    if not filtered_segments:
        return transcript
    labels = transcript.get("speaker_labels") or {}
    diarized_text = _format_transcript_text(filtered_segments, labels)
    return {
        **transcript,
        "segments": filtered_segments,
        "text": diarized_text,
        "plain_text": diarized_text,
    }


class TranscriptPDF(FPDF):
    def __init__(self, font_family: str):
        super().__init__()
        self._font_family = font_family
        self._bold_available = False
        self._stamp_path: Path | None = STAMP_PATH if STAMP_PATH.is_file() else None

    def footer(self) -> None:
        footer_top = self.h - FOOTER_HEIGHT
        line_y = footer_top + 2
        content_w = self.w - self.l_margin - self.r_margin

        self.set_draw_color(0, 0, 0)
        self.set_line_width(0.2)
        self.line(self.l_margin, line_y, self.w - self.r_margin, line_y)

        text_y = footer_top + 6
        self.set_y(text_y)
        self.set_font(
            self._font_family,
            style="B" if self._bold_available else "",
            size=10,
        )
        left_w = content_w - STAMP_SIZE_MM - 2
        self.set_x(self.l_margin)
        self.cell(left_w, FOOTER_TEXT_H, FOOTER_OFFICE, align="L")
        self.set_xy(self.l_margin, text_y)
        self.cell(content_w, FOOTER_TEXT_H, str(self.page_no()), align="C")

        if self._stamp_path:
            stamp_x = self.w - self.r_margin - STAMP_SIZE_MM
            stamp_y = footer_top + 4
            self.image(
                str(self._stamp_path),
                x=stamp_x,
                y=stamp_y,
                w=STAMP_SIZE_MM,
                h=STAMP_SIZE_MM,
            )


def _create_pdf() -> tuple[TranscriptPDF, str, bool]:
    pdf = TranscriptPDF(FONT_FAMILY)
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20 + FOOTER_HEIGHT)
    font, bold_available = _register_fonts(pdf)
    pdf._font_family = font
    pdf._bold_available = bold_available
    return pdf, font, bold_available


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


def _format_time_ms(ms: int | None) -> str:
    if ms is None:
        return "--:--"
    total = int(ms // 1000)
    minute = total // 60
    second = total % 60
    return f"{minute:02d}:{second:02d}"


def _format_omitted_segment_text(segment: dict) -> str:
    start = segment.get("start_ms")
    end = segment.get("end_ms")
    return _format_omitted_range_text(start, end)


def _format_omitted_range_text(start: int | None, end: int | None) -> str:
    return f"{_format_time_ms(start)} - {_format_time_ms(end)} (생략)"


def _segment_ms(segment: dict, key: str) -> int | None:
    value = segment.get(key)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _segments_for_pdf_render(segments: list[dict]) -> list[dict]:
    """Merge consecutive omitted segments for PDF output only."""
    if not segments:
        return []

    rendered: list[dict] = []
    index = 0
    while index < len(segments):
        segment = segments[index]
        if not _segment_is_omitted(segment):
            rendered.append(segment)
            index += 1
            continue

        run_start_ms = _segment_ms(segment, "start_ms")
        run_end_ms = _segment_ms(segment, "end_ms")
        merged = dict(segment)
        index += 1

        while index < len(segments) and _segment_is_omitted(segments[index]):
            next_segment = segments[index]
            next_start = _segment_ms(next_segment, "start_ms")
            next_end = _segment_ms(next_segment, "end_ms")

            if next_start is not None:
                run_start_ms = (
                    next_start
                    if run_start_ms is None
                    else min(run_start_ms, next_start)
                )
            if next_end is not None:
                run_end_ms = next_end if run_end_ms is None else max(run_end_ms, next_end)

            index += 1

        merged["start_ms"] = run_start_ms
        merged["end_ms"] = run_end_ms
        merged["omitted"] = True
        rendered.append(merged)

    return rendered


def _segment_is_omitted(segment: dict) -> bool:
    return bool(segment.get("omitted"))


def _format_transcript_text(segments: list[dict], labels: dict) -> str:
    lines = []
    for segment in segments:
        speaker = _speaker_label(str(segment.get("speaker", "")), labels)
        if _segment_is_omitted(segment):
            lines.append(f"{speaker}: {_format_omitted_segment_text(segment)}")
            continue
        text = (segment.get("text") or "").strip()
        if text:
            lines.append(f"{speaker}: {text}")
    return "\n\n".join(lines)


def _append_pdf_pages(writer: PdfWriter, path: Path) -> None:
    if not path.is_file():
        return
    reader = PdfReader(str(path))
    for page in reader.pages:
        writer.add_page(page)


def _merge_with_covers(body_bytes: bytes) -> bytes:
    writer = PdfWriter()
    _append_pdf_pages(writer, COVER_FRONT)
    body_reader = PdfReader(BytesIO(body_bytes))
    for page in body_reader.pages:
        writer.add_page(page)
    _append_pdf_pages(writer, COVER_BACK)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _render_transcript_body(
    pdf: TranscriptPDF,
    transcript: dict,
    font: str,
    bold_available: bool,
    *,
    include_title: bool,
) -> None:
    title = transcript.get("filename") or "녹취록"
    segments = transcript.get("segments") or []
    labels = transcript.get("speaker_labels") or {}

    if include_title:
        pdf.set_font(font, size=16)
        pdf.multi_cell(0, 10, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(6)

    if segments:
        for segment in _segments_for_pdf_render(segments):
            speaker = _speaker_label(str(segment.get("speaker", "")), labels)
            if _segment_is_omitted(segment):
                text = _format_omitted_segment_text(segment)
            else:
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


def _build_transcript_body_pdf(transcript: dict) -> bytes:
    pdf, font, bold_available = _create_pdf()
    pdf.add_page()
    _render_transcript_body(pdf, transcript, font, bold_available, include_title=True)
    return bytes(pdf.output())


def _bundle_cover_page(
    pdf: TranscriptPDF,
    *,
    project_title: str,
    document_count: int,
    font: str,
    bold_available: bool,
) -> None:
    pdf.add_page()
    pdf.set_y(48)
    pdf.set_font(font, style="B" if bold_available else "", size=24)
    pdf.multi_cell(0, 14, "프로젝트 통합 녹취록", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(10)
    pdf.set_font(font, style="B" if bold_available else "", size=20)
    pdf.multi_cell(0, 12, project_title or "프로젝트", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(16)
    pdf.set_font(font, size=13)
    pdf.multi_cell(
        0,
        9,
        f"총 {document_count}건 문서를 통합했습니다.",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )


def _bundle_divider_page(
    pdf: TranscriptPDF,
    *,
    index: int,
    title: str,
    font: str,
    bold_available: bool,
) -> None:
    pdf.add_page()
    pdf.set_y(62)
    pdf.set_font(font, size=16)
    pdf.multi_cell(0, 10, f"문서 {index}", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(12)
    pdf.set_font(font, style="B" if bold_available else "", size=22)
    pdf.multi_cell(0, 14, title or "녹취록", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(18)
    pdf.set_font(font, size=12)
    pdf.multi_cell(
        0,
        8,
        "다음 페이지부터 해당 문서의 녹취 본문이 이어집니다.",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )

    return bytes(pdf.output())


def build_transcript_pdf(transcript: dict) -> tuple[bytes, str]:
    title = transcript.get("filename") or "녹취록"
    body_bytes = _build_transcript_body_pdf(transcript)
    pdf_bytes = _merge_with_covers(body_bytes)
    download_name = f"{_safe_filename(title)}_녹취록.pdf"
    return pdf_bytes, download_name


def build_project_bundle_pdf(project_title: str, transcripts: list[dict]) -> tuple[bytes, str]:
    if not transcripts:
        raise ValueError("등록된 문서 없습니다.")

    pdf, font, bold_available = _create_pdf()
    _bundle_cover_page(
        pdf,
        project_title=project_title or "프로젝트",
        document_count=len(transcripts),
        font=font,
        bold_available=bold_available,
    )

    for index, transcript in enumerate(transcripts, start=1):
        title = transcript.get("filename") or f"문서 {index}"
        _bundle_divider_page(pdf, index=index, title=title, font=font, bold_available=bold_available)
        pdf.add_page()
        _render_transcript_body(pdf, transcript, font, bold_available, include_title=False)

    bundle_name = f"{_safe_filename(project_title)}_통합녹취록.pdf"
    return bytes(pdf.output()), bundle_name
