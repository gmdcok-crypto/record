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

export function speakerLabel(speaker: string): string {
  return /^\d+$/.test(speaker) ? `화자 ${speaker}` : speaker;
}

export function segmentsToHtml(segments: Segment[]): string {
  return segments
    .map(
      (seg) =>
        `<h3>${speakerLabel(seg.speaker)} · ${formatMs(seg.start_ms)}</h3><p>${escapeHtml(seg.text)}</p>`,
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
    const speakerMatch = heading.textContent?.match(/화자\s*(\S+)/);
    segments.push({
      speaker: speakerMatch?.[1] || fallback?.speaker || String(index + 1),
      text,
      start_ms: fallback?.start_ms ?? null,
      end_ms: fallback?.end_ms ?? null,
    });
  });

  return segments.length ? segments : original;
}

export function segmentsToPlainText(segments: Segment[]): string {
  return segments
    .map((seg) => `[${speakerLabel(seg.speaker)}] ${seg.text}`)
    .join("\n\n");
}
