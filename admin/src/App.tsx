import { Fragment, useEffect, useMemo, useState } from "react";

import ActionNoticeModal, { type ActionNotice } from "./ActionNoticeModal";
import AdminLogin from "./AdminLogin";
import AdminTranscriptEditor from "./AdminTranscriptEditor";
import ExpenseManagement from "./ExpenseManagement";
import TranscriberSettlementPanel from "./TranscriberSettlementPanel";
import {
  assignProject,
  clearAdminSession,
  createTranscriber,
  createAdminUser,
  createAdminEventsSource,
  deactivateAdminUser,
  deleteTranscriber,
  deleteTranscriberGradeRate,
  fetchAdminMe,
  fetchAdminOverview,
  fetchAdminSales,
  fetchSalesMonthlyTarget,
  updateSalesMonthlyTarget,
  fetchAdminUsers,
  revokeTranscriberAuth,
  fetchTranscriberGradeRates,
  fetchNextTranscriberCode,
  fetchJob,
  saveTranscriberGradeRate,
  recordSettlementPayment,
  updateAdminUser,
  updateMemberActive,
  updateTranscriber,
  type AdminAccount,
  type AdminOverview,
  type AdminProfile,
  type AdminRole,
  type JobResponse,
  type SettlementSnapshotRow,
  type TranscriberGradeRate as ApiTranscriberGradeRate,
} from "./api";
import {
  enableAdminWebPush,
  getAdminNotificationPermissionState,
  hasRegisteredAdminPushSubscription,
} from "./webPush";
import { ADMIN_ROLES, adminRoleLabel, canAccessMenu, defaultMenuForRole } from "./permissions";
import { formatKstDateTime, getKstDateKey, todayKstDateKey } from "./formatKstDateTime";
import { isMobileLikeAdmin } from "./mobileEnvironment";

type AuthStatus = "loading" | "guest" | "authed";

type MenuKey =
  | "dashboard"
  | "jobs"
  | "transcribers"
  | "members"
  | "sales"
  | "expenses"
  | "reports"
  | "analytics"
  | "admins";

type JobStatus =
  | "배정 대기"
  | "속기사 작업 중"
  | "의뢰인 검토"
  | "속기사검토"
  | "녹취록 요청"
  | "PDF 전달";

type PaymentStatus = "미수" | "부분 입금" | "입금 완료";
type SettlementStatus = "정산 대기" | "정산 확정" | "지급 완료";
type TranscriberStatus = "작업 가능" | "작업 중" | "휴무" | "비활성";

type MenuItem = {
  key: MenuKey;
  label: string;
  count?: string;
};

type JobItem = {
  id: string;
  projectId: string | null;
  client: string;
  title: string;
  filename: string;
  uploadedAt: string;
  assignedAt: string;
  dueAt: string;
  priority: "일반" | "긴급";
  status: JobStatus;
  assignee: string;
  progress: number;
  duration: string;
  salesAmount: number;
  settlementAmount: number;
  paymentStatus: PaymentStatus;
  settlementStatus: SettlementStatus;
};

type ProjectFileItem = {
  id: string;
  title: string;
  filename: string;
  status: JobStatus;
  assignee: string;
  assigneeCode: string | null;
  assignedAt: string;
  dueAt: string;
  salesAmount: number;
  paymentStatus: PaymentStatus;
  has_inquiry?: boolean;
  admin_inquiry_badges?: string[];
};

type ProjectItem = {
  id: string;
  title: string;
  client: string;
  dueAt: string;
  statusLabel: string;
  rawStatus: string;
  fileCount: number;
  completedCount: number;
  assignee: string;
  assigneeCode: string | null;
  files: ProjectFileItem[];
};

type MemberItem = {
  id: number;
  email: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  clientId: number | null;
  clientCode: string;
  projectCount: number;
  jobCount: number;
};

type Transcriber = {
  numericId: number;
  id: string;
  name: string;
  gradeLevel: number;
  phone: string;
  residentId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  specialty: string;
  status: TranscriberStatus;
  activeJobs: number;
  monthlyCapacity: number;
  unitPrice: string;
  qualityScore: string;
  loginId: string;
  authStatus: "active" | "pending_signup";
};

type TranscriberForm = {
  code: string;
  name: string;
  gradeLevel: string;
  phone: string;
  residentId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
};

const EMPTY_TRANSCRIBER_FORM: TranscriberForm = {
  code: "",
  name: "",
  gradeLevel: "1",
  phone: "",
  residentId: "",
  bankName: "",
  accountHolder: "",
  accountNumber: "",
};

type AdminForm = {
  email: string;
  password: string;
  name: string;
  role: AdminRole;
  phone: string;
  isActive: boolean;
};

const EMPTY_ADMIN_FORM: AdminForm = {
  email: "",
  password: "",
  name: "",
  role: "operator",
  phone: "",
  isActive: true,
};

type SettlementItem = {
  id: number;
  month: string;
  transcriberId: number | null;
  transcriber: string;
  jobs: number;
  amount: number;
  incomeTax: number;
  localTax: number;
  totalWithholding: number;
  netPayAmount: number;
  totalPaidAmount: number;
  status: SettlementStatus;
  paidAt: string;
};

type GradeRateItem = {
  id: number;
  gradeLevel: number;
  perMinuteRate: number;
};

type SalesItem = {
  id: number;
  paymentId: string;
  memberName: string;
  orderName: string;
  amount: number;
  payMethod: string;
  paidAt: string;
  paidAtKey: string | null;
  status: string;
};

const MENU_BASE: Array<Omit<MenuItem, "count">> = [
  { key: "dashboard", label: "대시보드" },
  { key: "jobs", label: "의뢰 / 파일 관리" },
  { key: "transcribers", label: "속기사 관리" },
  { key: "members", label: "회원 관리" },
  { key: "sales", label: "매출 관리" },
  { key: "expenses", label: "지출 관리" },
  { key: "reports", label: "집계" },
  { key: "analytics", label: "분석" },
  { key: "admins", label: "관리자 관리" },
];

