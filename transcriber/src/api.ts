const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export type TranscriptToken = {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker: string | null;
};

export type TranscriptSegment = {
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
  segments?: TranscriptSegment[];
  tokens?: TranscriptToken[];
  speaker_labels?: Record<string, string>;
};

export type JobResponse = {
  job_id: string;
  voice_key: string;
  transcript_key: string;
  audio_url: string;
  transcript_json: TranscriptJson;
  title?: string;
  status?: string;
  priority?: string;
  uploaded_at?: string | null;
  due_at?: string | null;
  client?: {
    id: number | null;
    name: string;
  };
  transcriber?: {
    id: number | null;
    name: string | null;
  };
  final_pdf_ready?: boolean;
  final_pdf_filename?: string | null;
};

export type AssignedWork = {
  job_id: string;
  client: string;
  title: string;
  filename: string;
  due_at: string | null;
  status: string;
  priority: string;
};

export type TranscriberProfile = {
  id: number;
  code: string;
  name: string;
  specialty: string | null;
  status: string;
  monthly_capacity: number | null;
  current_load: number;
  unit_price: number;
  quality_score: number;
};

function apiBase(): string {
  return API_URL || window.location.origin;
}

function parseErrorDetail(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map(String).join(", ");
  }
  return "요청 처리 중 오류가 발생했습니다";
}

function parseFilenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = header.match(/filename="([^"]+)"/i);
  return plainMatch?.[1] || fallback;
}

export function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${apiBase()}${path}`;
}

export async function fetchJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export async function fetchAssignedJobs(transcriberCode = "TR-001"): Promise<AssignedWork[]> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/assigned?transcriber_code=${encodeURIComponent(transcriberCode)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { jobs?: AssignedWork[] };
  return data.jobs || [];
}

export async function fetchTranscriberProfile(transcriberCode = "TR-001"): Promise<TranscriberProfile> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/profile?transcriber_code=${encodeURIComponent(transcriberCode)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
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
    throw new Error(parseErrorDetail(err));
  }
}

export async function updateJobStatus(jobId: string, status: string, note?: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
}

export async function downloadTranscriptPdf(jobId: string, transcript: TranscriptJson): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }

  const blob = await res.blob();
  const filename = parseFilenameFromDisposition(
    res.headers.get("Content-Disposition"),
    "transcript.pdf",
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function finalizeTranscriptPdf(
  jobId: string,
  transcript: TranscriptJson,
): Promise<{ download_url: string; filename: string; final_pdf_key: string }> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export async function downloadFinalTranscriptPdf(jobId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf/final`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const blob = await res.blob();
  const filename = parseFilenameFromDisposition(
    res.headers.get("Content-Disposition"),
    "final_transcript.pdf",
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function speakerLabel(speaker: string, labels?: Record<string, string>): string {
  const custom = labels?.[speaker]?.trim();
  if (custom) return custom;
  return /^\d+$/.test(speaker) ? `화자 ${speaker}` : speaker;
}
