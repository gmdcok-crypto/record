const DEFAULT_REMOTE_API_URL = "https://record-production.up.railway.app";

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

export type TranscriptToken = {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker?: string | null;
  confidence?: number | null;
  uncertain?: boolean;
};

export type SelectedUploadSegment = {
  start_ms: number;
  end_ms: number;
  selected?: boolean;
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
  selected_segments?: SelectedUploadSegment[];
  has_inquiry?: boolean;
  admin_inquiry_badges?: string[];
};

export type AiDraftResponse = {
  status: string;
  job_id: string;
  workflow_status?: string;
  transcript_json: TranscriptJson;
};

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

export type AdminOverviewStats = {
  total_jobs: number;
  waiting_assignment: number;
  working: number;
  final_done: number;
  total_sales: number;
  total_settlements: number;
  outstanding: number;
};

export type AdminOverviewJob = {
  id: string;
  project_id?: string | null;
  client: string;
  title: string;
  filename: string;
  uploaded_at: string | null;
  assigned_at?: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  assignee: string;
  progress: number;
  duration: string;
  sales_amount: number;
  settlement_amount: number;
  payment_status: string;
  settlement_status: string;
  has_inquiry?: boolean;
  admin_inquiry_badges?: string[];
};

export type AdminOverviewTranscriber = {
  id: number;
  code: string;
  name: string;
  grade_level: number;
  phone: string | null;
  resident_id: string | null;
  bank_name: string | null;
  account_number: string | null;
  specialty: string | null;
  status: string;
  monthly_capacity: number | null;
  current_load: number;
  unit_price: number;
  quality_score: number;
  login_id: string | null;
  auth_status: string;
};

export type TranscriberGradeRate = {
  id: number;
  grade_level: number;
  per_minute_rate: number;
};

export type AdminOverviewSettlement = {
  id: number;
  month: string;
  transcriber_id?: number;
  transcriber: string | number;
  jobs: number;
  amount: number;
  total_paid_amount?: number;
  status: string;
  paid_at: string | null;
};

export type AdminOverviewSale = {
  id: number;
  payment_id: string;
  member_name: string;
  order_name: string;
  amount: number;
  pay_method: string | null;
  paid_at: string | null;
  status: string;
};

export type AdminOverviewProjectFile = {
  job_id: string;
  title: string;
  filename: string;
  status: string;
  uploaded_at: string | null;
  assigned_at?: string | null;
  due_at: string | null;
  assignee: string | null;
  assignee_code?: string | null;
  pdf_ready: boolean;
  has_inquiry?: boolean;
  admin_inquiry_badges?: string[];
};

export type AdminOverviewProject = {
  project_id: string;
  title: string;
  client: { id: number; name: string };
  status: string;
  file_count: number;
  completed_count: number;
  due_at: string | null;
  memo?: string | null;
  priority?: string;
  assignee?: string;
  assignee_code?: string | null;
  files?: AdminOverviewProjectFile[];
};

export type AdminOverviewMember = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  client_id: number | null;
  client_code: string;
  project_count: number;
  job_count: number;
};

export type AdminOverview = {
  stats: AdminOverviewStats;
  projects?: AdminOverviewProject[];
  members?: AdminOverviewMember[];
  jobs: AdminOverviewJob[];
  transcribers: AdminOverviewTranscriber[];
  transcriber_grade_rates?: TranscriberGradeRate[];
  settlements: AdminOverviewSettlement[];
  sales: AdminOverviewSale[];
};

function isNetlifyLikeHost(hostname: string): boolean {
  return hostname.endsWith(".netlify.app") || hostname.endsWith(".github.io");
}

function apiBase(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (isNetlifyLikeHost(host)) {
      return window.location.origin;
    }
  }
  const configured = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const { origin, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return origin;
  }
  return DEFAULT_REMOTE_API_URL;
}

export function getApiBaseUrl(): string {
  return apiBase();
}

export const ADMIN_TOKEN_KEY = "admin_access_token";

export type AdminRole = "owner" | "manager" | "operator" | "accounting" | "viewer";

export type AdminProfile = {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
  role_label: string;
  phone: string | null;
  is_active: boolean;
  menus: string[];
  permissions: string[];
  last_login_at: string | null;
};

