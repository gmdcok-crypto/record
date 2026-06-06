import { useEffect, useMemo, useState } from "react";

import {
  assignJob,
  createTranscriber,
  createAdminEventsSource,
  deleteTranscriber,
  fetchAdminOverview,
  fetchNextTranscriberCode,
  fetchJob,
  updateInvoiceStatus,
  updateJobStatus,
  updateSettlementStatus,
  updateTranscriber,
  type AdminOverview,
  type JobResponse,
} from "./api";

type MenuKey =
  | "dashboard"
  | "jobs"
  | "assignments"
  | "transcribers"
  | "progress"
  | "settlements"
  | "sales"
  | "reports"
  | "analytics";

type JobStatus =
  | "배정 대기"
  | "속기사 작업 중"
  | "1차 완료"
  | "의뢰인 수정 중"
  | "재검수 대기"
  | "최종 완료";

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
  client: string;
  title: string;
  filename: string;
  uploadedAt: string;
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

type Transcriber = {
  id: string;
  name: string;
  phone: string;
  residentId: string;
  bankName: string;
  accountNumber: string;
  specialty: string;
  status: TranscriberStatus;
  activeJobs: number;
  monthlyCapacity: number;
  unitPrice: string;
  qualityScore: string;
};

type TranscriberForm = {
  code: string;
  name: string;
  phone: string;
  residentId: string;
  bankName: string;
  accountNumber: string;
};

const EMPTY_TRANSCRIBER_FORM: TranscriberForm = {
  code: "",
  name: "",
  phone: "",
  residentId: "",
  bankName: "",
  accountNumber: "",
};

type SettlementItem = {
  id: number;
  month: string;
  transcriber: string;
  jobs: number;
  amount: number;
  status: SettlementStatus;
  paidAt: string;
};

type SalesItem = {
  id: number;
  month: string;
  client: string;
  billed: number;
  collected: number;
  outstanding: number;
  margin: string;
  status: string;
};

type ActivityItem = {
  time: string;
  title: string;
};

const MENU_BASE: Array<Omit<MenuItem, "count">> = [
  { key: "dashboard", label: "대시보드" },
  { key: "jobs", label: "의뢰 / 파일 관리" },
  { key: "assignments", label: "배정 관리" },
  { key: "transcribers", label: "속기사 관리" },
  { key: "progress", label: "진행 현황" },
  { key: "settlements", label: "정산 관리" },
  { key: "sales", label: "매출 관리" },
  { key: "reports", label: "집계" },
  { key: "analytics", label: "분석" },
];

