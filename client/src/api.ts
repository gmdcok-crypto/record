const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
const DEFAULT_REMOTE_API_URL = "https://record-production.up.railway.app";

export type TranscriptToken = {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker: string | null;
};

export type SelectedUploadSegment = {
  start_ms: number;
  end_ms: number;
  selected?: boolean;
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
  upload_method?: "direct" | "backend";
  transcript_text?: string | null;
  transcript_key?: string | null;
  transcript_json?: TranscriptJson | null;
  error?: string | null;
};

type PresignedUploadResponse = {
  job_id: string;
  object_key: string;
  upload_url: string;
  expires_in: number;
  bucket: string;
};

export type JobResponse = {
  job_id: string;
  project_id?: string | null;
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
  selected_segments?: SelectedUploadSegment[];
  has_inquiry?: boolean;
  client_inquiry_status?: "reply_pending" | "reply_arrived" | null;
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
  selected_segments?: SelectedUploadSegment[];
  has_inquiry?: boolean;
  client_inquiry_status?: "reply_pending" | "reply_arrived" | null;
};

export type HealthResponse = {
  status: string;
  soniox_configured?: boolean;
  r2_configured: boolean;
  bucket: string;
  database_configured?: boolean;
};

function apiBase(): string {
  if (API_URL) return API_URL;
  const { origin, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return origin;
  }
  return DEFAULT_REMOTE_API_URL;
}

export function createAdminEventsSource(): EventSource {
  return new EventSource(`${apiBase()}/api/jobs/admin/events`);
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

function normalizeNetworkError(error: unknown, fallback = "서버 연결 오류"): Error {
  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return new Error(fallback);
    }
    return error;
  }
  return new Error(fallback);
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
  throw normalizeNetworkError(lastError);
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
  final_pdf_filename?: string | null;
  has_inquiry?: boolean;
  client_inquiry_status?: "reply_pending" | "reply_arrived" | null;
};

export type ProjectSummary = {
  project_id: string;
  title: string;
  pdf_delivery_mode?: string;
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
  const res = await fetchWithRetry(`${apiBase()}/api/projects${query}`, { headers: memberAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = (await res.json()) as { projects?: ProjectSummary[] };
  return data.projects || [];
}

export async function createProject(title: string, memo?: string): Promise<ProjectSummary> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${apiBase()}/api/projects`,
      {
        method: "POST",
        headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title, memo }),
      },
      2,
    );
  } catch (error) {
    throw normalizeNetworkError(error, "프로젝트 생성 중 서버 연결에 실패했습니다.");
  }
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
  selectedSegments?: SelectedUploadSegment[],
): Promise<UploadResponse> {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uploadViaBackend = () =>
    new Promise<UploadResponse>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      if (projectId) {
        form.append("project_id", projectId);
      }
      if (selectedSegments?.length) {
        form.append("selected_segments_json", JSON.stringify(selectedSegments));
      }

      const token = localStorage.getItem(MEMBER_TOKEN_KEY);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBase()}/api/upload/voice`);
      xhr.setRequestHeader("X-Upload-Request-Id", requestId);
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
          resolve({
            ...(JSON.parse(xhr.responseText) as UploadResponse),
            upload_method: "backend",
          });
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

  const authHeaders = memberAuthHeaders();
  const contentType = file.type || "application/octet-stream";
  try {
    let presignRes: Response;
    try {
      presignRes = await fetchWithRetry(
        `${apiBase()}/api/upload/presign`,
        {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json", "X-Upload-Request-Id": requestId },
          body: JSON.stringify({
            filename: file.name,
            content_type: contentType,
            project_id: projectId ?? null,
            selected_segments: selectedSegments ?? [],
          }),
        },
        2,
      );
    } catch (error) {
      throw normalizeNetworkError(error, "업로드 준비 중 서버 연결에 실패했습니다.");
    }
    const presignData = (await presignRes.json().catch(() => ({}))) as Partial<PresignedUploadResponse>;
    if (
      !presignRes.ok ||
      !presignData.upload_url ||
      !presignData.job_id ||
      !presignData.object_key ||
      !presignData.bucket
    ) {
      throw new Error(parseErrorDetail(presignData));
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presignData.upload_url!);
      xhr.setRequestHeader("Content-Type", contentType);

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
          resolve();
          return;
        }
        reject(new Error(`업로드 실패 (${xhr.status})`));
      };

      xhr.onerror = () => reject(new Error("서버 연결 오류"));
      xhr.send(file);
    });

    let completeRes: Response;
    try {
      completeRes = await fetchWithRetry(
        `${apiBase()}/api/upload/voice/complete`,
        {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json", "X-Upload-Request-Id": requestId },
          body: JSON.stringify({
            job_id: presignData.job_id,
            object_key: presignData.object_key,
            filename: file.name,
            content_type: contentType,
            project_id: projectId ?? null,
            selected_segments: selectedSegments ?? [],
          }),
        },
        2,
      );
    } catch (error) {
      throw normalizeNetworkError(error, "업로드 완료 처리 중 서버 연결에 실패했습니다.");
    }
    const completeData = (await completeRes.json().catch(() => ({}))) as UploadResponse;
    if (!completeRes.ok) {
      throw new Error(parseErrorDetail(completeData));
    }
    return { ...completeData, upload_method: "direct" };
  } catch (directError) {
    console.warn("direct upload failed, falling back to backend upload", directError);
    try {
      return await uploadViaBackend();
    } catch (backendError) {
      const directMessage = directError instanceof Error ? directError.message : "직접 업로드 실패";
      const backendMessage = backendError instanceof Error ? backendError.message : "서버 경유 업로드 실패";
      throw new Error(
        `업로드 요청 ID: ${requestId}\n직접 업로드 실패 후 서버 경유 업로드도 실패했습니다.\n직접: ${directMessage}\n서버: ${backendMessage}`,
      );
    }
  }
}