export function clearAdminSession(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    clearAdminSession();
  }
  return response;
}

export async function loginAdmin(email: string, password: string): Promise<AdminProfile> {
  const res = await fetch(`${apiBase()}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "로그인에 실패했습니다");
  }
  const data = (await res.json()) as { access_token: string; admin: AdminProfile };
  localStorage.setItem(ADMIN_TOKEN_KEY, data.access_token);
  return data.admin;
}

export async function fetchAdminMe(): Promise<AdminProfile | null> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return null;
  try {
    const res = await adminFetch(`${apiBase()}/api/admin/auth/me`);
    if (!res.ok) return null;
    const data = (await res.json()) as { admin: AdminProfile };
    return data.admin;
  } catch {
    return null;
  }
}

export type AdminAccount = {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
  role_label: string;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
};

export async function fetchAdminUsers(): Promise<AdminAccount[]> {
  const res = await adminFetch(`${apiBase()}/api/admin/users`);
  if (!res.ok) {
    throw await parseApiError(res, "관리자 목록을 불러올 수 없습니다");
  }
  const data = (await res.json()) as { admins?: AdminAccount[] };
  return data.admins ?? [];
}

export async function createAdminUser(payload: {
  email: string;
  password: string;
  name: string;
  role: AdminRole;
  phone?: string;
}): Promise<AdminAccount> {
  const res = await adminFetch(`${apiBase()}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "관리자 추가 실패");
  }
  const data = (await res.json()) as { admin: AdminAccount };
  return data.admin;
}

export async function updateAdminUser(
  adminId: number,
  payload: {
    name?: string;
    role?: AdminRole;
    phone?: string | null;
    is_active?: boolean;
    password?: string;
  },
): Promise<AdminAccount> {
  const res = await adminFetch(`${apiBase()}/api/admin/users/${adminId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "관리자 수정 실패");
  }
  const data = (await res.json()) as { admin: AdminAccount };
  return data.admin;
}

export async function deactivateAdminUser(adminId: number): Promise<AdminAccount> {
  const res = await adminFetch(`${apiBase()}/api/admin/users/${adminId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await parseApiError(res, "관리자 비활성화 실패");
  }
  const data = (await res.json()) as { admin: AdminAccount };
  return data.admin;
}

export type ExpenseCategory = {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string | null;
};

export type ExpenseRecord = {
  id: number;
  category_id: number;
  category_name: string;
  amount: number;
  expense_date: string;
  note: string;
  source_type: string | null;
  source_id: string | null;
  created_by_admin_id: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ExpensesOverview = {
  categories: ExpenseCategory[];
  records: ExpenseRecord[];
};

export async function fetchExpensesOverview(params?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<ExpensesOverview> {
  const url = new URL(`${apiBase()}/api/admin/expenses`);
  if (params?.dateFrom) url.searchParams.set("date_from", params.dateFrom);
  if (params?.dateTo) url.searchParams.set("date_to", params.dateTo);
  const res = await adminFetch(url.toString());
  if (!res.ok) {
    throw await parseApiError(res, "지출 데이터를 불러올 수 없습니다");
  }
  return (await res.json()) as ExpensesOverview;
}

export async function createExpenseCategory(payload: {
  name: string;
  sort_order?: number;
}): Promise<ExpenseCategory> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출항목 추가 실패");
  }
  const data = (await res.json()) as { category: ExpenseCategory };
  return data.category;
}

export async function updateExpenseCategory(
  categoryId: number,
  payload: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<ExpenseCategory> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출항목 수정 실패");
  }
  const data = (await res.json()) as { category: ExpenseCategory };
  return data.category;
}

export async function deleteExpenseCategory(categoryId: number): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/categories/${categoryId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출항목 삭제 실패");
  }
}

export async function createExpenseRecord(payload: {
  category_id: number;
  amount: number;
  expense_date: string;
  note?: string;
}): Promise<ExpenseRecord> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출 입력 실패");
  }
  const data = (await res.json()) as { record: ExpenseRecord };
  return data.record;
}

export async function updateExpenseRecord(
  recordId: number,
  payload: {
    category_id?: number;
    amount?: number;
    expense_date?: string;
    note?: string;
  },
): Promise<ExpenseRecord> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/records/${recordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출 수정 실패");
  }
  const data = (await res.json()) as { record: ExpenseRecord };
  return data.record;
}

