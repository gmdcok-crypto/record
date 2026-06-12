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
  workflow_status?: string;
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
  has_inquiry?: boolean;
  transcriber_inquiry_status?: "reply_pending" | "reply_arrived" | null;
};

export type AssignedWork = {
  job_id: string;
  client: string;
  title: string;
  filename: string;
  due_at: string | null;
  status: string;
  priority: string;
  has_inquiry?: boolean;
  transcriber_inquiry_status?: "reply_pending" | "reply_arrived" | null;
};

export type TranscriberProjectFile = {
  job_id: string;
  title: string;
  filename: string;
  status: string;
  workflow_status?: string;
  uploaded_at: string | null;
  due_at: string | null;
  assignee: string | null;
  pdf_ready: boolean;
  has_inquiry?: boolean;
  transcriber_inquiry_status?: "reply_pending" | "reply_arrived" | null;
};

export type TranscriberProject = {
  project_id: string | null;
  title: string;
  client: { id: number | null; name: string };
  due_at: string | null;
  status: string;
  file_count: number;
  completed_count: number;
  files: TranscriberProjectFile[];
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

export type TranscriberAuthProfile = {
  id: number;
  code: string;
  login_id: string;
  name: string;
  phone: string | null;
  bank_name: string | null;
  account_number: string | null;
  resident_id: string | null;
  license_filename: string | null;
  has_license: boolean;
  status: string;
  auth_status: string;
};

export type TranscriberProfileUpdateInput = {
  phone?: string;
  bank_name?: string;
  account_number?: string;
  resident_id?: string;
};

export const TRANSCRIBER_TOKEN_KEY = "transcriber_access_token";

function apiBase(): string {
  return API_URL || window.location.origin;
}

export function createAdminEventsSource(): EventSource {
  return new EventSource(`${apiBase()}/api/jobs/admin/events`);
}

function transcriberAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TRANSCRIBER_TOKEN_KEY);
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function bootstrapTranscriberTokenFromUrl(): boolean {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashToken = hashParams.get("token");
  const queryToken = new URLSearchParams(window.location.search).get("token");
  const token = hashToken || queryToken;
  if (!token) return false;

  localStorage.setItem(TRANSCRIBER_TOKEN_KEY, token);
  window.history.replaceState(null, "", window.location.pathname);
  return true;
}

export function clearTranscriberSession(): void {
  localStorage.removeItem(TRANSCRIBER_TOKEN_KEY);
}

export async function fetchTranscriberMe(): Promise<TranscriberAuthProfile | null> {
  const token = localStorage.getItem(TRANSCRIBER_TOKEN_KEY);
  if (!token) return null;

  const res = await fetch(`${apiBase()}/api/transcriber/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) clearTranscriberSession();
    return null;
  }
  const data = await res.json();
  return data.transcriber as TranscriberAuthProfile;
}

export async function updateTranscriberProfile(input: TranscriberProfileUpdateInput): Promise<TranscriberAuthProfile> {
  const res = await fetch(`${apiBase()}/api/transcriber/auth/profile`, {
    method: "PATCH",
    headers: { ...transcriberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data) || "개인정보 저장에 실패했습니다.");
  }
  return (data as { transcriber: TranscriberAuthProfile }).transcriber;
}

export async function uploadTranscriberLicense(file: File): Promise<TranscriberAuthProfile> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBase()}/api/transcriber/auth/profile/license`, {
    method: "POST",
    headers: transcriberAuthHeaders(),
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data) || "자격증 업로드에 실패했습니다.");
  }
  return (data as { transcriber: TranscriberAuthProfile }).transcriber;
}

export async function fetchTranscriberLicenseObjectUrl(): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/transcriber/auth/profile/license`, {
    headers: transcriberAuthHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data) || "자격증 미리보기를 불러오지 못했습니다.");
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export type TranscriberSignupInput = {
  login_id: string;
  password: string;
  name: string;
};

export async function checkTranscriberLoginId(loginId: string): Promise<boolean> {
  const res = await fetch(
    `${apiBase()}/api/transcriber/auth/check-login-id?login_id=${encodeURIComponent(loginId.trim())}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data) || "로그인 ID 확인에 실패했습니다.");
  }
  const data = (await res.json()) as { available?: boolean };
  return Boolean(data.available);
}