function notifyAdminEvent(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // ignore browser notification failures
  }
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatSalesMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}년 ${Number(month)}월`;
}

function formatSalesMonthShort(monthKey: string): string {
  return `(${Number(monthKey.split("-")[1])}월)`;
}

function addMonthsToMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function buildSalesMonthOptions(reference = new Date()): Array<{ value: string; label: string }> {
  const current = todayKstDateKey(reference).slice(0, 7);
  const start = addMonthsToMonthKey(current, -12);
  const end = addMonthsToMonthKey(current, 12);
  const options: Array<{ value: string; label: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    options.push({ value: cursor, label: formatSalesMonthKey(cursor) });
    cursor = addMonthsToMonthKey(cursor, 1);
  }
  return options;
}

function mapProjectStatusLabel(status: string): string {
  switch (status) {
    case "waiting_assignment":
      return "배정 대기";
    case "working":
      return "작업 중";
    case "client_review":
      return "의뢰인 검토";
    case "completed":
      return "완료";
    case "empty":
      return "파일 없음";
    default:
      return status;
  }
}

function projectStatusTone(rawStatus: string): string {
  switch (rawStatus) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300";
    case "client_review":
      return "bg-violet-500/15 text-violet-300";
    case "working":
      return "bg-blue-500/15 text-blue-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function projectAssignButtonLabel(project: ProjectItem): string {
  return project.assignee !== "-" ? "배정변경" : "프로젝트 배정";
}

function projectIsReassignMode(project: ProjectItem): boolean {
  return project.assignee !== "-";
}

function isFinalFileStatus(status: JobStatus): boolean {
  return status === "PDF 전달";
}

function isInProgressFileStatus(status: JobStatus): boolean {
  return status !== "배정 대기" && !isFinalFileStatus(status);
}

function assignableProjectFiles(project: ProjectItem, reassign: boolean): ProjectFileItem[] {
  return project.files.filter((file) => {
    if (isFinalFileStatus(file.status)) return false;
    if (reassign) return true;
    return file.status === "배정 대기" || file.status === "녹취록 요청" || file.status === "속기사검토";
  });
}

function defaultTranscriberCodeForProject(project: ProjectItem, people: Transcriber[]): string {
  if (project.assigneeCode) return project.assigneeCode;
  if (project.assignee !== "-" && project.assignee !== "복수") {
    const matched = people.find((person) => person.name === project.assignee);
    if (matched) return matched.id;
  }
  const assignedFile = project.files.find((file) => file.assigneeCode || (file.assignee && file.assignee !== "-"));
  if (assignedFile?.assigneeCode) return assignedFile.assigneeCode;
  if (assignedFile?.assignee && assignedFile.assignee !== "-") {
    const matched = people.find((person) => person.name === assignedFile.assignee);
    if (matched) return matched.id;
  }
  return people[0]?.id ?? "";
}

function mapJobStatus(status: string): JobStatus {
  switch (normalizeWorkflowStatus(status)) {
    case "waiting_assignment":
      return "배정 대기";
    case "working":
      return "속기사 작업 중";
    case "client_review":
      return "의뢰인 검토";
    case "transcriber_review":
      return "속기사검토";
    case "transcript_request":
      return "녹취록 요청";
    case "pdf_sent":
      return "PDF 전달";
    default:
      return "배정 대기";
  }
}

function normalizeWorkflowStatus(status: string | undefined | null): string {
  switch (status ?? "") {
    case "uploaded":
      return "waiting_assignment";
    case "assigned":
      return "working";
    case "first_done":
    case "client_editing":
      return "client_review";
    case "review_waiting":
      return "transcript_request";
    case "final_done":
      return "pdf_sent";
    default:
      return status ?? "";
  }
}

function mapPaymentStatus(status: string): PaymentStatus {
  switch (status) {
    case "paid":
      return "입금 완료";
    case "partial_paid":
      return "부분 입금";
    default:
      return "미수";
  }
}

function mapSettlementStatus(status: string): SettlementStatus {
  switch (status) {
    case "paid":
      return "지급 완료";
    case "confirmed":
      return "정산 확정";
    default:
      return "정산 대기";
  }
}

function mapTranscriberStatus(status: string, currentLoad: number): TranscriberStatus {
  if (status === "inactive") return "비활성";
  if (status === "vacation" || status === "off") return "휴무";
  if (status === "working" || currentLoad > 0) return "작업 중";
  return "작업 가능";
}

function mapAuthStatusLabel(authStatus: string): string {
  return authStatus === "active" ? "로그인 활성" : "재가입 필요";
}

function authStatusTone(authStatus: string): string {
  return authStatus === "active"
    ? "bg-emerald-500/15 text-emerald-300"
    : "bg-amber-500/15 text-amber-300";
}

function statusTone(status: JobStatus | SettlementStatus | PaymentStatus | TranscriberStatus): string {
  switch (status) {
    case "PDF 전달":
    case "입금 완료":
    case "지급 완료":
    case "작업 가능":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20";
    case "속기사 작업 중":
    case "작업 중":
    case "정산 확정":
      return "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/20";
    case "배정 대기":
    case "녹취록 요청":
    case "속기사검토":
    case "정산 대기":
    case "미수":
    case "휴무":
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20";
    case "의뢰인 검토":
    case "부분 입금":
      return "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/20";
    default:
      return "bg-slate-700 text-slate-200 ring-1 ring-slate-600";
  }
}

function StatCard({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight text-white">{value}</p>
        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
          {change}
        </span>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/92 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone = "slate",
  compact = false,
}: {
  label: string;
  value: string;
  tone?: "slate" | "cyan" | "amber" | "emerald" | "violet";
  compact?: boolean;
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200"
      : tone === "amber"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
        : tone === "emerald"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
          : tone === "violet"
            ? "border-violet-500/25 bg-violet-500/10 text-violet-200"
            : "border-slate-700 bg-slate-800/80 text-slate-200";

  return (
    <div className={`rounded-xl border ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${toneClass}`}>
      <p className={`font-semibold uppercase tracking-[0.16em] text-slate-400 ${compact ? "text-[9px]" : "text-[10px]"}`}>
        {label}
      </p>
      <p className={`font-semibold text-white ${compact ? "mt-0.5 text-[12px] leading-tight" : "mt-1 text-sm"}`}>
        {value}
      </p>
    </div>
  );
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuKey>("dashboard");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"전체" | JobStatus>("전체");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [adminPushPermission, setAdminPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [adminPushRegistered, setAdminPushRegistered] = useState(false);
  const [adminPushLoading, setAdminPushLoading] = useState(false);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<JobResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignProjectTarget, setAssignProjectTarget] = useState<ProjectItem | null>(null);
  const [detailProject, setDetailProject] = useState<ProjectItem | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [detailMember, setDetailMember] = useState<MemberItem | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [selectedTranscriberCode, setSelectedTranscriberCode] = useState("");
  const [selectedAssignJobIds, setSelectedAssignJobIds] = useState<string[]>([]);
  const [transcriberModalOpen, setTranscriberModalOpen] = useState(false);
  const [editingTranscriberId, setEditingTranscriberId] = useState<string | null>(null);
  const [transcriberForm, setTranscriberForm] = useState<TranscriberForm>(EMPTY_TRANSCRIBER_FORM);
  const [gradeRateModalOpen, setGradeRateModalOpen] = useState(false);
  const [gradeRateForm, setGradeRateForm] = useState({ gradeLevel: "1", perMinuteRate: "" });
  const [settlementPayTarget, setSettlementPayTarget] = useState<SettlementItem | null>(null);
  const [settlementPayAmount, setSettlementPayAmount] = useState("");
  const [settlementPayNote, setSettlementPayNote] = useState("");
  const [settlementPanelRefresh, setSettlementPanelRefresh] = useState(0);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [adminAccountsLoading, setAdminAccountsLoading] = useState(false);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState<number | null>(null);
  const [adminForm, setAdminForm] = useState<AdminForm>(EMPTY_ADMIN_FORM);
  const [salesDateFrom, setSalesDateFrom] = useState(() => todayKstDateKey());
  const [salesDateTo, setSalesDateTo] = useState(() => todayKstDateKey());
  const [salesTargetInput, setSalesTargetInput] = useState("");
  const [salesTargetLoading, setSalesTargetLoading] = useState(false);
  const [salesTargetModalOpen, setSalesTargetModalOpen] = useState(false);
  const [salesTargetModalMonth, setSalesTargetModalMonth] = useState(() => todayKstDateKey().slice(0, 7));
  const [salesTargetModalInput, setSalesTargetModalInput] = useState("");
  const [salesTargetModalLoading, setSalesTargetModalLoading] = useState(false);
  const [salesTargetModalSaving, setSalesTargetModalSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const admin = await fetchAdminMe();
      if (admin) {
        setAdminProfile(admin);
        setActiveMenu(defaultMenuForRole(admin.role) as MenuKey);
        setAuthStatus("authed");
        return;
      }
      setAuthStatus("guest");
      setLoading(false);
    })();
  }, []);

  const handleLoginSuccess = (admin: AdminProfile) => {
    setAdminProfile(admin);
    setActiveMenu(defaultMenuForRole(admin.role) as MenuKey);
    setAuthStatus("authed");
  };

  const handleLogout = () => {
    clearAdminSession();
    setAdminProfile(null);
    setOverview(null);
    setAuthStatus("guest");
    setLoading(false);
  };

  const loadOverview = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    try {
      if (!silent) {
        setLoading(true);
      }
      const [data, sales] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminSales().catch((err) => {
          console.error(err);
          return [];
        }),
      ]);
      setOverview({
        ...data,
        sales: sales.length > 0 ? sales : (data.sales ?? []),
      });
      return data;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      if (!silent) {
      setLoading(false);
    }
    }
  };

  useEffect(() => {
    void (async () => {
      const permission = await getAdminNotificationPermissionState();
      setAdminPushPermission(permission);
      if (permission === "unsupported") {
        setAdminPushRegistered(false);
        return;
      }
      const registered = await hasRegisteredAdminPushSubscription().catch(() => false);
      setAdminPushRegistered(registered);
    })();
  }, []);

  useEffect(() => {
    if (authStatus !== "authed" || !adminProfile) return;
    let alive = true;

    const initialLoad = async () => {
      if (!alive) return;
      setLoading(true);
      try {
        const [data, sales] = await Promise.all([
          fetchAdminOverview(),
          fetchAdminSales().catch((err) => {
            console.error(err);
            return [];
          }),
        ]);
        if (!alive) return;
        setOverview({
          ...data,
          sales: sales.length > 0 ? sales : (data.sales ?? []),
        });
        const queryParams = new URLSearchParams(window.location.search);
        const queryJobId = queryParams.get("job_id");
        if (queryJobId) {
          setActiveMenu("jobs");
          void openDetailModal(queryJobId);
        } else if (queryParams.get("menu") === "members") {
          setActiveMenu("members");
        } else if (queryParams.get("menu") === "admins") {
          setActiveMenu("admins");
        }
      } catch (err) {
        if (!alive) return;
        console.error(err);
      } finally {
        if (alive) setLoading(false);
      }
    };

    const refreshVisibleData = () => {
      if (document.visibilityState === "visible") {
        void loadOverview({ silent: true });
      }
    };

    void initialLoad();

    const eventSource = createAdminEventsSource();
    eventSource.addEventListener("admin_update", (event) => {
      if (!alive) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data || "{}") as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (payload.type === "member_created") {
          const name = String(payload.payload?.name ?? "신규 회원");
          notifyAdminEvent("신규 회원 가입", `${name} 님이 가입했습니다.`);
        }
        if (payload.type === "payment_recorded") {
          const memberName = String(payload.payload?.member_name ?? "의뢰인");
          const orderName = String(payload.payload?.order_name ?? "결제");
          const amount = Number(payload.payload?.amount ?? 0);
          notifyAdminEvent(
            "매출 발생",
            `${memberName} · ${orderName} · ${amount.toLocaleString("ko-KR")}원`,
          );
        }
        if (payload.type === "job_inquiry_created" && payload.payload?.sender_role === "client") {
          notifyAdminEvent("의뢰인 문의 도착", "의뢰인이 관리자에게 새 문의를 남겼습니다.");
        }
        if (payload.type === "job_updated" && payload.payload?.status === "transcript_request") {
          notifyAdminEvent("녹취록 요청", "의뢰인이 녹취록 요청을 보냈습니다.");
        }
        if (
          payload.type === "job_updated" &&
          (payload.payload?.status === "transcriber_review" ||
            payload.payload?.status === "review_waiting")
        ) {
          notifyAdminEvent("속기사 검토 요청", "의뢰인이 속기사 검토를 요청했습니다.");
        }
      } catch {
        // ignore malformed SSE payloads
      }
      void loadOverview({ silent: true });
    });
    eventSource.addEventListener("error", () => {
      console.error("admin SSE connection error");
    });

    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);

    return () => {
      alive = false;
      eventSource.close();
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, [authStatus, adminProfile?.id]);

  useEffect(() => {
    if (!adminProfile) return;
    if (!canAccessMenu(adminProfile.role, activeMenu)) {
      setActiveMenu(defaultMenuForRole(adminProfile.role) as MenuKey);
    }
  }, [adminProfile, activeMenu]);

  const loadAdminAccounts = async () => {
    setAdminAccountsLoading(true);
    try {
      const rows = await fetchAdminUsers();
      setAdminAccounts(rows);
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "관리자 목록을 불러올 수 없습니다.");
    } finally {
      setAdminAccountsLoading(false);
    }
  };

  useEffect(() => {
    if (authStatus !== "authed" || activeMenu !== "admins") return;
    void loadAdminAccounts();
  }, [authStatus, activeMenu]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (
      event: MessageEvent<{ type?: string; payload?: { jobId?: string | null; kind?: string } }>,
    ) => {
      if (event.data?.type !== "ADMIN_WEB_PUSH_NOTIFICATION_CLICK") return;
      if (event.data?.payload?.kind === "admin_member_signup") {
        setActiveMenu("members");
        return;
      }
      if (event.data?.payload?.kind === "admin_payment_recorded") {
        setActiveMenu("sales");
        return;
      }
      const jobId = event.data?.payload?.jobId;
      if (!jobId) return;
      setActiveMenu("jobs");
      void openDetailModal(jobId);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, []);

  const jobs = useMemo<JobItem[]>(() => {
    return (overview?.jobs ?? []).map((job) => ({
      id: job.id,
      projectId: (job as { project_id?: string | null }).project_id ?? null,
      client: job.client,
      title: job.title,
      filename: job.filename,
      uploadedAt: job.uploaded_at ? formatKstDateTime(job.uploaded_at) : "-",
      assignedAt: job.assigned_at ? formatKstDateTime(job.assigned_at) : "-",
      dueAt: job.due_at ? formatKstDateTime(job.due_at) : "-",
      priority: job.priority === "urgent" ? "긴급" : "일반",
      status: mapJobStatus(job.status),
      assignee: job.assignee || "-",
      progress: job.progress,
      duration: job.duration,
      salesAmount: job.sales_amount,
      settlementAmount: job.settlement_amount,
      paymentStatus: mapPaymentStatus(job.payment_status),
      settlementStatus: mapSettlementStatus(job.settlement_status),
    }));
  }, [overview]);

  const members = useMemo<MemberItem[]>(() => {
    return (overview?.members ?? []).map((member) => ({
      id: member.id,
      email: member.email,
      name: member.name,
      phone: member.phone || "-",
      isActive: member.is_active,
      createdAt: formatKstDateTime(member.created_at),
      clientId: member.client_id,
      clientCode: member.client_code,
      projectCount: member.project_count,
      jobCount: member.job_count,
    }));
  }, [overview]);

  const projects = useMemo<ProjectItem[]>(() => {
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    return (overview?.projects ?? []).map((project) => ({
      id: project.project_id,
      title: project.title,
      client: project.client.name,
      dueAt: formatKstDateTime(project.due_at),
      statusLabel: mapProjectStatusLabel(project.status),
      rawStatus: project.status,
      fileCount: project.file_count,
      completedCount: project.completed_count,
      assignee: project.assignee || "-",
      assigneeCode: project.assignee_code ?? null,
      files: (project.files ?? []).map((file) => {
        const job = jobById.get(file.job_id);
        return {
          id: file.job_id,
          title: file.title,
          filename: file.filename,
          status: mapJobStatus(file.status),
          assignee: file.assignee || job?.assignee || "-",
          assigneeCode: file.assignee_code ?? null,
          assignedAt: file.assigned_at ? formatKstDateTime(file.assigned_at) : job?.assignedAt || "-",
          dueAt: formatKstDateTime(file.due_at),
          salesAmount: job?.salesAmount ?? 0,
          paymentStatus: job?.paymentStatus ?? "미수",
          has_inquiry: file.has_inquiry ?? false,
          admin_inquiry_badges: file.admin_inquiry_badges ?? [],
        };
      }),
    }));
  }, [overview, jobs]);

  const transcribers = useMemo<Transcriber[]>(() => {
    return (overview?.transcribers ?? []).map((person) => ({
      numericId: person.id,
      id: person.code,
      name: person.name,
      gradeLevel: person.grade_level || 1,
      phone: person.phone || "",
      residentId: person.resident_id || "",
      bankName: person.bank_name || "",
      accountHolder: person.account_holder || "",
      accountNumber: person.account_number || "",
      specialty: person.specialty || "-",
      status: mapTranscriberStatus(person.status, person.current_load),
      activeJobs: person.current_load,
      monthlyCapacity: person.monthly_capacity ?? 0,
      unitPrice: `분당 ${Math.round(person.unit_price).toLocaleString("ko-KR")}원`,
      qualityScore: `${person.quality_score.toFixed(1)} / 5`,
      loginId: person.login_id || "-",
      authStatus: person.auth_status === "active" ? "active" : "pending_signup",
    }));
  }, [overview]);

  const transcriberGradeRates = useMemo<GradeRateItem[]>(
    () =>
      (overview?.transcriber_grade_rates ?? []).map((item: ApiTranscriberGradeRate) => ({
        id: item.id,
        gradeLevel: item.grade_level,
        perMinuteRate: item.per_minute_rate,
      })),
    [overview],
  );

  const sales = useMemo<SalesItem[]>(() => {
    return (overview?.sales ?? []).map((item) => {
      const paidAtSource = item.paid_at ?? item.created_at ?? null;
      return {
        id: item.id,
        paymentId: item.payment_id,
        memberName: item.member_name,
        orderName: item.order_name,
        amount: item.amount,
        payMethod: item.pay_method || "-",
        paidAt: paidAtSource ? formatKstDateTime(paidAtSource) : "-",
        paidAtKey: getKstDateKey(paidAtSource),
        status: item.status,
      };
    });
  }, [overview]);

  const filteredSales = useMemo(() => {
    return sales.filter((item) => {
      if (!item.paidAtKey) return true;
      return item.paidAtKey >= salesDateFrom && item.paidAtKey <= salesDateTo;
    });
  }, [sales, salesDateFrom, salesDateTo]);

  const salesSummaryMetrics = useMemo(() => {
    const dailyDateKey = salesDateFrom === salesDateTo ? salesDateFrom : salesDateTo;
    const monthPrefix = dailyDateKey.slice(0, 7);
    let dailyTotal = 0;
    let monthlyTotal = 0;
    for (const item of sales) {
      if (!item.paidAtKey) continue;
      if (item.paidAtKey === dailyDateKey) {
        dailyTotal += item.amount;
      }
      if (item.paidAtKey.startsWith(monthPrefix)) {
        monthlyTotal += item.amount;
      }
    }
    return { dailyTotal, monthlyTotal };
  }, [sales, salesDateFrom, salesDateTo]);

  const salesMonthKey = useMemo(() => {
    const dailyDateKey = salesDateFrom === salesDateTo ? salesDateFrom : salesDateTo;
    return dailyDateKey.slice(0, 7);
  }, [salesDateFrom, salesDateTo]);

  const salesTargetAmount = useMemo(() => {
    const digits = salesTargetInput.replace(/[^\d]/g, "");
    if (!digits) return 0;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [salesTargetInput]);

  const salesAchievementRate = useMemo(() => {
    if (salesTargetAmount <= 0) return null;
    return Math.round((salesSummaryMetrics.monthlyTotal / salesTargetAmount) * 1000) / 10;
  }, [salesSummaryMetrics.monthlyTotal, salesTargetAmount]);

  const salesMonthOptions = useMemo(() => buildSalesMonthOptions(), []);

  const salesTargetModalAmount = useMemo(() => {
    const digits = salesTargetModalInput.replace(/[^\d]/g, "");
    if (!digits) return 0;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [salesTargetModalInput]);

  useEffect(() => {
    if (activeMenu !== "sales" || authStatus !== "authed") return;
    let cancelled = false;
    const loadTarget = async () => {
      setSalesTargetLoading(true);
      try {
        const data = await fetchSalesMonthlyTarget(salesMonthKey);
        if (cancelled) return;
        setSalesTargetInput(
          data.target_amount > 0 ? String(Math.round(data.target_amount)) : "",
        );
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setSalesTargetLoading(false);
        }
      }
    };
    void loadTarget();
    return () => {
      cancelled = true;
    };
  }, [activeMenu, authStatus, salesMonthKey]);

  useEffect(() => {
    if (!salesTargetModalOpen) return;
    let cancelled = false;
    const loadModalTarget = async () => {
      setSalesTargetModalLoading(true);
      try {
        const data = await fetchSalesMonthlyTarget(salesTargetModalMonth);
        if (cancelled) return;
        setSalesTargetModalInput(
          data.target_amount > 0 ? String(Math.round(data.target_amount)) : "",
        );
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setSalesTargetModalLoading(false);
        }
      }
    };
    void loadModalTarget();
    return () => {
      cancelled = true;
    };
  }, [salesTargetModalOpen, salesTargetModalMonth]);

  const openSalesTargetModal = () => {
    setSalesTargetModalMonth(salesMonthKey);
    setSalesTargetModalOpen(true);
  };

  const closeSalesTargetModal = () => {
    setSalesTargetModalOpen(false);
  };

  const saveSalesTargetModal = async () => {
    if (salesTargetModalSaving) return;
    setSalesTargetModalSaving(true);
    try {
      const data = await updateSalesMonthlyTarget(salesTargetModalMonth, salesTargetModalAmount);
      if (salesTargetModalMonth === salesMonthKey) {
        setSalesTargetInput(data.target_amount > 0 ? String(Math.round(data.target_amount)) : "");
      }
      setActionNotice({
        kind: "success",
        message: `${formatSalesMonthKey(salesTargetModalMonth)} 매출 목표를 저장했습니다.`,
      });
      closeSalesTargetModal();
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "매출 목표 저장 중 오류가 발생했습니다.");
    } finally {
      setSalesTargetModalSaving(false);
    }
  };

  const runAdminAction = async (successMessage: string, action: () => Promise<void>) => {
    try {
      await action();
      await loadOverview();
      setActionNotice({ kind: "success", message: successMessage });
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  const enableAdminPushNotifications = async () => {
    setAdminPushLoading(true);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        setActionNotice({
          kind: "info",
          title: "알림 허용 필요",
          message: isMobileLikeAdmin()
            ? "화면에 나타나는 알림 허용 요청을 눌러 주세요."
            : "브라우저 상단 또는 주소창 옆의 알림 허용 창을 확인해 주세요.",
        });
      }

      const result = await enableAdminWebPush();
      const permission = await getAdminNotificationPermissionState();
      setAdminPushPermission(permission);
      const registered = await hasRegisteredAdminPushSubscription().catch(() => false);
      setAdminPushRegistered(registered);

      if (result === "enabled") {
        setActionNotice({
          kind: "success",
          title: "관리자 알림 등록 완료",
          message: "이 브라우저에서 신규 회원 가입, 의뢰인 문의, 검토 요청을 웹푸시로 받습니다.",
        });
        return;
      }
      if (result === "disabled") {
        throw new Error("서버 웹푸시 설정이 아직 완료되지 않았습니다.");
      }
      if (result === "denied") {
        throw new Error("브라우저 알림 권한이 차단되어 있습니다.");
      }
      throw new Error("이 브라우저에서는 웹푸시를 사용할 수 없습니다.");
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "관리자 웹푸시 등록 중 오류가 발생했습니다.");
    } finally {
      setAdminPushLoading(false);
    }
  };

  const openDetailModal = async (jobId: string) => {
    try {
      setDetailJobId(jobId);
      setDetailJob(null);
      setDetailLoading(true);
      const data = await fetchJob(jobId);
      setDetailJob(data);
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "작업을 불러올 수 없습니다.");
      closeDetailModal();
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetailModal = () => {
    setDetailJobId(null);
    setDetailJob(null);
    setDetailLoading(false);
  };

  const openProjectDetailModal = (project: ProjectItem) => {
    setDetailProject(project);
  };

  const closeProjectDetailModal = () => {
    setDetailProject(null);
  };

  const openFileDetailFromProject = (jobId: string) => {
    closeProjectDetailModal();
    void openDetailModal(jobId);
  };

  const openAssignProjectModal = (project: ProjectItem) => {
    const reassign = projectIsReassignMode(project);
    const assignableFiles = assignableProjectFiles(project, reassign);
    setAssignProjectTarget(project);
    setSelectedTranscriberCode(defaultTranscriberCodeForProject(project, transcribers));
    setSelectedAssignJobIds(assignableFiles.map((file) => file.id));
  };

  const closeAssignModal = () => {
    setAssignProjectTarget(null);
    setSelectedTranscriberCode("");
    setSelectedAssignJobIds([]);
  };

  const toggleAssignJobSelection = (jobId: string) => {
    setSelectedAssignJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId],
    );
  };

  const confirmAssignModal = async () => {
    if (!selectedTranscriberCode || !assignProjectTarget) return;

    const reassign = projectIsReassignMode(assignProjectTarget);
    const assignableFiles = assignableProjectFiles(assignProjectTarget, reassign);
    const selectedFiles = assignableFiles.filter((file) => selectedAssignJobIds.includes(file.id));

    if (selectedFiles.length === 0) {
      window.alert("배정할 파일을 하나 이상 선택해 주세요.");
      return;
    }

    const selectedTranscriber = transcribers.find((person) => person.id === selectedTranscriberCode);
    const inProgressFiles = selectedFiles.filter((file) => isInProgressFileStatus(file.status));

    if (reassign && inProgressFiles.length > 0) {
      const confirmed = window.confirm(
        `진행 중인 파일 ${inProgressFiles.length}개를 ${selectedTranscriber?.name ?? "선택한 속기사"}에게 재배정합니다.\n계속하시겠습니까?`,
      );
      if (!confirmed) return;
    }

    await runAdminAction(reassign ? "배정이 변경되었습니다." : "프로젝트 배정이 완료되었습니다.", async () => {
      await assignProject(
        assignProjectTarget.id,
        selectedTranscriberCode,
        selectedFiles.map((file) => file.id),
        reassign ? "관리자 배정 변경" : "관리자 프로젝트 일괄 배정",
        reassign,
      );
    });
    closeAssignModal();
  };

  const openSettlementPayModal = (item: SettlementItem) => {
    setSettlementPayTarget(item);
    const remaining = Math.max(0, Math.round(item.netPayAmount - item.totalPaidAmount));
    setSettlementPayAmount(remaining > 0 ? String(remaining) : "");
    setSettlementPayNote("");
  };

  const openSettlementPayFromSnapshot = (row: SettlementSnapshotRow) => {
    if (!row.settlement_id) return;
    openSettlementPayModal({
      id: row.settlement_id,
      month: row.month,
      transcriberId: row.transcriber_id,
      transcriber: row.transcriber_name,
      jobs: row.jobs,
      amount: row.amount,
      incomeTax: row.income_tax,
      localTax: row.local_tax,
      totalWithholding: row.total_withholding,
      netPayAmount: row.net_pay_amount,
      totalPaidAmount: row.total_paid_amount,
      status: mapSettlementStatus(row.status),
      paidAt: row.paid_at ? formatKstDateTime(row.paid_at) : "-",
    });
  };

  const closeSettlementPayModal = () => {
    setSettlementPayTarget(null);
    setSettlementPayAmount("");
    setSettlementPayNote("");
  };

  const submitSettlementPayment = async () => {
    if (!settlementPayTarget) return;
    const amount = Number(settlementPayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("입금액은 0보다 큰 숫자로 입력해 주세요.");
      return;
    }
    await runAdminAction("정산 처리되었습니다.", async () => {
      await recordSettlementPayment(settlementPayTarget.id, {
        amount,
        note: settlementPayNote.trim() || undefined,
      });
    });
    closeSettlementPayModal();
    setSettlementPanelRefresh((value) => value + 1);
    void loadOverview({ silent: true });
  };

  const openCreateTranscriberModal = () => {
    setEditingTranscriberId(null);
    setTranscriberForm(EMPTY_TRANSCRIBER_FORM);
    setTranscriberModalOpen(true);
    void fetchNextTranscriberCode()
      .then((code) => {
        setTranscriberForm((prev) => ({ ...prev, code }));
      })
      .catch(() => {
        setTranscriberForm((prev) => ({ ...prev, code: "자동 생성" }));
      });
  };

  const openEditTranscriberModal = (person: Transcriber) => {
    setEditingTranscriberId(person.id);
    setTranscriberForm({
      code: person.id,
      name: person.name,
      gradeLevel: String(person.gradeLevel || 1),
      phone: person.phone,
      residentId: person.residentId,
      bankName: person.bankName,
      accountHolder: person.accountHolder,
      accountNumber: person.accountNumber,
    });
    setTranscriberModalOpen(true);
  };

  const closeTranscriberModal = () => {
    setTranscriberModalOpen(false);
    setEditingTranscriberId(null);
  };

  const openCreateAdminModal = () => {
    setEditingAdminId(null);
    setAdminForm(EMPTY_ADMIN_FORM);
    setAdminModalOpen(true);
  };

  const openEditAdminModal = (account: AdminAccount) => {
    setEditingAdminId(account.id);
    setAdminForm({
      email: account.email,
      password: "",
      name: account.name,
      role: account.role,
      phone: account.phone ?? "",
      isActive: account.is_active,
    });
    setAdminModalOpen(true);
  };

  const closeAdminModal = () => {
    setAdminModalOpen(false);
    setEditingAdminId(null);
    setAdminForm(EMPTY_ADMIN_FORM);
  };

  const saveAdminModal = async () => {
    const name = adminForm.name.trim();
    const email = adminForm.email.trim();
    const phone = adminForm.phone.trim();
    if (!name) {
      window.alert("이름을 입력해 주세요.");
      return;
    }

    if (editingAdminId === null) {
      if (!email) {
        window.alert("이메일을 입력해 주세요.");
        return;
      }
      if (!adminForm.password.trim()) {
        window.alert("비밀번호를 입력해 주세요.");
        return;
      }
      await runAdminAction("관리자 계정이 추가되었습니다.", async () => {
        await createAdminUser({
          email,
          password: adminForm.password,
          name,
          role: adminForm.role,
          phone: phone || undefined,
        });
        await loadAdminAccounts();
      });
    } else {
      await runAdminAction("관리자 계정이 수정되었습니다.", async () => {
        await updateAdminUser(editingAdminId, {
          name,
          role: adminForm.role,
          phone: phone || null,
          is_active: adminForm.isActive,
          ...(adminForm.password.trim() ? { password: adminForm.password } : {}),
        });
        await loadAdminAccounts();
      });
    }
    closeAdminModal();
  };

  const deactivateAdminAccount = async (account: AdminAccount) => {
    if (!window.confirm(`${account.name}(${account.email}) 관리자를 비활성화하시겠습니까?`)) {
      return;
    }
    await runAdminAction("관리자 계정이 비활성화되었습니다.", async () => {
      await deactivateAdminUser(account.id);
      await loadAdminAccounts();
    });
  };

  const openGradeRateModal = async () => {
    try {
      const rates = await fetchTranscriberGradeRates();
      setOverview((current) => (current ? { ...current, transcriber_grade_rates: rates } : current));
    } catch (err) {
      console.error(err);
    }
    setGradeRateForm({ gradeLevel: "1", perMinuteRate: "" });
    setGradeRateModalOpen(true);
  };

  const closeGradeRateModal = () => {
    setGradeRateModalOpen(false);
    setGradeRateForm({ gradeLevel: "1", perMinuteRate: "" });
  };

  const saveGradeRate = async () => {
    const gradeLevel = Math.min(5, Math.max(1, Number(gradeRateForm.gradeLevel) || 1));
    const perMinuteRate = Number(gradeRateForm.perMinuteRate);
    if (!Number.isFinite(perMinuteRate) || perMinuteRate < 0) {
      window.alert("분당 전사금액은 0원 이상 숫자로 입력해 주세요.");
      return;
    }
    await runAdminAction("등급별 전사금액이 저장되었습니다.", async () => {
      await saveTranscriberGradeRate({ grade_level: gradeLevel, per_minute_rate: perMinuteRate });
    });
    closeGradeRateModal();
  };

  const removeGradeRate = async (item: GradeRateItem) => {
    if (!window.confirm(`${item.gradeLevel}등급 요율을 삭제하시겠습니까?`)) return;
    await runAdminAction("등급별 전사금액이 삭제되었습니다.", async () => {
      await deleteTranscriberGradeRate(item.id);
    });
  };

  const saveTranscriberModal = async () => {
    if (!transcriberForm.name.trim()) {
      window.alert("이름을 입력해 주세요.");
      return;
    }

    const profilePayload = {
      name: transcriberForm.name.trim(),
      grade_level: Math.min(5, Math.max(1, Number(transcriberForm.gradeLevel) || 1)),
      phone: transcriberForm.phone.trim() || undefined,
      resident_id: transcriberForm.residentId.trim() || undefined,
      bank_name: transcriberForm.bankName.trim() || undefined,
      account_holder: transcriberForm.accountHolder.trim() || undefined,
      account_number: transcriberForm.accountNumber.trim() || undefined,
    };

    await runAdminAction(editingTranscriberId ? "속기사 정보가 수정되었습니다." : "속기사가 추가되었습니다.", async () => {
      if (editingTranscriberId) {
        await updateTranscriber(editingTranscriberId, profilePayload);
      } else {
        await createTranscriber(profilePayload);
      }
    });
    closeTranscriberModal();
  };

  const removeTranscriber = async (person: Transcriber) => {
    if (!window.confirm(`${person.name}(${person.id}) 속기사를 삭제하시겠습니까?`)) return;
    await runAdminAction("속기사가 삭제되었습니다.", async () => {
      await deleteTranscriber(person.id);
    });
  };

  const resetTranscriberLogin = async (person: Transcriber) => {
    if (
      !window.confirm(
        `${person.name}(${person.id}) 속기사의 로그인을 초기화하시겠습니까?\n진행 중 배정은 해제되며, 속기사 PWA에서 다시 ID/비밀번호를 설정해야 합니다.`,
      )
    ) {
      return;
    }
    await runAdminAction("로그인 정보가 초기화되었습니다.", async () => {
      await revokeTranscriberAuth(person.id);
    });
  };

  const menuItems = useMemo(() => {
    if (!adminProfile) return [];
    return MENU_BASE.filter((item) => canAccessMenu(adminProfile.role, item.key));
  }, [adminProfile]);

  const visibleAdminAccounts = useMemo(() => {
    const q = adminQuery.trim().toLowerCase();
    if (!q) return adminAccounts;
    return adminAccounts.filter((account) => {
      const haystack = [
        String(account.id),
        account.email,
        account.name,
        account.role,
        account.role_label,
        account.phone ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [adminAccounts, adminQuery]);

  const visibleMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const haystack = [String(member.id), member.email, member.name, member.phone, member.clientCode].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [members, memberQuery]);

  const memberProjects = useMemo(() => {
    if (!detailMember?.clientId) return [];
    return projects.filter((project) => {
      const overviewProject = overview?.projects?.find((item) => item.project_id === project.id);
      return overviewProject?.client.id === detailMember.clientId;
    });
  }, [detailMember, projects, overview]);

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus =
        statusFilter === "전체" ||
        project.files.some((file) => file.status === statusFilter) ||
        (statusFilter === "배정 대기" && project.rawStatus === "waiting_assignment");
      if (!matchesStatus) return false;
      if (!q) return true;
      const haystack = [
        project.id,
        project.title,
        project.client,
        project.assignee,
        ...project.files.map((file) => file.id),
        ...project.files.map((file) => file.filename),
        ...project.files.map((file) => file.title),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, query, statusFilter]);

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? true;

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !(prev[projectId] ?? true) }));
  };

  const dashboardStats = useMemo(() => {
    return {
      totalSales: overview?.stats.total_sales ?? 0,
      totalSettlements: overview?.stats.total_settlements ?? 0,
      outstanding: overview?.stats.outstanding ?? 0,
      waitingAssign: overview?.stats.waiting_assignment ?? 0,
      working: overview?.stats.working ?? 0,
      finalDone: overview?.stats.final_done ?? 0,
      totalJobs: overview?.stats.total_jobs ?? 0,
    };
  }, [overview]);

  const memberSummaryMetrics = useMemo(
    () => [
      { label: "전체 회원", value: `${members.length}명`, tone: "slate" as const },
      {
        label: "활성",
        value: `${members.filter((member) => member.isActive).length}명`,
        tone: "emerald" as const,
      },
      {
        label: "비활성",
        value: `${members.filter((member) => !member.isActive).length}명`,
        tone: "amber" as const,
      },
      { label: "검색 결과", value: `${visibleMembers.length}명`, tone: "cyan" as const },
    ],
    [members, visibleMembers.length],
  );

  const transcriberSummaryMetrics = useMemo(
    () => [
      { label: "전체 속기사", value: `${transcribers.length}명`, tone: "slate" as const },
      {
        label: "작업 가능",
        value: `${transcribers.filter((person) => person.status === "작업 가능").length}명`,
        tone: "emerald" as const,
      },
      {
        label: "작업 중",
        value: `${transcribers.filter((person) => person.status === "작업 중").length}명`,
        tone: "cyan" as const,
      },
      {
        label: "재가입 필요",
        value: `${transcribers.filter((person) => person.authStatus !== "active").length}명`,
        tone: "amber" as const,
      },
    ],
    [transcribers],
  );

  const renderDashboard = () => (
    <SectionCard title="진행 현황">
      <div className="grid gap-3 lg:grid-cols-3">
        {[
          { title: "배정 대기", count: `${dashboardStats.waitingAssign}건`, tone: "amber" as const },
          { title: "속기사 작업 중", count: `${dashboardStats.working}건`, tone: "cyan" as const },
          {
            title: "PDF 전달",
            count: `${dashboardStats.finalDone}건`,
            tone: "emerald" as const,
          },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.title}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{item.count}</p>
            <div className="mt-3">
              <SummaryChip label="상태" value={item.title} tone={item.tone} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderJobs = () => (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/92 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
            <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="프로젝트명, 의뢰인, 파일명, 작업번호 검색"
          className="min-w-[280px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "전체" | JobStatus)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400"
        >
          <option value="전체">전체 상태</option>
          <option value="배정 대기">배정 대기</option>
          <option value="속기사 작업 중">속기사 작업 중</option>
          <option value="의뢰인 검토">의뢰인 검토</option>
          <option value="녹취록 요청">녹취록 요청</option>
          <option value="속기사검토">속기사검토</option>
          <option value="PDF 전달">PDF 전달</option>
        </select>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">
              프로젝트 {visibleProjects.length}건
            </span>
            <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">
              펼침 상태 {visibleProjects.filter((project) => isProjectExpanded(project.id)).length}건
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {visibleProjects.length === 0 ? (
          <EmptyState message="표시할 프로젝트가 없습니다." />
        ) : (
          <table className="w-full min-w-[1220px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-800 bg-slate-950 px-3 py-2" />
                <th className="sticky left-[49px] z-10 whitespace-nowrap border-r border-slate-800 bg-slate-950 px-3 py-2">프로젝트</th>
                <th className="whitespace-nowrap px-3 py-2">의뢰인</th>
                <th className="whitespace-nowrap px-3 py-2">파일</th>
                <th className="whitespace-nowrap px-3 py-2">진행</th>
                <th className="whitespace-nowrap px-3 py-2">담당</th>
                <th className="whitespace-nowrap px-3 py-2">배정일시</th>
                <th className="whitespace-nowrap px-3 py-2">마감</th>
                <th className="whitespace-nowrap px-3 py-2">상태</th>
                <th className="whitespace-nowrap px-3 py-2">동작</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => {
                const expanded = isProjectExpanded(project.id);
                return (
                  <Fragment key={project.id}>
                    <tr className="border-t border-slate-800 bg-slate-950/50 text-slate-200 hover:bg-slate-900/60">
                      <td className="sticky left-0 z-[1] border-r border-slate-800 bg-slate-950/95 px-3 py-2">
            <button
              type="button"
                          onClick={() => toggleProjectExpanded(project.id)}
                          className="rounded-md px-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
                          {expanded ? "▾" : "▸"}
            </button>
                      </td>
                      <td className="sticky left-[49px] z-[1] max-w-[220px] border-r border-slate-800 bg-slate-950/95 px-3 py-2" title={project.title}>
                        <div className="truncate font-semibold text-white">{project.title}</div>
                        <div className="mt-1 font-mono text-[11px] text-slate-500">{project.id}</div>
                      </td>
                      <td className="max-w-[140px] truncate whitespace-nowrap px-3 py-2" title={project.client}>
                        {project.client}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {project.fileCount}개
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {project.completedCount}/{project.fileCount}
                      </td>
                      <td className="max-w-[120px] truncate whitespace-nowrap px-3 py-2">{project.assignee}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {project.files.find((file) => file.assignedAt !== "-")?.assignedAt ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{project.dueAt}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${projectStatusTone(project.rawStatus)}`}>
                          {project.statusLabel}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex gap-2">
            <button
              type="button"
                            onClick={() => openProjectDetailModal(project)}
                            className="rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800"
            >
                            상세
            </button>
            <button
              type="button"
                            onClick={() => openAssignProjectModal(project)}
                            className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/20"
            >
                            {projectAssignButtonLabel(project)}
            </button>
                        </div>
                      </td>
                    </tr>
                    {expanded
                      ? project.files.map((file) => (
                          <tr key={`${project.id}-${file.id}`} className="bg-slate-950/25 text-slate-300 hover:bg-slate-900/50">
                            <td className="sticky left-0 z-[1] border-r border-slate-800 bg-slate-950/95 px-3 py-1.5" />
                            <td className="sticky left-[49px] z-[1] border-r border-slate-800 bg-slate-950/95 px-3 py-1.5 pl-8 font-mono text-[11px] text-slate-500" title={file.id}>
                              {file.id}
                            </td>
                            <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-400" title={project.client}>
                              {project.client}
                            </td>
                            <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-200">
            <button
              type="button"
                                onClick={() => void openDetailModal(file.id)}
                                className="max-w-full truncate text-left text-cyan-300 transition hover:text-cyan-200"
                                title={file.filename}
                              >
                                {file.filename}
            </button>
                              <div className="mt-1 text-[11px] text-slate-500">{file.title}</div>
                            </td>
                            <td className="px-3 py-1.5 text-slate-400">파일 단위</td>
                            <td className="px-3 py-1.5">{file.assignee}</td>
                            <td className="px-3 py-1.5 text-slate-400">{file.assignedAt}</td>
                            <td className="px-3 py-1.5 text-slate-400">{file.dueAt}</td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                {file.admin_inquiry_badges?.map((badge) => (
                                  <span
                                    key={`${file.id}-${badge}`}
                                    className="inline-flex rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200"
                                  >
                                    {badge}
                                  </span>
                                ))}
                                <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${statusTone(file.status)}`}>
                                  {file.status}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5">
                              <button
                                type="button"
                                onClick={() => void openDetailModal(file.id)}
                                className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                              >
                                파일 상세
                              </button>
                            </td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
          </div>
    </div>
  );

  const toggleMemberActive = async (member: MemberItem) => {
    await runAdminAction("회원 상태가 변경되었습니다.", async () => {
      const updated = await updateMemberActive(member.id, !member.isActive);
      setDetailMember((current) =>
        current?.id === member.id
          ? {
              ...current,
              isActive: updated.is_active,
            }
          : current,
      );
    });
  };

  const renderMembers = () => (
    <SectionCard title="회원 관리" subtitle="계정 상태와 연결된 의뢰 현황을 시트처럼 확인합니다.">
      <div className="mb-4 space-y-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {memberSummaryMetrics.map((item) => (
            <SummaryChip key={item.label} label={item.label} value={item.value} tone={item.tone} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2">
          <input
            value={memberQuery}
            onChange={(event) => setMemberQuery(event.target.value)}
            placeholder="이름, 이메일, 휴대폰, 의뢰인 코드 검색"
            className="w-full max-w-xl flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400"
          />
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400">
            활성 {members.filter((member) => member.isActive).length} / 전체 {members.length}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {visibleMembers.length === 0 ? (
          <EmptyState message="표시할 회원이 없습니다." />
        ) : (
          <table className="w-full min-w-[1120px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">이메일</th>
                <th className="px-3 py-2">휴대폰</th>
                <th className="px-3 py-2">의뢰인 코드</th>
                <th className="px-3 py-2">프로젝트</th>
                <th className="px-3 py-2">파일</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">동작</th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => (
                <tr key={member.id} className="border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{member.id}</td>
                  <td className="px-3 py-2 font-medium text-white">{member.name}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={member.email}>
                    {member.email}
                  </td>
                  <td className="px-3 py-2">{member.phone}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{member.clientCode}</td>
                  <td className="px-3 py-2">{member.projectCount}건</td>
                  <td className="px-3 py-2">{member.jobCount}건</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${
                        member.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"
                      }`}
                    >
                      {member.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailMember(member)}
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                      >
                        상세
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleMemberActive(member)}
                        className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                          member.isActive
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        }`}
                      >
                        {member.isActive ? "비활성화" : "활성화"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );

  const renderAdmins = () => (
    <SectionCard title="관리자 관리" subtitle="관리자 계정, 등급, 활성 상태를 관리합니다.">
      <div className="mb-4 space-y-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <SummaryChip label="전체 관리자" value={`${adminAccounts.length}명`} tone="slate" />
          <SummaryChip
            label="활성"
            value={`${adminAccounts.filter((account) => account.is_active).length}명`}
            tone="emerald"
          />
          <SummaryChip
            label="비활성"
            value={`${adminAccounts.filter((account) => !account.is_active).length}명`}
            tone="amber"
          />
          <SummaryChip label="검색 결과" value={`${visibleAdminAccounts.length}명`} tone="cyan" />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2">
          <input
            value={adminQuery}
            onChange={(event) => setAdminQuery(event.target.value)}
            placeholder="이름, 이메일, 등급 검색"
            className="w-full max-w-xl flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={() => void openCreateAdminModal()}
            className="rounded-md bg-cyan-500 px-3 py-2 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            관리자 추가
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {adminAccountsLoading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">관리자 목록을 불러오는 중입니다.</div>
        ) : visibleAdminAccounts.length === 0 ? (
          <EmptyState message="표시할 관리자가 없습니다." />
        ) : (
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">이메일</th>
                <th className="px-3 py-2">등급</th>
                <th className="px-3 py-2">휴대폰</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">최근 로그인</th>
                <th className="px-3 py-2">동작</th>
              </tr>
            </thead>
            <tbody>
              {visibleAdminAccounts.map((account) => (
                <tr key={account.id} className="border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{account.id}</td>
                  <td className="px-3 py-2 font-medium text-white">{account.name}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={account.email}>
                    {account.email}
                  </td>
                  <td className="px-3 py-2">{account.role_label}</td>
                  <td className="px-3 py-2">{account.phone || "-"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${
                        account.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"
                      }`}
                    >
                      {account.is_active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {account.last_login_at ? formatKstDateTime(account.last_login_at) : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEditAdminModal(account)}
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                      >
                        수정
                      </button>
                      {account.is_active ? (
                        <button
                          type="button"
                          onClick={() => void deactivateAdminAccount(account)}
                          disabled={account.id === adminProfile?.id}
                          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          비활성화
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );

  const renderTranscribers = () => (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/92 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
      <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {transcriberSummaryMetrics.map((item) => (
          <SummaryChip key={item.label} label={item.label} value={item.value} tone={item.tone} />
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {transcribers.length === 0 ? (
          <EmptyState message="속기사 관리 데이터가 없습니다." />
        ) : (
          <table className="w-full min-w-[1240px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">코드</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">등급</th>
                <th className="px-3 py-2">로그인 ID</th>
                <th className="px-3 py-2">로그인</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">진행중</th>
                <th className="px-3 py-2">월 용량</th>
                <th className="px-3 py-2">단가</th>
                <th className="px-3 py-2">품질</th>
                <th className="px-3 py-2">동작</th>
              </tr>
            </thead>
            <tbody>
              {transcribers.map((person) => (
                <tr key={person.id} className="border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{person.id}</td>
                  <td className="px-3 py-2 font-medium text-white">{person.name}</td>
                  <td className="px-3 py-2">{person.gradeLevel}등급</td>
                  <td className="px-3 py-2">{person.loginId}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${authStatusTone(person.authStatus)}`}>
                      {mapAuthStatusLabel(person.authStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${statusTone(person.status)}`}>
                      {person.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{person.activeJobs}건</td>
                  <td className="px-3 py-2">{person.monthlyCapacity}건</td>
                  <td className="px-3 py-2 text-[12px] text-slate-400">{person.unitPrice}</td>
                  <td className="px-3 py-2 text-[12px] text-slate-400">{person.qualityScore}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEditTranscriberModal(person)}
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        disabled={person.authStatus !== "active"}
                        onClick={() => void resetTranscriberLogin(person)}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        로그인 초기화
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeTranscriber(person)}
                        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <TranscriberSettlementPanel
        refreshToken={settlementPanelRefresh}
        onPay={openSettlementPayFromSnapshot}
        onChanged={() => {
          setSettlementPanelRefresh((value) => value + 1);
          void loadOverview({ silent: true });
        }}
      />
    </div>
  );

  const renderSales = () => (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/92 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
      <div className="mb-3 grid gap-1.5 md:grid-cols-2 xl:grid-cols-5">
        <SummaryChip compact label="결제건수" value={`${filteredSales.length}건`} />
        <SummaryChip compact label="일매출" value={formatCurrency(salesSummaryMetrics.dailyTotal)} tone="cyan" />
        <SummaryChip compact label="월매출" value={formatCurrency(salesSummaryMetrics.monthlyTotal)} tone="slate" />
        <div className="rounded-xl border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-300/80">
            이번 달 목표 {formatSalesMonthShort(salesMonthKey)}
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-1.5">
            <p className="min-w-0 truncate text-[12px] font-semibold leading-tight text-white">
              {salesTargetLoading
                ? "불러오는 중…"
                : salesTargetAmount > 0
                  ? formatCurrency(salesTargetAmount)
                  : "미설정"}
            </p>
            <button
              type="button"
              onClick={openSalesTargetModal}
              className="shrink-0 rounded-md border border-violet-400/40 bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-100 hover:bg-violet-500/30"
            >
              매출목표
            </button>
          </div>
        </div>
        <SummaryChip
          compact
          label="달성률"
          value={
            salesAchievementRate === null
              ? "목표 미설정"
              : `${salesAchievementRate.toLocaleString("ko-KR")}%`
          }
          tone={salesAchievementRate !== null && salesAchievementRate >= 100 ? "emerald" : "amber"}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {filteredSales.length === 0 ? (
          <EmptyState message="선택한 기간에 매출 데이터가 없습니다." />
        ) : (
          <table className="w-full min-w-[1180px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">주문자</th>
                <th className="px-3 py-2">주문명</th>
                <th className="px-3 py-2">금액</th>
                <th className="px-3 py-2">결제수단</th>
                <th className="px-3 py-2">결제일시</th>
                <th className="px-3 py-2">payment_id</th>
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((item) => (
                <tr key={item.paymentId} className="border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-medium text-white">{item.memberName}</td>
                  <td className="px-3 py-2">{item.orderName}</td>
                  <td className="px-3 py-2">{formatCurrency(item.amount)}</td>
                  <td className="px-3 py-2">{item.payMethod}</td>
                  <td className="px-3 py-2 text-slate-400">{item.paidAt}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{item.paymentId}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                      결제완료
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );

  const renderReports = () => (
    <SectionCard title="집계" subtitle="핵심 수치를 한눈에 보는 운영 요약 영역입니다.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="전체 의뢰" value={`${dashboardStats.totalJobs}건`} change="실시간" />
        <StatCard label="작업 중" value={`${dashboardStats.working}건`} change="실시간" />
        <StatCard label="월 매출 합계" value={formatCurrency(dashboardStats.totalSales)} change="DB 연동" />
        <StatCard label="월 정산 합계" value={formatCurrency(dashboardStats.totalSettlements)} change="DB 연동" />
      </div>
    </SectionCard>
  );

  const renderAnalytics = () => (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <SectionCard title="매출 분석" subtitle="거래처별 비중을 간단한 운영 그래프로 봅니다.">
        <div className="space-y-3">
          {sales.length === 0 ? (
            <EmptyState message="분석할 매출 데이터가 없습니다." />
          ) : (
            sales.map((item, index) => (
            <div key={item.paymentId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">{item.memberName}</span>
                <span className="text-[11px] text-slate-500">{33 - index * 7}% 비중</span>
              </div>
              <ProgressBar value={33 - index * 7} />
            </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="속기사 생산성 분석" subtitle="현재 작업량과 품질 점수를 같은 문법으로 보여줍니다.">
        <div className="space-y-3">
          {transcribers.length === 0 ? (
            <EmptyState message="분석할 속기사 데이터가 없습니다." />
          ) : (
            transcribers.map((person) => (
            <div key={person.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="font-medium text-white">{person.name}</p>
                <p className="mt-1 text-[11px] text-slate-500">{person.unitPrice}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-slate-200">활성 {person.activeJobs}건</p>
                <p className="mt-1 text-[11px] text-slate-500">품질 {person.qualityScore}</p>
              </div>
            </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );

  const content = (() => {
    switch (activeMenu) {
      case "dashboard":
        return renderDashboard();
      case "jobs":
        return renderJobs();
      case "transcribers":
        return renderTranscribers();
      case "members":
        return renderMembers();
      case "sales":
        return renderSales();
      case "expenses":
        return <ExpenseManagement />;
      case "reports":
        return renderReports();
      case "analytics":
        return renderAnalytics();
      case "admins":
        return renderAdmins();
      default:
        return renderDashboard();
    }
  })();

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        관리자 세션을 확인하는 중입니다...
      </div>
    );
  }

  if (authStatus === "guest" || !adminProfile) {
    return <AdminLogin onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative min-h-screen">
        <div className="relative mx-auto grid min-h-screen max-w-[1880px] gap-4 px-3 py-3 lg:grid-cols-[232px_minmax(0,1fr)] lg:px-4">
          <aside className="rounded-2xl border border-slate-800 bg-slate-950/95 p-4">
            <div className="border-b border-slate-800 pb-4">
              <div className="flex items-center gap-4">
                <img
                  src="/bulpen-logo.png"
                  alt="BULPEN"
                  className="h-14 w-14 shrink-0 rounded-xl bg-white object-contain p-1"
                />
                <div className="min-w-0 pl-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Bulpen Admin</p>
                  <h1 className="mt-1 text-base font-semibold text-white">Operations Console</h1>
                </div>
              </div>
            </div>

            <nav className="mt-4 space-y-1.5">
              {menuItems.map((item) => {
                const active = item.key === activeMenu;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveMenu(item.key)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3 lg:hidden">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">모바일 알림</p>
              <p className="mt-1.5 text-xs leading-5 text-cyan-50/90">
                {adminPushRegistered
                  ? "이 기기에서 신규 가입, 문의, 검토 요청 알림을 받고 있습니다."
                  : "신규 가입, 의뢰인 문의, 검토 요청을 이 기기로 받으려면 알림을 허용해 주세요."}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400">
                  상태:{" "}
                  {adminPushRegistered
                    ? "웹푸시 등록됨"
                    : adminPushPermission === "denied"
                      ? "권한 차단"
                      : "미등록"}
                </span>
                {!adminPushRegistered ? (
                  <button
                    type="button"
                    onClick={() => void enableAdminPushNotifications()}
                    disabled={adminPushLoading || adminPushPermission === "unsupported"}
                    className="w-full rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {adminPushLoading ? "등록 중..." : "관리자 알림 받기"}
                  </button>
                ) : null}
              </div>
            </div>
          </aside>

          <main className={`space-y-4 ${!adminPushRegistered ? "pb-28 lg:pb-0" : ""}`}>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/92 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
              <div
                className={`mt-1 gap-3 ${
                  activeMenu === "sales"
                    ? "grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
                    : "flex flex-col xl:flex-row xl:items-center xl:justify-between"
                }`}
              >
                <h2 className="text-lg font-semibold text-white">
                  {activeMenu === "jobs"
                    ? "작업 운영 시트"
                    : activeMenu === "dashboard"
                      ? "운영 대시보드"
                      : activeMenu === "transcribers"
                        ? "속기사 관리"
                        : activeMenu === "members"
                          ? "회원 관리"
                          : activeMenu === "sales"
                                ? "매출 관리"
                                : activeMenu === "expenses"
                                  ? "지출 관리"
                                : activeMenu === "reports"
                                  ? "집계"
                                  : activeMenu === "admins"
                                    ? "관리자 관리"
                                  : "분석"}
                </h2>
                {activeMenu === "sales" ? (
                  <div className="flex flex-wrap items-center justify-center gap-2 lg:px-4">
                    <label className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="shrink-0">조회 시작</span>
                      <input
                        type="date"
                        value={salesDateFrom}
                        max={salesDateTo}
                        onChange={(event) => {
                          const nextFrom = event.target.value;
                          setSalesDateFrom(nextFrom);
                          if (nextFrom > salesDateTo) {
                            setSalesDateTo(nextFrom);
                          }
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-slate-200"
                      />
                    </label>
                    <span className="text-xs text-slate-500">~</span>
                    <label className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="shrink-0">조회 종료</span>
                      <input
                        type="date"
                        value={salesDateTo}
                        min={salesDateFrom}
                        onChange={(event) => {
                          const nextTo = event.target.value;
                          setSalesDateTo(nextTo);
                          if (nextTo < salesDateFrom) {
                            setSalesDateFrom(nextTo);
                          }
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-slate-200"
                      />
                    </label>
                  </div>
                ) : null}
                <div className={`flex flex-wrap items-center gap-2 ${activeMenu === "sales" ? "lg:justify-end" : "xl:justify-end"}`}>
                  <span className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300">
                    {adminProfile.role_label} · {adminProfile.name}
                  </span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    로그아웃
                  </button>
                  {activeMenu === "admins" ? (
                    <button
                      type="button"
                      onClick={() => void openCreateAdminModal()}
                      className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-400"
                    >
                      관리자 추가
                    </button>
                  ) : null}
                  {activeMenu === "transcribers" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void openGradeRateModal()}
                        className="rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
                      >
                        등급별 요율 관리
                      </button>
                      <button
                        type="button"
                        onClick={openCreateTranscriberModal}
                        className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-400"
                      >
                        추가
                      </button>
                    </>
                  ) : null}
                  <span className="hidden rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-400 lg:inline">
                    관리자 알림: {adminPushRegistered ? "웹푸시 등록됨" : adminPushPermission === "denied" ? "권한 차단" : "미등록"}
                  </span>
                  {!adminPushRegistered ? (
                    <button
                      type="button"
                      onClick={() => void enableAdminPushNotifications()}
                      disabled={adminPushLoading || adminPushPermission === "unsupported"}
                      className="hidden rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 lg:inline-flex"
                    >
                      {adminPushLoading ? "등록 중..." : "관리자 알림 받기"}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {loading ? (
              <section className="rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-10 text-center text-slate-400">
                관리자 데이터를 불러오는 중입니다.
          </section>
            ) : null}

            {content}
          </main>
        </div>
      </div>

      {!adminPushRegistered ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-cyan-500/30 bg-slate-950/95 p-3 backdrop-blur lg:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => void enableAdminPushNotifications()}
            disabled={adminPushLoading || adminPushPermission === "unsupported"}
            className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adminPushLoading ? "알림 등록 중..." : "관리자 알림 받기"}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {adminPushPermission === "denied"
              ? "알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요."
              : "신규 가입 · 문의 · 검토 요청을 이 기기로 받습니다."}
          </p>
        </div>
      ) : null}

      {detailJobId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">녹취 편집</p>
                <h3 className="mt-1 truncate text-xl font-semibold text-white">
                  {detailJob?.transcript_json?.filename || detailJob?.title || detailJobId}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  {detailJob?.client?.name || "-"}
                  {detailJob?.transcriber?.name ? ` · 담당 ${detailJob.transcriber.name}` : ""}
                  {detailJob?.status ? ` · ${mapJobStatus(detailJob.workflow_status ?? detailJob.status)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {detailLoading ? (
                <div className="text-sm text-slate-400">녹취록을 불러오는 중입니다...</div>
              ) : detailJob ? (
                <AdminTranscriptEditor
                  job={detailJob}
                  formatDateTime={formatKstDateTime}
                  mapJobStatus={mapJobStatus}
                  onJobChange={setDetailJob}
                  onReloadOverview={async () => {
                    await loadOverview({ silent: true });
                  }}
                  onNotice={(kind, message, title) => setActionNotice({ kind, message, title })}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {detailMember ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/60 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-[520px] flex-col overflow-hidden border-l border-slate-800 bg-slate-950 shadow-2xl">
            <div className="border-b border-slate-800 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">회원 상세</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">{detailMember.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{detailMember.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailMember(null)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryChip label="회원 ID" value={String(detailMember.id)} />
                <SummaryChip label="상태" value={detailMember.isActive ? "활성" : "비활성"} tone={detailMember.isActive ? "emerald" : "amber"} />
                <SummaryChip label="휴대폰" value={detailMember.phone} />
                <SummaryChip label="가입일" value={detailMember.createdAt} />
                <div className="sm:col-span-2">
                  <SummaryChip label="연결 의뢰인 코드" value={detailMember.clientCode} tone="violet" />
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-200">
                    프로젝트 {detailMember.projectCount}건 / 파일 {detailMember.jobCount}건
                  </p>
                </div>
                <div className="p-4">
                  {memberProjects.length ? (
                    <div className="space-y-2">
                      {memberProjects.map((project) => (
                        <div
                          key={project.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{project.title}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              진행 {project.completedCount}/{project.fileCount} · {project.statusLabel}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailMember(null);
                              openProjectDetailModal(project);
                              setActiveMenu("jobs");
                            }}
                            className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                          >
                            프로젝트 보기
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState message="아직 등록된 프로젝트가 없습니다." />
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 px-5 py-4">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMemberActive(detailMember)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    detailMember.isActive
                      ? "border border-amber-500/30 bg-amber-500/10 text-amber-300"
                      : "bg-emerald-500 text-slate-950"
                  }`}
                >
                  {detailMember.isActive ? "계정 비활성화" : "계정 활성화"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailProject ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/60 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-slate-800 bg-slate-950 shadow-2xl">
            <div className="border-b border-slate-800 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">프로젝트 상세</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">{detailProject.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{detailProject.client}</p>
                </div>
                <button
                  type="button"
                  onClick={closeProjectDetailModal}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryChip label="프로젝트 ID" value={detailProject.id} />
                <SummaryChip label="상태" value={detailProject.statusLabel} tone="cyan" />
                <SummaryChip label="진행" value={`${detailProject.completedCount}/${detailProject.fileCount} 파일`} />
                <SummaryChip label="마감" value={detailProject.dueAt} tone="amber" />
                <div className="sm:col-span-2">
                  <SummaryChip label="담당 속기사" value={detailProject.assignee} tone="violet" />
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-200">포함 파일</p>
                </div>
                <div className="overflow-x-auto p-4">
                  {detailProject.files.length ? (
                    <table className="w-full min-w-[640px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          <th className="px-3 py-2">파일명</th>
                          <th className="px-3 py-2">담당</th>
                          <th className="px-3 py-2">배정일시</th>
                          <th className="px-3 py-2">마감</th>
                          <th className="px-3 py-2">상태</th>
                          <th className="px-3 py-2">동작</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailProject.files.map((file) => (
                          <tr key={file.id} className="border-t border-slate-800 text-slate-200">
                            <td className="max-w-[240px] truncate px-3 py-2">
                              <button
                                type="button"
                                onClick={() => openFileDetailFromProject(file.id)}
                                className="max-w-full truncate text-left text-cyan-300 transition hover:text-cyan-200"
                                title={file.filename}
                              >
                                {file.filename}
                              </button>
                            </td>
                            <td className="px-3 py-2">{file.assignee}</td>
                            <td className="px-3 py-2 text-slate-400">{file.assignedAt}</td>
                            <td className="px-3 py-2 text-slate-400">{file.dueAt}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${statusTone(file.status)}`}>
                                {file.status}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => openFileDetailFromProject(file.id)}
                                className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                              >
                                파일 상세
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <EmptyState message="이 프로젝트에 등록된 파일이 없습니다." />
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 px-5 py-4">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const project = detailProject;
                    closeProjectDetailModal();
                    openAssignProjectModal(project);
                  }}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  {projectAssignButtonLabel(detailProject)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {assignProjectTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            {(() => {
              const reassign = projectIsReassignMode(assignProjectTarget);
              const assignableFiles = assignableProjectFiles(assignProjectTarget, reassign);
              const allSelected =
                assignableFiles.length > 0 &&
                assignableFiles.every((file) => selectedAssignJobIds.includes(file.id));

              return (
                <>
                  <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">배정 작업</p>
                      <h3 className="mt-1 text-xl font-semibold text-white">
                        {reassign ? "배정 변경" : "프로젝트 일괄 배정"}
                      </h3>
                      <p className="mt-2 text-sm text-slate-400">
                        {`${assignProjectTarget.title} (${assignProjectTarget.fileCount}개 파일)`}
                      </p>
                      {reassign ? (
                        <p className="mt-1 text-sm text-cyan-300">현재 담당: {assignProjectTarget.assignee}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={closeAssignModal}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
                    >
                      닫기
                    </button>
                  </div>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {reassign ? "새 속기사 선택" : "속기사 선택"}
                      </label>
                      <select
                        value={selectedTranscriberCode}
                        onChange={(e) => setSelectedTranscriberCode(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      >
                        {transcribers.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name} / {person.status} / 활성 {person.activeJobs}건
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-200">배정할 파일 선택</p>
                        {assignableFiles.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedAssignJobIds(allSelected ? [] : assignableFiles.map((file) => file.id))
                            }
                            className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
                          >
                            {allSelected ? "전체 해제" : "전체 선택"}
                          </button>
                        ) : null}
                      </div>
                      {assignableFiles.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-400">
                          {reassign ? "재배정 가능한 파일이 없습니다." : "배정 대기 또는 녹취록 요청 파일이 없습니다."}
                        </p>
                      ) : (
                        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                          {assignableFiles.map((file) => (
                            <label
                              key={file.id}
                              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5"
                            >
                              <input
                                type="checkbox"
                                checked={selectedAssignJobIds.includes(file.id)}
                                onChange={() => toggleAssignJobSelection(file.id)}
                                className="mt-1"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-slate-100">{file.filename}</span>
                                <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                                  <span>{file.status}</span>
                                  {file.assignee !== "-" ? <span>담당 {file.assignee}</span> : null}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                      <p>{assignProjectTarget.client}</p>
                      <p className="mt-1">
                        {reassign
                          ? "선택한 파일을 새 속기사에게 재배정합니다. 진행 중 파일은 확인 후 변경됩니다."
                          : "선택한 배정 대기·재검수 파일을 속기사에게 일괄 배정합니다."}
                      </p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeAssignModal}
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmAssignModal()}
                        disabled={assignableFiles.length === 0}
                        className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reassign ? "재배정 확정" : "배정 확정"}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {adminModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">관리자 관리</p>
                <h3 className="mt-1 text-xl font-semibold text-white">
                  {editingAdminId ? "관리자 수정" : "관리자 추가"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAdminModal}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className={editingAdminId ? "md:col-span-2" : ""}>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">이메일</span>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(event) => setAdminForm((prev) => ({ ...prev, email: event.target.value }))}
                  readOnly={editingAdminId !== null}
                  placeholder="admin@example.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 read-only:text-slate-400"
                />
              </label>
              {!editingAdminId ? (
                <label>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">비밀번호</span>
                  <input
                    type="password"
                    value={adminForm.password}
                    onChange={(event) => setAdminForm((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="8~16자, 영문·숫자·특수문자"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              ) : null}
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">이름</span>
                <input
                  value={adminForm.name}
                  onChange={(event) => setAdminForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="이름"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">등급</span>
                <select
                  value={adminForm.role}
                  onChange={(event) =>
                    setAdminForm((prev) => ({ ...prev, role: event.target.value as AdminRole }))
                  }
                  disabled={editingAdminId === adminProfile?.id}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
                >
                  {ADMIN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {adminRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">휴대폰</span>
                <input
                  value={adminForm.phone}
                  onChange={(event) => setAdminForm((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              {editingAdminId ? (
                <label>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">새 비밀번호</span>
                  <input
                    type="password"
                    value={adminForm.password}
                    onChange={(event) => setAdminForm((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="변경 시에만 입력"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              ) : null}
              {editingAdminId ? (
                <label className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={adminForm.isActive}
                    onChange={(event) => setAdminForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                    disabled={editingAdminId === adminProfile?.id}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  <span className="text-sm text-slate-300">활성 계정</span>
                </label>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAdminModal}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveAdminModal()}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {transcriberModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">속기사 관리</p>
                <h3 className="mt-1 text-xl font-semibold text-white">{editingTranscriberId ? "속기사 수정" : "속기사 추가"}</h3>
              </div>
              <button
                type="button"
                onClick={closeTranscriberModal}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">코드</span>
                <input
                  value={transcriberForm.code || "자동 생성 중..."}
                  readOnly
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-300"
                />
                {!editingTranscriberId ? (
                  <span className="mt-1 block text-xs text-slate-500">저장 시 서버에서 자동 생성됩니다.</span>
                ) : null}
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">이름</span>
                <input
                  value={transcriberForm.name}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="이름"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">등급</span>
                <select
                  value={transcriberForm.gradeLevel}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, gradeLevel: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="1">1등급</option>
                  <option value="2">2등급</option>
                  <option value="3">3등급</option>
                  <option value="4">4등급</option>
                  <option value="5">5등급</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">휴대폰 번호</span>
                <input
                  value={transcriberForm.phone}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">주민등록번호</span>
                <input
                  value={transcriberForm.residentId}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, residentId: e.target.value }))}
                  placeholder="000000-0000000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">은행명</span>
                <input
                  value={transcriberForm.bankName}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, bankName: e.target.value }))}
                  placeholder="예: 국민은행"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">계좌번호</span>
                <input
                  value={transcriberForm.accountNumber}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  placeholder="계좌번호"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">예금주</span>
                <input
                  value={transcriberForm.accountHolder}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, accountHolder: e.target.value }))}
                  placeholder="예금주명"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTranscriberModal}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveTranscriberModal()}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {gradeRateModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">속기사 관리</p>
                <h3 className="mt-1 text-xl font-semibold text-white">등급별 분당 전사금액</h3>
              </div>
              <button
                type="button"
                onClick={closeGradeRateModal}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[160px_1fr_auto]">
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">등급</span>
                <select
                  value={gradeRateForm.gradeLevel}
                  onChange={(e) => setGradeRateForm((prev) => ({ ...prev, gradeLevel: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="1">1등급</option>
                  <option value="2">2등급</option>
                  <option value="3">3등급</option>
                  <option value="4">4등급</option>
                  <option value="5">5등급</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">분당 전사금액</span>
                <input
                  value={gradeRateForm.perMinuteRate}
                  onChange={(e) => setGradeRateForm((prev) => ({ ...prev, perMinuteRate: e.target.value }))}
                  placeholder="예: 1200"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void saveGradeRate()}
                  className="w-full rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  저장
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
              {transcriberGradeRates.length === 0 ? (
                <EmptyState message="등록된 등급별 전사금액이 없습니다." />
              ) : (
                <table className="w-full min-w-[520px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-3 py-2">등급</th>
                      <th className="px-3 py-2">분당 전사금액</th>
                      <th className="px-3 py-2">동작</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transcriberGradeRates.map((item) => (
                      <tr key={item.id} className="border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/50">
                        <td className="px-3 py-2 font-medium text-white">{item.gradeLevel}등급</td>
                        <td className="px-3 py-2">{formatCurrency(item.perMinuteRate)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setGradeRateForm({
                                  gradeLevel: String(item.gradeLevel),
                                  perMinuteRate: String(Math.round(item.perMinuteRate)),
                                })
                              }
                              className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeGradeRate(item)}
                              className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {settlementPayTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">정산 관리</p>
                <h3 className="mt-1 text-xl font-semibold text-white">정산 처리</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {settlementPayTarget.transcriber} · {settlementPayTarget.month}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSettlementPayModal}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                <p>총 정산액: {formatCurrency(settlementPayTarget.amount)}</p>
                <p className="mt-1 text-rose-300">
                  원천징수 3.3%: -{formatCurrency(settlementPayTarget.totalWithholding)} (3%{" "}
                  {formatCurrency(settlementPayTarget.incomeTax)} / 0.3% {formatCurrency(settlementPayTarget.localTax)})
                </p>
                <p className="mt-1 font-medium text-cyan-200">실지급액: {formatCurrency(settlementPayTarget.netPayAmount)}</p>
                <p className="mt-1">누적 지급액: {formatCurrency(settlementPayTarget.totalPaidAmount)}</p>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">지급액 (실지급)</span>
                <input
                  value={settlementPayAmount}
                  onChange={(e) => setSettlementPayAmount(e.target.value)}
                  inputMode="numeric"
                  placeholder="예: 150000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">메모</span>
                <input
                  value={settlementPayNote}
                  onChange={(e) => setSettlementPayNote(e.target.value)}
                  placeholder="선택 입력"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSettlementPayModal}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submitSettlementPayment()}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                정산 처리
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {salesTargetModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">매출 관리</p>
                <h3 className="mt-1 text-xl font-semibold text-white">매출 목표 설정</h3>
                <p className="mt-2 text-sm text-slate-400">월별 매출 목표 금액을 입력합니다.</p>
              </div>
              <button
                type="button"
                onClick={closeSalesTargetModal}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  대상 월
                </span>
                <select
                  value={salesTargetModalMonth}
                  onChange={(event) => setSalesTargetModalMonth(event.target.value)}
                  disabled={salesTargetModalLoading || salesTargetModalSaving}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400 disabled:opacity-60"
                >
                  {salesMonthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  목표 금액
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={salesTargetModalLoading ? "불러오는 중…" : salesTargetModalInput}
                  disabled={salesTargetModalLoading || salesTargetModalSaving}
                  onChange={(event) => setSalesTargetModalInput(event.target.value.replace(/[^\d]/g, ""))}
                  placeholder="예: 5000000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400 disabled:opacity-60"
                />
                {salesTargetModalAmount > 0 ? (
                  <p className="mt-1 text-xs text-violet-200/80">{formatCurrency(salesTargetModalAmount)}</p>
                ) : null}
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSalesTargetModal}
                disabled={salesTargetModalSaving}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveSalesTargetModal()}
                disabled={salesTargetModalLoading || salesTargetModalSaving}
                className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
              >
                {salesTargetModalSaving ? "저장 중" : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ActionNoticeModal notice={actionNotice} onClose={() => setActionNotice(null)} />
    </div>
  );
}

export default App;
