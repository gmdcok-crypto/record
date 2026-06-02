export type Segment = {
  speaker: string;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
};

export type TranscriptJson = {
  transcription_id?: string | null;
  filename?: string;
  text?: string;
  plain_text?: string;
  segments?: Segment[];
  tokens?: unknown[];
  speaker_labels?: Record<string, string>;
};

export type JobResponse = {
  job_id: string;
  voice_key: string;
  transcript_key: string;
  audio_url: string;
  transcript_json: TranscriptJson;
};

function apiBase(): string {
  const configured = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
  return configured || window.location.origin;
}

export function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${apiBase()}${path}`;
}

export async function fetchJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "작업을 불러올 수 없습니다");
  }
  return res.json();
}

export async function saveTranscript(jobId: string, transcript: TranscriptJson): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "저장 실패");
  }
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function speakerLabel(speaker: string, labels?: Record<string, string>): string {
  const custom = labels?.[speaker]?.trim();
  if (custom) return custom;
  return /^\d+$/.test(speaker) ? `화자 ${speaker}` : speaker;
}

export function collectSpeakerIds(segments: Segment[]): string[] {
  const ids = new Set<string>();
  for (const seg of segments) {
    if (seg.speaker) ids.add(seg.speaker);
  }
  return Array.from(ids).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

export function segmentsToHtml(segments: Segment[], labels?: Record<string, string>): string {
  return segments
    .map(
      (seg, index) =>
        `<h3 data-segment-index="${index}" data-start-ms="${seg.start_ms ?? ""}" data-speaker-id="${escapeHtml(seg.speaker)}">${speakerLabel(seg.speaker, labels)} · ${formatMs(seg.start_ms)}</h3><p>${escapeHtml(seg.text)}</p>`,
    )
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function htmlToSegments(html: string, original: Segment[]): Segment[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(doc.querySelectorAll("h3"));
  const segments: Segment[] = [];

  headings.forEach((heading, index) => {
    const paragraph = heading.nextElementSibling;
    const text = paragraph?.textContent?.trim() || "";
    const fallback = original[index];
    const attrSpeakerId = heading.getAttribute("data-speaker-id");
    const speakerMatch = heading.textContent?.match(/화자\s*(\S+)/);
    const attrStartMs = heading.getAttribute("data-start-ms");
    const parsedStartMs = attrStartMs ? Number(attrStartMs) : NaN;
    segments.push({
      speaker: attrSpeakerId || speakerMatch?.[1] || fallback?.speaker || String(index + 1),
      text,
      start_ms: Number.isFinite(parsedStartMs) ? parsedStartMs : fallback?.start_ms ?? null,
      end_ms: fallback?.end_ms ?? null,
    });
  });

  return segments.length ? segments : original;
}

export function segmentsToPlainText(segments: Segment[], labels?: Record<string, string>): string {
  return segments
    .map((seg) => `[${speakerLabel(seg.speaker, labels)}] ${seg.text}`)
    .join("\n\n");
}
