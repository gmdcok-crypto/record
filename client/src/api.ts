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

export type UploadResponse = {
  job_id: string;
  project_id?: string | null;
  object_key: string;
  bucket: string;
  status: string;
  transcript_text?: string | null;
  transcript_key?: string | null;
  transcript_json?: TranscriptJson | null;
  error?: string | null;
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
};

export type JobArchiveItem = {
  job_id: string;
  title: string;
  filename: string;
  status: string;
  workflow_status?: string;
  updated_at: string | null;
  client_name: string;
  pdf_ready: boolean;
  final_pdf_filename?: string | null;
};

export type HealthResponse = {
  status: string;
  soniox_configured?: boolean;
  r2_configured: boolean;
  bucket: string;
  database_configured?: boolean;
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

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${apiBase()}/health`);
  if (!res.ok) throw new Error("서버 연결 실패");
  return res.json();
}

export type ProjectFile = {
  job_id: string;
  title: string;
  filename: string;
  status: string;
  workflow_status?: string;
  uploaded_at: string | null;
  due_at: string | null;
  assignee: string | null;
  pdf_ready: boolean;
};

export type ProjectSummary = {
  project_id: string;
  title: string;
  status: string;
  file_count: number;
  completed_count: number;
  due_at: string | null;
  memo?: string | null;
  priority?: string;
  assignee?: string;
  files?: ProjectFile[];
  client: { id: number; name: string };
};

function memberAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(MEMBER_TOKEN_KEY);
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchProjects(includeFiles = true): Promise<ProjectSummary[]> {
  const query = includeFiles ? "?include_files=true" : "";
  const res = await fetch(`${apiBase()}/api/projects${query}`, { headers: memberAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { projects?: ProjectSummary[] };
  return data.projects || [];
}

export async function createProject(title: string, memo?: string): Promise<ProjectSummary> {
  const res = await fetch(`${apiBase()}/api/projects`, {
    method: "POST",
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title, memo }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return (data as { project: ProjectSummary }).project;
}

export async function uploadVoice(
  file: File,
  onProgress?: (percent: number) => void,
  onUploadComplete?: () => void,
  projectId?: string,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  if (projectId) {
    form.append("project_id", projectId);
  }
  const token = localStorage.getItem(MEMBER_TOKEN_KEY);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/api/upload/voice`);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
        if (event.loaded >= event.total && onUploadComplete) {
          onUploadComplete();
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
        return;
      }
      try {
        reject(new Error(parseErrorDetail(JSON.parse(xhr.responseText))));
      } catch {
        reject(new Error(`업로드 실패 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("서버 연결 오류"));
    xhr.send(form);
  });
}

export async function fetchJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  return res.json();
}

export async function fetchClientJobs(): Promise<JobArchiveItem[]> {
  const token = localStorage.getItem(MEMBER_TOKEN_KEY);
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${apiBase()}/api/jobs`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { jobs?: JobArchiveItem[] };
  return data.jobs || [];
}

export async function cancelClientJob(jobId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
}

export async function saveTranscript(
  jobId: string,
  transcript: TranscriptJson,
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript_json: transcript,
    }),
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

export function getApiUrl(): string {
  return apiBase();
}

export const MEMBER_TOKEN_KEY = "member_access_token";

export function bootstrapMemberTokenFromUrl(): boolean {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashToken = hashParams.get("token");
  const queryToken = new URLSearchParams(window.location.search).get("token");
  const token = hashToken || queryToken;
  if (!token) return false;

  localStorage.setItem(MEMBER_TOKEN_KEY, token);
  window.history.replaceState(null, "", window.location.pathname);
  return true;
}

export type MemberProfile = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
};

export function clearMemberSession(): void {
  localStorage.removeItem(MEMBER_TOKEN_KEY);
}

export async function fetchMemberMe(): Promise<MemberProfile | null> {
  const token = localStorage.getItem(MEMBER_TOKEN_KEY);
  if (!token) return null;

  const res = await fetch(`${apiBase()}/api/member/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) clearMemberSession();
    return null;
  }
  const data = await res.json();
  return data.member as MemberProfile;
}

export async function loginMember(email: string, password: string): Promise<MemberProfile> {
  const res = await fetch(`${apiBase()}/api/member/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data) || "로그인에 실패했습니다.");
  }
  localStorage.setItem(MEMBER_TOKEN_KEY, data.access_token);
  return data.member as MemberProfile;
}
