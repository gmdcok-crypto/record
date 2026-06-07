import re
from pathlib import Path

SRC = Path(r"c:\Users\gmdco\OneDrive\문서\약관.txt")
OUT = Path(__file__).resolve().parents[1] / "intro" / "service-terms-content.html"

REPLACEMENTS = {
    "(주) OO": "통합증거센터 녹취사무소",
    "(주)OO": "통합증거센터 녹취사무소",
    "㈜OO": "통합증거센터 녹취사무소",
    "소리바로(SORIBARO)": "통합증거센터 녹취사무소",
    "소리바로": "통합증거센터 녹취사무소",
    "AI 하이브리드 속기 서비스 통합증거센터 녹취사무소": "AI 하이브리드 녹취 서비스 통합증거센터 녹취사무소",
}


def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    for old, new in REPLACEMENTS.items():
        src = src.replace(old, new)

    src = src.replace(
        "가 운영하는 AI 하이브리드 녹취 서비스 통합증거센터 녹취사무소 및",
        "가 운영하는 AI 하이브리드 녹취 서비스 및",
    )
    src = src.replace("통합증거센터 녹취사무소 관련 제반", "본 서비스 관련 제반")
    src = src.replace("통합증거센터 녹취사무소과", "통합증거센터 녹취사무소와")

    out: list[str] = []
    for raw in src.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == "이용약관":
            out.append('<p class="terms-doc-title">이용약관</p>')
            continue
        if re.match(r"^제\d+장", line):
            out.append(f'<h4 class="terms-chapter">{line}</h4>')
        elif re.match(r"^제\d+조", line):
            out.append(f'<h5 class="terms-article">{line}</h5>')
        else:
            out.append(f"<p>{line}</p>")

    OUT.write_text("\n".join(out), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