export async function deleteExpenseRecord(recordId: number): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/admin/expenses/records/${recordId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await parseApiError(res, "지출 삭제 실패");
  }
}

async function parseApiError(res: Response, fallback: string): Promise<Error> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const err = await res.json().catch(() => ({}));
    return new Error(err.detail || fallback);
  }

  const text = await res.text().catch(() => "");
  if (text.trimStart().startsWith("<!doctype") || text.trimStart().startsWith("<html")) {
    return new Error("API 대신 HTML이 반환되었습니다. VITE_API_URL 또는 배포 라우팅을 확인하세요.");
  }
  return new Error(fallback);
}

export function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${apiBase()}${path}`;
}

export function createAdminEventsSource(): EventSource {
  const url = new URL(`${apiBase()}/api/jobs/admin/events`);
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) url.searchParams.set("token", token);
  return new EventSource(url.toString());
}

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  user_agent?: string;
};

export async function fetchWebPushConfig(): Promise<{ enabled: boolean; vapidPublicKey: string }> {
  const res = await fetch(`${apiBase()}/api/public-config`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    webPushEnabled?: boolean;
    webPushVapidPublicKey?: string;
  };
  return {
    enabled: Boolean(data.webPushEnabled && data.webPushVapidPublicKey),
    vapidPublicKey: data.webPushVapidPublicKey?.trim() ?? "",
  };
}

export async function registerAdminPushSubscription(payload: PushSubscriptionPayload): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/push-subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "관리자 웹푸시 구독 실패");
  }
}

export async function unregisterAdminPushSubscription(payload: PushSubscriptionPayload): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/push-subscriptions`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "관리자 웹푸시 구독 해제 실패");
  }
}

export async function fetchJob(jobId: string): Promise<JobResponse> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}`);
  if (!res.ok) {
    throw await parseApiError(res, "작업을 불러올 수 없습니다");
  }
  return res.json();
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/overview`);
  if (!res.ok) {
    throw await parseApiError(res, "관리자 데이터를 불러올 수 없습니다");
  }
  return res.json();
}

export async function updateMemberActive(memberId: number, isActive: boolean): Promise<AdminOverviewMember> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "회원 상태 변경 실패");
  }
  const data = (await res.json()) as { member?: AdminOverviewMember };
  if (!data.member) {
    throw new Error("회원 상태 변경 실패");
  }
  return data.member;
}

export async function assignProject(
  projectId: string,
  transcriberCode: string,
  jobIds?: string[],
  note?: string,
  reassign = false,
): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/projects/${projectId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcriber_code: transcriberCode,
      job_ids: jobIds,
      note,
      reassign,
    }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "프로젝트 배정 실패");
  }
}

export async function assignJob(jobId: string, transcriberCode: string, note?: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcriber_code: transcriberCode, note }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "배정 실패");
  }
}

export async function updateJobStatus(jobId: string, status: string, note?: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/${jobId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "상태 변경 실패");
  }
}

export async function fetchNextTranscriberCode(): Promise<string> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcribers/next-code`);
  if (!res.ok) {
    throw await parseApiError(res, "속기사 코드 조회 실패");
  }
  const data = (await res.json()) as { code?: string };
  return data.code || "";
}

export async function updateTranscriber(
  transcriberCode: string,
  payload: {
    name?: string;
    grade_level?: number;
    specialty?: string;
    phone?: string;
    resident_id?: string;
    bank_name?: string;
    account_number?: string;
    unit_price?: number;
    monthly_capacity?: number;
    status?: string;
  },
): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcribers/${encodeURIComponent(transcriberCode)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "속기사 수정 실패");
  }
}

export async function createTranscriber(payload: {
  name: string;
  grade_level?: number;
  specialty?: string;
  phone?: string;
  resident_id?: string;
  bank_name?: string;
  account_number?: string;
  unit_price?: number;
  monthly_capacity?: number;
  status?: string;
}): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcribers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "속기사 추가 실패");
  }
}

export async function fetchTranscriberGradeRates(): Promise<TranscriberGradeRate[]> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcriber-grade-rates`);
  if (!res.ok) {
    throw await parseApiError(res, "등급별 요율 조회 실패");
  }
  const data = (await res.json()) as { rates?: TranscriberGradeRate[] };
  return data.rates ?? [];
}