function formatCurrency(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatCompactDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function mapJobStatus(status: string): JobStatus {
  switch (status) {
    case "waiting_assignment":
    case "uploaded":
      return "배정 대기";
    case "assigned":
    case "working":
      return "속기사 작업 중";
    case "first_done":
      return "1차 완료";
    case "client_editing":
      return "의뢰인 수정 중";
    case "review_waiting":
      return "재검수 대기";
    case "final_done":
    case "pdf_sent":
      return "최종 완료";
    default:
      return "배정 대기";
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

function marginFromSale(billed: number, collected: number): string {
  if (!billed) return "0%";
  return `${Math.round((collected / billed) * 100)}%`;
}

function activityTitle(job: JobItem): string {
  switch (job.status) {
    case "배정 대기":
      return `${job.id} 신규 의뢰 접수`;
    case "속기사 작업 중":
      return `${job.id} 속기사 작업 진행`;
    case "의뢰인 수정 중":
      return `${job.id} 의뢰인 수정 진행`;
    case "재검수 대기":
      return `${job.id} 재검수 대기`;
    case "최종 완료":
      return `${job.id} 최종본 완료`;
    default:
      return `${job.id} 작업 업데이트`;
  }
}

function transcriptPreview(job: JobResponse | null): string {
  if (!job?.transcript_json) return "전사 내용이 없습니다.";
  const segments = job.transcript_json.segments ?? [];
  if (segments.length) {
    return segments
      .slice(0, 6)
      .map((segment) => `${segment.speaker}: ${segment.text}`)
      .join("\n\n");
  }
  return (job.transcript_json.text || job.transcript_json.plain_text || "전사 내용이 없습니다.").trim();
}

function statusTone(status: JobStatus | SettlementStatus | PaymentStatus | TranscriberStatus): string {
  switch (status) {
    case "최종 완료":
    case "입금 완료":
    case "지급 완료":
    case "작업 가능":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20";
    case "속기사 작업 중":
    case "작업 중":
    case "정산 확정":
      return "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/20";
    case "배정 대기":
    case "재검수 대기":
    case "정산 대기":
    case "미수":
    case "휴무":
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20";
    case "의뢰인 수정 중":
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
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
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
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
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
    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

function App() {
  const [activeMenu, setActiveMenu] = useState<MenuKey>("dashboard");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"전체" | JobStatus>("전체");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState("");
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<JobResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignTarget, setAssignTarget] = useState<JobItem | null>(null);
  const [selectedTranscriberCode, setSelectedTranscriberCode] = useState("");
  const [transcriberModalOpen, setTranscriberModalOpen] = useState(false);
  const [editingTranscriberId, setEditingTranscriberId] = useState<string | null>(null);
  const [transcriberForm, setTranscriberForm] = useState<TranscriberForm>(EMPTY_TRANSCRIBER_FORM);

  const loadOverview = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    try {
      if (!silent) {
        setLoading(true);
      }
      const data = await fetchAdminOverview();
      setOverview(data);
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
    let alive = true;

    const initialLoad = async () => {
      if (!alive) return;
      setLoading(true);
      try {
        const data = await fetchAdminOverview();
        if (!alive) return;
        setOverview(data);
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
    eventSource.addEventListener("admin_update", () => {
      if (!alive) return;
      void loadOverview({ silent: true });
    });
    eventSource.addEventListener("error", () => {
      console.error("admin SSE connection error");
    });

    const intervalId = window.setInterval(() => {
      if (!alive || document.visibilityState !== "visible") return;
      void loadOverview({ silent: true });
    }, 10000);
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);

    return () => {
      alive = false;
      eventSource.close();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, []);

  const jobs = useMemo<JobItem[]>(() => {
    return (overview?.jobs ?? []).map((job) => ({
      id: job.id,
      client: job.client,
      title: job.title,
      filename: job.filename,
      uploadedAt: job.uploaded_at ? formatDateTime(job.uploaded_at) : "-",
      dueAt: job.due_at ? formatDateTime(job.due_at) : "-",
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

  const transcribers = useMemo<Transcriber[]>(() => {
    return (overview?.transcribers ?? []).map((person) => ({
      id: person.code,
      name: person.name,
      phone: person.phone || "",
      residentId: person.resident_id || "",
      bankName: person.bank_name || "",
      accountNumber: person.account_number || "",
      specialty: person.specialty || "-",
      status: mapTranscriberStatus(person.status, person.current_load),
      activeJobs: person.current_load,
      monthlyCapacity: person.monthly_capacity ?? 0,
      unitPrice: `분당 ${Math.round(person.unit_price).toLocaleString("ko-KR")}원`,
      qualityScore: `${person.quality_score.toFixed(1)} / 5`,
    }));
  }, [overview]);

  const settlements = useMemo<SettlementItem[]>(() => {
    return (overview?.settlements ?? []).map((item) => ({
      id: item.id,
      month: item.month,
      transcriber: String(item.transcriber),
      jobs: item.jobs,
      amount: item.amount,
      status: mapSettlementStatus(item.status),
      paidAt: item.paid_at ? formatDateTime(item.paid_at) : "-",
    }));
  }, [overview]);

  const sales = useMemo<SalesItem[]>(() => {
    return (overview?.sales ?? []).map((item) => ({
      id: item.id,
      month: item.month,
      client: item.client,
      billed: item.billed,
      collected: item.collected,
      outstanding: item.outstanding,
      margin: item.margin || marginFromSale(item.billed, item.collected),
      status: item.status,
    }));
  }, [overview]);

  const runAdminAction = async (message: string, action: () => Promise<void>) => {
    try {
      setBusyMessage(message);
      await action();
      await loadOverview();
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.");
      setLoading(false);
    } finally {
      setBusyMessage("");
    }
  };

  const handleAssign = async (jobId: string, transcriberCode = "TR-001") => {
    await runAdminAction("배정 처리 중입니다.", async () => {
      await assignJob(jobId, transcriberCode, "관리자 화면 배정");
    });
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
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetailModal = () => {
    setDetailJobId(null);
    setDetailJob(null);
    setDetailLoading(false);
  };

  const openAssignModal = (job: JobItem) => {
    setAssignTarget(job);
    setSelectedTranscriberCode(transcribers[0]?.id ?? "TR-001");
  };

  const closeAssignModal = () => {
    setAssignTarget(null);
    setSelectedTranscriberCode("");
  };

  const confirmAssignModal = async () => {
    if (!assignTarget || !selectedTranscriberCode) return;
    await handleAssign(assignTarget.id, selectedTranscriberCode);
    closeAssignModal();
  };

  const handleJobAdvance = async (job: JobItem) => {
    const nextStatus: Record<JobStatus, string> = {
      "배정 대기": "assigned",
      "속기사 작업 중": "review_waiting",
      "1차 완료": "client_editing",
      "의뢰인 수정 중": "review_waiting",
      "재검수 대기": "final_done",
      "최종 완료": "pdf_sent",
    };
    await runAdminAction("상태 변경 중입니다.", async () => {
      await updateJobStatus(job.id, nextStatus[job.status], "관리자 상태 변경");
    });
  };

  const handleSettlementConfirm = async (item: SettlementItem) => {
    const nextStatus = item.status === "정산 대기" ? "confirmed" : "paid";
    await runAdminAction("정산 상태 변경 중입니다.", async () => {
      await updateSettlementStatus(item.id, nextStatus);
    });
  };

  const handleInvoiceConfirm = async (item: SalesItem) => {
    const nextStatus = item.status === "paid" ? "paid" : "paid";
    await runAdminAction("매출 상태 변경 중입니다.", async () => {
      await updateInvoiceStatus(item.id, nextStatus);
    });
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
      phone: person.phone,
      residentId: person.residentId,
      bankName: person.bankName,
      accountNumber: person.accountNumber,
    });
    setTranscriberModalOpen(true);
  };

  const closeTranscriberModal = () => {
    setTranscriberModalOpen(false);
    setEditingTranscriberId(null);
  };

  const saveTranscriberModal = async () => {
    if (!transcriberForm.name.trim()) {
      window.alert("이름을 입력해 주세요.");
      return;
    }

    const profilePayload = {
      name: transcriberForm.name.trim(),
      phone: transcriberForm.phone.trim() || undefined,
      resident_id: transcriberForm.residentId.trim() || undefined,
      bank_name: transcriberForm.bankName.trim() || undefined,
      account_number: transcriberForm.accountNumber.trim() || undefined,
    };

    await runAdminAction(editingTranscriberId ? "속기사 수정 중입니다." : "속기사 추가 중입니다.", async () => {
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
    await runAdminAction("속기사 삭제 중입니다.", async () => {
      await deleteTranscriber(person.id);
    });
  };

  const activityFeed = useMemo<ActivityItem[]>(() => {
    return jobs.slice(0, 4).map((job) => ({
      time: formatCompactDateTime(job.uploadedAt),
      title: activityTitle(job),
    }));
  }, [jobs]);

  const menuItems = useMemo<MenuItem[]>(() => {
    return MENU_BASE.map((item) => {
      switch (item.key) {
        case "jobs":
          return { ...item, count: `${jobs.length}` };
        case "assignments":
          return {
            ...item,
            count: `${jobs.filter((job) => job.status === "배정 대기" || job.status === "재검수 대기").length}`,
          };
        case "transcribers":
          return { ...item, count: `${transcribers.length}` };
        case "progress":
          return { ...item, count: `${jobs.filter((job) => job.status !== "최종 완료").length}` };
        default:
          return item;
      }
    });
  }, [jobs, transcribers]);

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesQuery =
        !query.trim() ||
        [job.id, job.client, job.title, job.filename, job.assignee]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      const matchesStatus = statusFilter === "전체" || job.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [jobs, query, statusFilter]);

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

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <StatCard label="이번 달 매출 예정" value={formatCurrency(dashboardStats.totalSales)} change="+12.4%" />
        <StatCard label="이번 달 정산 예정" value={formatCurrency(dashboardStats.totalSettlements)} change="+8.1%" />
        <StatCard label="미수 금액" value={formatCurrency(dashboardStats.outstanding)} change="집중 관리" />
        <StatCard label="배정 대기 건수" value={`${dashboardStats.waitingAssign}건`} change="우선 처리" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.9fr]">
        <SectionCard
          title="긴급 작업 보드"
          action={
            <button
              type="button"
              onClick={() => setActiveMenu("jobs")}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              전체 작업 보기
            </button>
          }
        >
          <div className="space-y-3">
            {jobs.filter((job) => job.priority === "긴급").length === 0 ? (
              <EmptyState message="표시할 긴급 작업이 없습니다." />
            ) : (
              jobs.filter((job) => job.priority === "긴급").map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-white/8 bg-slate-950/60 p-4 transition hover:border-cyan-400/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300">
                        긴급
                      </span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(job.status)}`}>
                        {job.status}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-white">{job.title}</h3>
                    <p className="mt-1 text-sm text-slate-300">{job.client}</p>
                  </div>
                  <div className="text-right text-sm text-slate-300">
                    <p>담당: {job.assignee}</p>
                    <p className="mt-1">마감: {job.dueAt}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex justify-between text-xs text-slate-500">
                    <span>진행률</span>
                    <span>{job.progress}%</span>
                  </div>
                  <ProgressBar value={job.progress} />
                </div>
              </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="운영 피드">
          <div className="space-y-4">
            {activityFeed.length === 0 ? (
              <EmptyState message="표시할 최근 작업 이력이 없습니다." />
            ) : (
              activityFeed.map((item) => (
              <div key={`${item.time}-${item.title}`} className="flex gap-3">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.time}</p>
                </div>
              </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );

  const renderJobs = () => (
    <SectionCard
      title="의뢰 / 파일 관리"
      action={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const firstWaiting = visibleJobs.find((job) => job.status === "배정 대기" || job.status === "재검수 대기");
              if (firstWaiting) openAssignModal(firstWaiting);
            }}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          >
            일괄 배정
          </button>
          <button
            type="button"
            onClick={() => setActiveMenu("assignments")}
            className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            배정 화면 이동
          </button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="작업번호, 의뢰인, 파일명, 담당자 검색"
          className="min-w-[280px] flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "전체" | JobStatus)}
          className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 outline-none focus:border-cyan-400"
        >
          <option value="전체">전체 상태</option>
          <option value="배정 대기">배정 대기</option>
          <option value="속기사 작업 중">속기사 작업 중</option>
          <option value="1차 완료">1차 완료</option>
          <option value="의뢰인 수정 중">의뢰인 수정 중</option>
          <option value="재검수 대기">재검수 대기</option>
          <option value="최종 완료">최종 완료</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-3xl border border-white/10">
        <div className="hidden grid-cols-[1.7fr_1fr_0.9fr_0.9fr_0.8fr] gap-4 bg-slate-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
          <span>의뢰인 / 파일</span>
          <span>담당 / 마감</span>
          <span>상태</span>
          <span>매출</span>
          <span>동작</span>
        </div>
        <div className="divide-y divide-white/5">
          {visibleJobs.length === 0 ? <EmptyState message="표시할 의뢰/파일 데이터가 없습니다." /> : visibleJobs.map((job) => (
            <div key={job.id} className="grid gap-4 bg-slate-950/40 px-4 py-4 lg:grid-cols-[1.7fr_1fr_0.9fr_0.9fr_0.8fr] lg:items-center">
              <div>
                <p className="font-semibold text-white">{job.title}</p>
                <p className="mt-1 text-sm text-slate-200">{job.client}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {job.id} · {job.filename}
                </p>
              </div>
              <div className="text-sm text-slate-300">
                <p>{job.assignee}</p>
                <p className="mt-1 text-xs text-slate-500">마감 {job.dueAt}</p>
              </div>
              <div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}>
                  {job.status}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-white">{formatCurrency(job.salesAmount)}</p>
                <p className="mt-1 text-xs text-slate-500">{job.paymentStatus}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openDetailModal(job.id)}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/5"
                >
                  상세
                </button>
                <button
                  type="button"
                  onClick={() => openAssignModal(job)}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  배정
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );

  const renderAssignments = () => (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <SectionCard title="배정 대기 작업">
        <div className="space-y-3">
          {jobs.filter((job) => job.status === "배정 대기" || job.status === "재검수 대기").length === 0 ? (
            <EmptyState message="배정이 필요한 작업이 없습니다." />
          ) : (
            jobs
              .filter((job) => job.status === "배정 대기" || job.status === "재검수 대기")
              .map((job) => (
            <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{job.title}</p>
                  <p className="mt-1 text-sm text-slate-300">{job.client}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}>
                  {job.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openAssignModal(job)}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950"
                >
                  배정
                </button>
                <button
                  type="button"
                  onClick={() => void openDetailModal(job.id)}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                >
                  상세
                </button>
              </div>
            </div>
              ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="속기사 가용 현황">
        <div className="space-y-3">
          {transcribers.length === 0 ? (
            <EmptyState message="등록된 속기사 데이터가 없습니다." />
          ) : (
            transcribers.map((person) => (
            <div key={person.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{person.name}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(person.status)}`}>
                  {person.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-slate-500">진행 중</p>
                  <p className="mt-1 font-medium text-white">{person.activeJobs}건</p>
                </div>
                <div>
                  <p className="text-slate-500">월 용량</p>
                  <p className="mt-1 font-medium text-white">{person.monthlyCapacity}건</p>
                </div>
                <div>
                  <p className="text-slate-500">품질 점수</p>
                  <p className="mt-1 font-medium text-white">{person.qualityScore}</p>
                </div>
              </div>
            </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );

  const renderTranscribers = () => (
    <SectionCard
      title="속기사 관리"
      action={
        <button
          type="button"
          onClick={openCreateTranscriberModal}
          className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          추가
        </button>
      }
    >
      <div className="overflow-hidden rounded-3xl border border-white/10">
        {transcribers.length === 0 ? (
          <EmptyState message="속기사 관리 데이터가 없습니다." />
        ) : (
          <>
            <div className="hidden grid-cols-[0.9fr_1.1fr_1.2fr_0.9fr_0.7fr_0.8fr_1fr] gap-4 bg-slate-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
              <span>코드</span>
              <span>이름</span>
              <span>전문분야</span>
              <span>상태</span>
              <span>진행중</span>
              <span>월 용량</span>
              <span>동작</span>
            </div>
            <div className="divide-y divide-white/5">
              {transcribers.map((person) => (
                <div key={person.id} className="grid gap-4 bg-slate-950/40 px-4 py-4 lg:grid-cols-[0.9fr_1.1fr_1.2fr_0.9fr_0.7fr_0.8fr_1fr] lg:items-center">
                  <div className="text-sm text-slate-300">{person.id}</div>
                  <div className="text-sm font-medium text-white">{person.name}</div>
                  <div className="text-sm text-slate-300">{person.specialty}</div>
                  <div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(person.status)}`}>
                      {person.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-300">{person.activeJobs}건</div>
                  <div className="text-sm text-slate-300">{person.monthlyCapacity}건</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEditTranscriberModal(person)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeTranscriber(person)}
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );

  const renderProgress = () => (
    <SectionCard title="진행 현황">
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { title: "배정 대기", count: `${dashboardStats.waitingAssign}건`, tone: "bg-amber-500/15 text-amber-300" },
          { title: "속기사 작업 중", count: `${dashboardStats.working}건`, tone: "bg-cyan-500/15 text-cyan-300" },
          {
            title: "최종 완료",
            count: `${dashboardStats.finalDone}건`,
            tone: "bg-emerald-500/15 text-emerald-300",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <p className="text-sm text-slate-500">{item.title}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{item.count}</p>
            <div className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.tone}`}>{item.title}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderSettlements = () => (
    <SectionCard
      title="정산 관리"
      action={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveMenu("reports")}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200"
          >
            정산서 출력
          </button>
          <button
            type="button"
            onClick={() => settlements[0] && void handleSettlementConfirm(settlements[0])}
            className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            정산 확정
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {settlements.length === 0 ? (
          <EmptyState message="정산 데이터가 없습니다." />
        ) : (
          settlements.map((item) => (
          <div key={`${item.month}-${item.transcriber}`} className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 md:grid-cols-[0.9fr_1.1fr_0.8fr_1fr_0.8fr_1fr] md:items-center">
            <div className="text-sm text-slate-400">{item.month}</div>
            <div>
              <p className="font-semibold text-white">{item.transcriber}</p>
              <p className="mt-1 text-xs text-slate-500">{item.jobs}건</p>
            </div>
            <div className="text-sm text-slate-300">{item.jobs}건</div>
            <div className="font-medium text-white">{formatCurrency(item.amount)}</div>
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                {item.status}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              {item.status !== "지급 완료" ? (
                <button
                  type="button"
                  onClick={() => void handleSettlementConfirm(item)}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300"
                >
                  {item.status === "정산 대기" ? "정산 확정" : "지급 완료"}
                </button>
              ) : (
                <span className="text-xs text-slate-500">{item.paidAt}</span>
              )}
            </div>
          </div>
          ))
        )}
      </div>
    </SectionCard>
  );

  const renderSales = () => (
    <SectionCard
      title="매출 관리"
      action={
        <button
          type="button"
          onClick={() => setActiveMenu("reports")}
          className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
        >
          집계 보기
        </button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        {sales.length === 0 ? (
          <div className="xl:col-span-3">
            <EmptyState message="매출 데이터가 없습니다." />
          </div>
        ) : (
          sales.map((item) => (
          <div key={`${item.month}-${item.client}`} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{item.client}</p>
              </div>
              <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
                마진 {item.margin}
              </span>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">청구 금액</span>
                <span className="font-medium text-slate-200">{formatCurrency(item.billed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">수금 완료</span>
                <span className="font-medium text-slate-200">{formatCurrency(item.collected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">미수금</span>
                <span className="font-medium text-amber-300">{formatCurrency(item.outstanding)}</span>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={item.status === "paid"}
                onClick={() => void handleInvoiceConfirm(item)}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.status === "paid" ? "수금 완료" : "수금 완료 처리"}
              </button>
            </div>
          </div>
          ))
        )}
      </div>
    </SectionCard>
  );

  const renderReports = () => (
    <SectionCard title="집계">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="전체 의뢰" value={`${dashboardStats.totalJobs}건`} change="실시간" />
        <StatCard label="작업 중" value={`${dashboardStats.working}건`} change="실시간" />
        <StatCard label="월 매출 합계" value={formatCurrency(dashboardStats.totalSales)} change="DB 연동" />
        <StatCard label="월 정산 합계" value={formatCurrency(dashboardStats.totalSettlements)} change="DB 연동" />
      </div>
    </SectionCard>
  );

  const renderAnalytics = () => (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <SectionCard title="매출 분석">
        <div className="space-y-4">
          {sales.length === 0 ? (
            <EmptyState message="분석할 매출 데이터가 없습니다." />
          ) : (
            sales.map((item, index) => (
            <div key={item.client}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">{item.client}</span>
                <span className="text-slate-500">{33 - index * 7}% 비중</span>
              </div>
              <ProgressBar value={33 - index * 7} />
            </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="속기사 생산성 분석">
        <div className="space-y-3">
          {transcribers.length === 0 ? (
            <EmptyState message="분석할 속기사 데이터가 없습니다." />
          ) : (
            transcribers.map((person) => (
            <div key={person.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="font-medium text-white">{person.name}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-slate-200">활성 {person.activeJobs}건</p>
                <p className="mt-1 text-slate-500">품질 {person.qualityScore}</p>
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
      case "assignments":
        return renderAssignments();
      case "transcribers":
        return renderTranscribers();
      case "progress":
        return renderProgress();
      case "settlements":
        return renderSettlements();
      case "sales":
        return renderSales();
      case "reports":
        return renderReports();
      case "analytics":
        return renderAnalytics();
      default:
        return renderDashboard();
    }
  })();

  return (
    <div className="min-h-screen bg-[#050816] text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.14),transparent_24%),linear-gradient(to_bottom,rgba(15,23,42,0.82),rgba(2,6,23,0.98))]" />
        <div className="relative mx-auto grid min-h-screen max-w-[1680px] gap-6 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
          <aside className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/15 text-lg font-bold text-cyan-300">
                  BC
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Bluecom Admin</p>
                  <h1 className="mt-1 text-lg font-semibold text-white">Operations Console</h1>
                </div>
              </div>
            </div>

            <nav className="mt-6 space-y-2">
              {menuItems.map((item) => {
                const active = item.key === activeMenu;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveMenu(item.key)}
                    className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                      active
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.count ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active ? "bg-slate-950/10 text-slate-950" : "bg-white/5 text-slate-400"
                        }`}
                      >
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {busyMessage ? <div className="mt-8 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">{busyMessage}</div> : null}
          </aside>

          <main className="space-y-6">
            <header className="rounded-[28px] border border-white/10 bg-slate-950/60 px-5 py-5 backdrop-blur-xl">
              <div className="flex flex-wrap gap-2">
                <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                  전체 의뢰 {dashboardStats.totalJobs}건
                </button>
                <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                  jobs 응답 {jobs.length}건
                </button>
                <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                  미수 {formatCurrency(dashboardStats.outstanding)}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMenu("assignments")}
                  className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  새 배정 시작
                </button>
              </div>
            </header>

            {loading ? (
              <section className="rounded-[28px] border border-white/10 bg-slate-950/60 px-5 py-10 text-center text-slate-400 backdrop-blur-xl">
                관리자 데이터를 불러오는 중입니다.
              </section>
            ) : null}

            {content}
          </main>
        </div>
      </div>

      {detailJobId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold text-white">{detailJob?.title || detailJobId}</h3>
                <p className="mt-2 text-sm text-slate-400">{detailJob?.client?.name || "-"}</p>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            {detailLoading ? (
              <div className="mt-6 text-sm text-slate-400">상세 정보를 불러오는 중입니다.</div>
            ) : detailJob ? (
              <div className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">작업번호</p>
                      <p className="mt-1 text-sm text-white">{detailJob.job_id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">상태</p>
                      <p className="mt-1 text-sm text-white">{mapJobStatus(detailJob.status || "")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">담당</p>
                      <p className="mt-1 text-sm text-white">{detailJob.transcriber?.name || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">마감</p>
                      <p className="mt-1 text-sm text-white">{formatDateTime(detailJob.due_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">음성 키</p>
                      <p className="mt-1 break-all text-sm text-white">{detailJob.voice_key}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">최종 PDF</p>
                      <p className="mt-1 text-sm text-white">{detailJob.final_pdf_ready ? "준비됨" : "미준비"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const matching = jobs.find((job) => job.id === detailJob.job_id);
                        if (matching) openAssignModal(matching);
                      }}
                      className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300"
                    >
                      배정 변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const matching = jobs.find((job) => job.id === detailJob.job_id);
                        if (matching) void handleJobAdvance(matching);
                      }}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200"
                    >
                      상태 진행
                    </button>
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                  <p className="text-xs text-slate-500">전사 미리보기</p>
                  <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                    {transcriptPreview(detailJob)}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {assignTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold text-white">속기사 배정</h3>
                <p className="mt-2 text-sm text-slate-400">{assignTarget.title}</p>
              </div>
              <button
                type="button"
                onClick={closeAssignModal}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs text-slate-500">속기사 선택</label>
                <select
                  value={selectedTranscriberCode}
                  onChange={(e) => setSelectedTranscriberCode(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                >
                  {transcribers.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} / {person.status} / 활성 {person.activeJobs}건
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
                <p>{assignTarget.client}</p>
                <p className="mt-1">{assignTarget.id}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAssignModal}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void confirmAssignModal()}
                  className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  배정 확정
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transcriberModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold text-white">{editingTranscriberId ? "속기사 수정" : "속기사 추가"}</h3>
              </div>
              <button
                type="button"
                onClick={closeTranscriberModal}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300"
              >
                닫기
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">코드</span>
                <input
                  value={transcriberForm.code || "자동 생성 중..."}
                  readOnly
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-300"
                />
                {!editingTranscriberId ? (
                  <span className="mt-1 block text-xs text-slate-500">저장 시 서버에서 자동 생성됩니다.</span>
                ) : null}
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">이름</span>
                <input
                  value={transcriberForm.name}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="이름"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">휴대폰 번호</span>
                <input
                  value={transcriberForm.phone}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100"
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">주민등록번호</span>
                <input
                  value={transcriberForm.residentId}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, residentId: e.target.value }))}
                  placeholder="000000-0000000"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">은행명</span>
                <input
                  value={transcriberForm.bankName}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, bankName: e.target.value }))}
                  placeholder="예: 국민은행"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">계좌번호</span>
                <input
                  value={transcriberForm.accountNumber}
                  onChange={(e) => setTranscriberForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  placeholder="계좌번호"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTranscriberModal}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveTranscriberModal()}
                className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