export async function signupTranscriber(input: TranscriberSignupInput): Promise<TranscriberAuthProfile> {
  const res = await fetch(`${apiBase()}/api/transcriber/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      login_id: input.login_id.trim(),
      password: input.password,
      name: input.name.trim(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data) || "회원가입에 실패했습니다.");
  }
  localStorage.setItem(TRANSCRIBER_TOKEN_KEY, data.access_token);
  return data.transcriber as TranscriberAuthProfile;
}

export async function loginTranscriber(loginId: string, password: string): Promise<TranscriberAuthProfile> {
  const res = await fetch(`${apiBase()}/api/transcriber/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login_id: loginId.trim(), password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data) || "로그인에 실패했습니다.");
  }
  localStorage.setItem(TRANSCRIBER_TOKEN_KEY, data.access_token);
  return data.transcriber as TranscriberAuthProfile;
}

function parseErrorDetail(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map(String).join(", ");
  }
  return "요청 처리 중 오류가 발생했습니다";
}

async function fetchWithRetry(input: string, init?: RequestInit, retries = 1): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("서버 연결 오류");
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
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`, {
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export async function fetchAssignedProjects(): Promise<TranscriberProject[]> {
  const res = await fetchWithRetry(`${apiBase()}/api/jobs/transcriber/projects`, {
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { projects?: TranscriberProject[] };
  return data.projects || [];
}

export async function fetchAssignedJobs(): Promise<AssignedWork[]> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/assigned`, {
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { jobs?: AssignedWork[] };
  return data.jobs || [];
}

export async function fetchTranscriberProfile(): Promise<TranscriberProfile> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/profile`, {
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export type AiDraftResponse = {
  status: string;
  job_id: string;
  transcript_json: TranscriptJson;
};

export async function deliverDraftToClient(
  jobId: string,
  transcript: TranscriptJson,
): Promise<{ job_id: string; status: string; workflow_status?: string; transcript_json: TranscriptJson }> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/${jobId}/deliver-draft`, {
    method: "POST",
    headers: { ...transcriberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export async function runAiDraft(jobId: string): Promise<AiDraftResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/${jobId}/ai-draft`, {
    method: "POST",
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export type TranscriptChangeItem = {
  type: string;
  segment_index?: number;
  speaker_id?: string;
  speaker?: string;
  before?: string;
  after?: string;
};

export type TranscriptChangeEntry = {
  version: number;
  save_kind: string;
  save_kind_label: string;
  editor_role: string;
  editor_name: string;
  changes: TranscriptChangeItem[];
  created_at: string | null;
};

export type JobInquiryMessage = {
  id: number;
  job_id: string;
  thread_type: string;
  sender_role: string;
  sender_name: string;
  message: string;
  created_at: string | null;
};

export async function saveTranscript(
  jobId: string,
  transcript: TranscriptJson,
  saveKind: string = "draft",
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript`, {
    method: "PUT",
    headers: { ...transcriberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript_json: transcript,
      save_kind: saveKind,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
}

export async function fetchTranscriptChanges(jobId: string): Promise<TranscriptChangeEntry[]> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript/changes`, {
    headers: transcriberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { entries?: TranscriptChangeEntry[] };
  return data.entries ?? [];
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

export async function fetchTranscriberJobInquiries(jobId: string): Promise<JobInquiryMessage[]> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/${jobId}/inquiries`, {
    headers: transcriberAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return (data.messages ?? []) as JobInquiryMessage[];
}

export async function createTranscriberJobInquiry(jobId: string, message: string): Promise<JobInquiryMessage> {
  const res = await fetch(`${apiBase()}/api/jobs/transcriber/${jobId}/inquiries`, {
    method: "POST",
    headers: { ...transcriberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return data.message as JobInquiryMessage;
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

export function collectSpeakerIds(segments: TranscriptSegment[]): string[] {
  const ids = new Set<string>();
  for (const segment of segments) {
    if (segment.speaker) ids.add(segment.speaker);
  }
  return Array.from(ids).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}