export async function saveTranscriberGradeRate(payload: {
  grade_level: number;
  per_minute_rate: number;
}): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcriber-grade-rates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "등급별 요율 저장 실패");
  }
}

export async function deleteTranscriberGradeRate(rateId: number): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcriber-grade-rates/${rateId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await parseApiError(res, "등급별 요율 삭제 실패");
  }
}

export async function deleteTranscriber(transcriberCode: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/transcribers/${encodeURIComponent(transcriberCode)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await parseApiError(res, "속기사 삭제 실패");
  }
}

export async function revokeTranscriberAuth(transcriberCode: string): Promise<void> {
  const res = await adminFetch(
    `${apiBase()}/api/jobs/admin/transcribers/${encodeURIComponent(transcriberCode)}/revoke-auth`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw await parseApiError(res, "로그인 초기화 실패");
  }
}

export async function updateSettlementStatus(settlementId: number, status: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/settlements/${settlementId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "정산 상태 변경 실패");
  }
}

export async function recordSettlementPayment(settlementId: number, payload: { amount: number; note?: string }): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/settlements/${settlementId}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseApiError(res, "정산 처리 실패");
  }
}

export async function updateInvoiceStatus(invoiceId: number, status: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/invoices/${invoiceId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "매출 상태 변경 실패");
  }
}

export async function saveTranscript(jobId: string, transcript: TranscriptJson, saveKind = "draft"): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript, save_kind: saveKind }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "저장 실패");
  }
}

export async function fetchTranscriptChanges(jobId: string): Promise<TranscriptChangeEntry[]> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/transcript/changes`);
  if (!res.ok) {
    throw await parseApiError(res, "변경 이력 조회 실패");
  }
  const data = (await res.json()) as { entries?: TranscriptChangeEntry[] };
  return data.entries ?? [];
}

export async function runAiDraft(jobId: string): Promise<AiDraftResponse> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/ai-draft`, {
    method: "POST",
  });
  if (!res.ok) {
    throw await parseApiError(res, "AI 초벌 작업 실패");
  }
  return res.json();
}

export async function deliverDraftToClient(
  jobId: string,
  transcript: TranscriptJson,
): Promise<{ job_id: string; status: string; workflow_status?: string; transcript_json: TranscriptJson }> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/deliver-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "의뢰인 검토요청 실패");
  }
  return res.json();
}

export async function fetchAdminJobInquiries(jobId: string, threadType: "client_admin" | "transcriber_admin"): Promise<JobInquiryMessage[]> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/inquiries/${threadType}`);
  if (!res.ok) {
    throw await parseApiError(res, "문의 내역 조회 실패");
  }
  const data = (await res.json()) as { messages?: JobInquiryMessage[] };
  return data.messages ?? [];
}

export async function createAdminJobInquiry(
  jobId: string,
  threadType: "client_admin" | "transcriber_admin",
  message: string,
): Promise<JobInquiryMessage> {
  const res = await adminFetch(`${apiBase()}/api/jobs/admin/jobs/${jobId}/inquiries/${threadType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "문의 전송 실패");
  }
  const data = (await res.json()) as { message: JobInquiryMessage };
  return data.message;
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

export async function downloadTranscriptPdf(jobId: string, transcript: TranscriptJson): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "PDF 저장 실패");
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
  const res = await adminFetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript_json: transcript }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "최종 PDF 저장 실패");
  }
  return res.json();
}

export async function downloadFinalTranscriptPdf(jobId: string): Promise<void> {
  const res = await adminFetch(`${apiBase()}/api/jobs/${jobId}/transcript.pdf/final`);
  if (!res.ok) {
    throw await parseApiError(res, "최종 PDF 다운로드 실패");
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
        `<h3 data-segment-index="${index}" data-start-ms="${seg.start_ms ?? ""}" data-speaker-id="${escapeHtml(seg.speaker)}">${escapeHtml(speakerLabel(seg.speaker, labels))}</h3><p>${escapeHtml(seg.text)}</p>`,
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
    const headingText = heading.textContent?.replace(/\s*·\s*\d{2}:\d{2}\s*$/, "").trim() ?? "";
    const speakerMatch = headingText.match(/화자\s*(\S+)/);
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