export async function fetchJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`, {
    headers: memberAuthHeaders(),
  });
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
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
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
    headers: memberAuthHeaders(),
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

export async function fetchClientJobInquiries(jobId: string): Promise<JobInquiryMessage[]> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/inquiries/client`, {
    headers: memberAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return (data.messages ?? []) as JobInquiryMessage[];
}

export async function createClientJobInquiry(jobId: string, message: string): Promise<JobInquiryMessage> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/inquiries/client`, {
    method: "POST",
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
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

export async function downloadProjectFinalTranscriptPdf(projectId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/share/project/${encodeURIComponent(projectId)}/transcript.pdf/final`, {
    headers: memberAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const blob = await res.blob();
  const filename = parseFilenameFromDisposition(
    res.headers.get("Content-Disposition"),
    "project_bundle.pdf",
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

export function readPortOnePaymentIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("paymentId");
}

export function clearUrlQuery(): void {
  window.history.replaceState(null, "", window.location.pathname);
}

export type MemberProfile = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
};

export type PortOnePublicConfig = {
  portoneStoreId: string;
  portonePaymentChannelKey: string;
  portoneIdentityChannelKey: string;
  portoneEnv: string;
  portonePaymentEnabled: boolean;
  portoneIdentityEnabled: boolean;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  user_agent?: string;
};

export type TranscriptShareInfo = {
  token: string;
  expires_at: string;
  allow_audio: boolean;
  allow_pdf_download: boolean;
  final_pdf_url?: string;
};

export type SharedJobResponse = {
  job: JobResponse;
  share: TranscriptShareInfo;
};

export function clearMemberSession(): void {
  localStorage.removeItem(MEMBER_TOKEN_KEY);
}

export async function fetchMemberMe(): Promise<MemberProfile | null> {
  const token = localStorage.getItem(MEMBER_TOKEN_KEY);
  if (!token) return null;

  try {
    const res = await fetch(`${apiBase()}/api/member/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) clearMemberSession();
      return null;
    }
    const data = await res.json();
    return data.member as MemberProfile;
  } catch {
    clearMemberSession();
    return null;
  }
}

export async function fetchPortOnePublicConfig(): Promise<PortOnePublicConfig> {
  const res = await fetch(`${apiBase()}/api/public-config`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<PortOnePublicConfig>;
  return {
    portoneStoreId: data.portoneStoreId?.trim() ?? "",
    portonePaymentChannelKey: data.portonePaymentChannelKey?.trim() ?? "",
    portoneIdentityChannelKey: data.portoneIdentityChannelKey?.trim() ?? "",
    portoneEnv: data.portoneEnv?.trim() ?? "live",
    portonePaymentEnabled: Boolean(data.portonePaymentEnabled),
    portoneIdentityEnabled: Boolean(data.portoneIdentityEnabled),
  };
}

export async function fetchClientFrontendVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/api/client/version`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string | null };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export async function completePortOnePayment(input: {
  paymentId: string;
  amount: number;
  orderName: string;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${apiBase()}/api/member/auth/payments/complete`,
      {
        method: "POST",
        headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      3,
    );
  } catch (error) {
    throw normalizeNetworkError(error, "결제 확인 중 서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
}

export async function registerPushSubscription(input: PushSubscriptionInput): Promise<void> {
  const res = await fetch(`${apiBase()}/api/member/auth/push-subscriptions`, {
    method: "POST",
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
}

export async function unregisterPushSubscription(input: PushSubscriptionInput): Promise<void> {
  const res = await fetch(`${apiBase()}/api/member/auth/push-subscriptions`, {
    method: "DELETE",
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
}

export async function createTranscriptShare(
  jobId: string,
  options?: { allow_audio?: boolean; allow_pdf_download?: boolean },
): Promise<{ share_url: string; expires_at: string; token: string }> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/share`, {
    method: "POST",
    headers: { ...memberAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      allow_audio: options?.allow_audio ?? true,
      allow_pdf_download: options?.allow_pdf_download ?? true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return data as { share_url: string; expires_at: string; token: string };
}

export async function fetchSharedTranscript(token: string): Promise<SharedJobResponse> {
  const res = await fetch(`${apiBase()}/api/jobs/share/${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return data as SharedJobResponse;
}

export async function saveSharedTranscript(
  token: string,
  transcript: TranscriptJson,
  saveKind: string = "shared_edit",
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/share/${encodeURIComponent(token)}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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

export async function fetchSharedTranscriptChanges(token: string): Promise<TranscriptChangeEntry[]> {
  const res = await fetch(`${apiBase()}/api/jobs/share/${encodeURIComponent(token)}/transcript/changes`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorDetail(data));
  }
  return (data.entries ?? []) as TranscriptChangeEntry[];
}

export async function submitSharedReviewRequest(token: string, transcript: TranscriptJson): Promise<void> {
  const res = await fetch(`${apiBase()}/api/jobs/share/${encodeURIComponent(token)}/review-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript_json: transcript,
      save_kind: "review_request",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
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
