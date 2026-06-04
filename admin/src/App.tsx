import { useMemo, useState } from "react";

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
  specialty: string;
  status: TranscriberStatus;
  activeJobs: number;
  monthlyCapacity: number;
  unitPrice: string;
  qualityScore: string;
};

type SettlementItem = {
  month: string;
  transcriber: string;
  jobs: number;
  amount: number;
  status: SettlementStatus;
  paidAt: string;
};

type SalesItem = {
  month: string;
  client: string;
  billed: number;
  collected: number;
  outstanding: number;
  margin: string;
};

const MENU: MenuItem[] = [
  { key: "dashboard", label: "대시보드" },
  { key: "jobs", label: "의뢰 / 파일 관리", count: "148" },
  { key: "assignments", label: "배정 관리", count: "19" },
  { key: "transcribers", label: "속기사 관리", count: "24" },
  { key: "progress", label: "진행 현황", count: "36" },
  { key: "settlements", label: "정산 관리" },
  { key: "sales", label: "매출 관리" },
  { key: "reports", label: "집계" },
  { key: "analytics", label: "분석" },
];

const JOBS: JobItem[] = [
  {
    id: "REC-20260604-001",
    client: "세종법무법인",
    title: "형사사건 녹취 초안",
    filename: "meeting_0604_client01.m4a",
    uploadedAt: "2026-06-04 09:12",
    dueAt: "2026-06-04 18:00",
    priority: "긴급",
    status: "속기사 작업 중",
    assignee: "김민서",
    progress: 68,
    duration: "01:42:18",
    salesAmount: 420000,
    settlementAmount: 180000,
    paymentStatus: "부분 입금",
    settlementStatus: "정산 대기",
  },
  {
    id: "REC-20260604-002",
    client: "하나손해보험",
    title: "보험 상담 통화 정리",
    filename: "consulting_batch_12.wav",
    uploadedAt: "2026-06-04 08:45",
    dueAt: "2026-06-05 11:00",
    priority: "일반",
    status: "배정 대기",
    assignee: "-",
    progress: 12,
    duration: "00:38:06",
    salesAmount: 130000,
    settlementAmount: 52000,
    paymentStatus: "미수",
    settlementStatus: "정산 대기",
  },
  {
    id: "REC-20260603-118",
    client: "케이메디컬",
    title: "의료 자문 회의록",
    filename: "medical_roundtable.mp3",
    uploadedAt: "2026-06-03 16:20",
    dueAt: "2026-06-04 16:00",
    priority: "일반",
    status: "의뢰인 수정 중",
    assignee: "박지안",
    progress: 82,
    duration: "00:56:44",
    salesAmount: 250000,
    settlementAmount: 98000,
    paymentStatus: "입금 완료",
    settlementStatus: "정산 확정",
  },
  {
    id: "REC-20260603-109",
    client: "아인파트너스",
    title: "임원 인터뷰 녹취",
    filename: "board_interview_2.webm",
    uploadedAt: "2026-06-03 14:08",
    dueAt: "2026-06-04 13:00",
    priority: "긴급",
    status: "재검수 대기",
    assignee: "정수빈",
    progress: 91,
    duration: "01:17:09",
    salesAmount: 390000,
    settlementAmount: 160000,
    paymentStatus: "미수",
    settlementStatus: "정산 대기",
  },
  {
    id: "REC-20260602-094",
    client: "블루컴 본사",
    title: "제품 전략 회의",
    filename: "strategy_room_0602.mp4",
    uploadedAt: "2026-06-02 11:30",
    dueAt: "2026-06-03 17:00",
    priority: "일반",
    status: "최종 완료",
    assignee: "김민서",
    progress: 100,
    duration: "01:08:51",
    salesAmount: 310000,
    settlementAmount: 130000,
    paymentStatus: "입금 완료",
    settlementStatus: "지급 완료",
  },
];

const TRANSCRIBERS: Transcriber[] = [
  {
    id: "TR-001",
    name: "김민서",
    specialty: "법률 / 인터뷰",
    status: "작업 중",
    activeJobs: 6,
    monthlyCapacity: 28,
    unitPrice: "분당 1,800원",
    qualityScore: "4.9 / 5",
  },
  {
    id: "TR-002",
    name: "박지안",
    specialty: "의료 / 회의록",
    status: "작업 가능",
    activeJobs: 3,
    monthlyCapacity: 24,
    unitPrice: "분당 1,700원",
    qualityScore: "4.7 / 5",
  },
  {
    id: "TR-003",
    name: "정수빈",
    specialty: "방송 / 대담",
    status: "작업 중",
    activeJobs: 5,
    monthlyCapacity: 26,
    unitPrice: "분당 1,850원",
    qualityScore: "4.8 / 5",
  },
  {
    id: "TR-004",
    name: "이도현",
    specialty: "교육 / 세미나",
    status: "휴무",
    activeJobs: 0,
    monthlyCapacity: 20,
    unitPrice: "분당 1,500원",
    qualityScore: "4.6 / 5",
  },
];

const SETTLEMENTS: SettlementItem[] = [
  { month: "2026-06", transcriber: "김민서", jobs: 18, amount: 2180000, status: "정산 대기", paidAt: "-" },
  { month: "2026-06", transcriber: "박지안", jobs: 11, amount: 1240000, status: "정산 확정", paidAt: "-" },
  { month: "2026-05", transcriber: "정수빈", jobs: 21, amount: 2490000, status: "지급 완료", paidAt: "2026-06-03" },
];

const SALES: SalesItem[] = [
  { month: "2026-06", client: "세종법무법인", billed: 6480000, collected: 4200000, outstanding: 2280000, margin: "41%" },
  { month: "2026-06", client: "하나손해보험", billed: 3920000, collected: 1810000, outstanding: 2110000, margin: "38%" },
  { month: "2026-06", client: "케이메디컬", billed: 2870000, collected: 2870000, outstanding: 0, margin: "44%" },
];

const ACTIVITY_FEED = [
  { time: "10:24", title: "REC-20260604-001 재배정 요청", detail: "운영자 김나연이 김민서 유지로 확정" },
  { time: "09:58", title: "세종법무법인 긴급 의뢰 등록", detail: "마감 18:00, 우선순위 상향" },
  { time: "09:21", title: "박지안 정산 확정", detail: "6월 1차 정산 확정 1,240,000원" },
  { time: "08:46", title: "하나손해보험 신규 파일 업로드", detail: "REC-20260604-002 생성" },
];

function formatCurrency(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
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

function App() {
  const [activeMenu, setActiveMenu] = useState<MenuKey>("dashboard");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"전체" | JobStatus>("전체");

  const visibleJobs = useMemo(() => {
    return JOBS.filter((job) => {
      const matchesQuery =
        !query.trim() ||
        [job.id, job.client, job.title, job.filename, job.assignee]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      const matchesStatus = statusFilter === "전체" || job.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter]);

  const dashboardStats = useMemo(() => {
    const totalSales = JOBS.reduce((sum, job) => sum + job.salesAmount, 0);
    const totalSettlements = JOBS.reduce((sum, job) => sum + job.settlementAmount, 0);
    const outstanding = JOBS.filter((job) => job.paymentStatus !== "입금 완료").reduce(
      (sum, job) => sum + job.salesAmount,
      0,
    );
    const waitingAssign = JOBS.filter((job) => job.status === "배정 대기").length;
    return { totalSales, totalSettlements, outstanding, waitingAssign };
  }, []);

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
          subtitle="오늘 우선 대응이 필요한 작업을 기준으로 정렬한 운영 보드"
          action={
            <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10">
              전체 작업 보기
            </button>
          }
        >
          <div className="space-y-3">
            {JOBS.filter((job) => job.priority === "긴급").map((job) => (
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
                    <p className="mt-1 text-sm text-slate-400">
                      {job.client} · {job.filename}
                    </p>
                  </div>
                  <div className="text-right text-sm text-slate-400">
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
            ))}
          </div>
        </SectionCard>

        <SectionCard title="운영 피드" subtitle="업로드, 배정, 정산 관련 최근 활동">
          <div className="space-y-4">
            {ACTIVITY_FEED.map((item) => (
              <div key={`${item.time}-${item.title}`} className="flex gap-3">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );

  const renderJobs = () => (
    <SectionCard
      title="의뢰 / 파일 관리"
      subtitle="의뢰인이 업로드한 파일을 조회하고 담당자, 마감일, 상태를 운영 단위로 관리합니다."
      action={
        <div className="flex gap-2">
          <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10">
            일괄 배정
          </button>
          <button className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            신규 의뢰 등록
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
        <div className="hidden grid-cols-[1.2fr_1.2fr_1fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-4 bg-slate-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
          <span>작업</span>
          <span>의뢰인 / 파일</span>
          <span>담당 / 마감</span>
          <span>상태</span>
          <span>진행률</span>
          <span>매출</span>
          <span>동작</span>
        </div>
        <div className="divide-y divide-white/5">
          {visibleJobs.map((job) => (
            <div key={job.id} className="grid gap-4 bg-slate-950/40 px-4 py-4 lg:grid-cols-[1.2fr_1.2fr_1fr_0.9fr_0.8fr_0.8fr_0.8fr] lg:items-center">
              <div>
                <p className="font-semibold text-white">{job.title}</p>
                <p className="mt-1 text-xs text-slate-500">{job.id}</p>
              </div>
              <div>
                <p className="text-sm text-slate-200">{job.client}</p>
                <p className="mt-1 text-xs text-slate-500">{job.filename}</p>
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
                <div className="mb-2 flex justify-between text-xs text-slate-500">
                  <span>{job.progress}%</span>
                  <span>{job.duration}</span>
                </div>
                <ProgressBar value={job.progress} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{formatCurrency(job.salesAmount)}</p>
                <p className="mt-1 text-xs text-slate-500">{job.paymentStatus}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/5">
                  상세
                </button>
                <button className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/20">
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
      <SectionCard title="배정 대기 작업" subtitle="가용 인원과 전문 분야를 기준으로 빠르게 배정하는 운영 화면">
        <div className="space-y-3">
          {JOBS.filter((job) => job.status === "배정 대기" || job.status === "재검수 대기").map((job) => (
            <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{job.title}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {job.client} · {job.duration} · 마감 {job.dueAt}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}>
                  {job.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950">
                  김민서에게 배정
                </button>
                <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200">
                  후보 보기
                </button>
                <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200">
                  배정 메모
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="속기사 가용 현황" subtitle="전문 분야, 현재 작업량, 품질 지표를 보고 배정 판단">
        <div className="space-y-3">
          {TRANSCRIBERS.map((person) => (
            <div key={person.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{person.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{person.specialty}</p>
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
          ))}
        </div>
      </SectionCard>
    </div>
  );

  const renderTranscribers = () => (
    <SectionCard
      title="속기사 관리"
      subtitle="속기사 마스터, 상태, 단가, 전문 분야를 관리하는 운영 화면"
      action={
        <button className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
          속기사 등록
        </button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {TRANSCRIBERS.map((person) => (
          <div key={person.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{person.name}</p>
                <p className="mt-1 text-sm text-slate-400">{person.specialty}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(person.status)}`}>
                {person.status}
              </span>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">단가</span>
                <span className="font-medium text-slate-200">{person.unitPrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">진행 중</span>
                <span className="font-medium text-slate-200">{person.activeJobs}건</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">월 용량</span>
                <span className="font-medium text-slate-200">{person.monthlyCapacity}건</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">품질</span>
                <span className="font-medium text-slate-200">{person.qualityScore}</span>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200">
                수정
              </button>
              <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200">
                상태 변경
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderProgress = () => (
    <SectionCard title="진행 현황" subtitle="작업 상태 분포와 지연 위험 건을 중심으로 보는 화면">
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { title: "배정 대기", count: "19건", tone: "bg-amber-500/15 text-amber-300" },
          { title: "속기사 작업 중", count: "11건", tone: "bg-cyan-500/15 text-cyan-300" },
          { title: "마감 임박", count: "7건", tone: "bg-rose-500/15 text-rose-300" },
        ].map((item) => (
          <div key={item.title} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <p className="text-sm text-slate-500">{item.title}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{item.count}</p>
            <div className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.tone}`}>
              운영 우선 모니터링
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderSettlements = () => (
    <SectionCard
      title="정산 관리"
      subtitle="속기사별 정산 예정액, 확정액, 지급 완료 내역을 관리합니다."
      action={
        <div className="flex gap-2">
          <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200">
            정산서 출력
          </button>
          <button className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">
            정산 확정
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {SETTLEMENTS.map((item) => (
          <div key={`${item.month}-${item.transcriber}`} className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 md:grid-cols-[0.9fr_1.1fr_0.8fr_1fr_0.8fr_0.8fr] md:items-center">
            <div className="text-sm text-slate-400">{item.month}</div>
            <div>
              <p className="font-semibold text-white">{item.transcriber}</p>
              <p className="mt-1 text-xs text-slate-500">{item.jobs}건 처리</p>
            </div>
            <div className="text-sm text-slate-300">{item.jobs}건</div>
            <div className="font-medium text-white">{formatCurrency(item.amount)}</div>
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                {item.status}
              </span>
            </div>
            <div className="text-sm text-slate-400">{item.paidAt}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderSales = () => (
    <SectionCard
      title="매출 관리"
      subtitle="고객사별 청구 금액, 수금 현황, 마진을 관리하는 화면"
      action={
        <button className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">
          매출 확정
        </button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        {SALES.map((item) => (
          <div key={`${item.month}-${item.client}`} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{item.client}</p>
                <p className="mt-1 text-sm text-slate-500">{item.month}</p>
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
          </div>
        ))}
      </div>
    </SectionCard>
  );

  const renderReports = () => (
    <SectionCard title="집계" subtitle="기간별 운영 지표를 숫자 중심으로 확인하는 화면">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="일간 접수" value="24건" change="+4건" />
        <StatCard label="주간 완료" value="81건" change="+9.3%" />
        <StatCard label="월 매출 합계" value="13,270,000원" change="+14.2%" />
        <StatCard label="월 정산 합계" value="5,910,000원" change="+7.6%" />
      </div>
    </SectionCard>
  );

  const renderAnalytics = () => (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <SectionCard title="매출 분석" subtitle="고객사별 매출 비중과 수익성 비교">
        <div className="space-y-4">
          {SALES.map((item, index) => (
            <div key={item.client}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">{item.client}</span>
                <span className="text-slate-500">{33 - index * 7}% 비중</span>
              </div>
              <ProgressBar value={33 - index * 7} />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="속기사 생산성 분석" subtitle="처리량, 품질 점수, 가용량을 함께 보는 비교 카드">
        <div className="space-y-3">
          {TRANSCRIBERS.map((person) => (
            <div key={person.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="font-medium text-white">{person.name}</p>
                <p className="mt-1 text-xs text-slate-500">{person.specialty}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-slate-200">활성 {person.activeJobs}건</p>
                <p className="mt-1 text-slate-500">품질 {person.qualityScore}</p>
              </div>
            </div>
          ))}
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
              <p className="mt-4 text-sm leading-6 text-slate-400">
                의뢰 파일 운영, 속기사 배정, 매출/정산, 집계/분석까지 한 화면 흐름으로 정리한 관리자 와이어프레임
              </p>
            </div>

            <nav className="mt-6 space-y-2">
              {MENU.map((item) => {
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

            <div className="mt-8 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Deployment</p>
              <p className="mt-3 text-sm text-slate-200">Netlify 정적 배포를 기준으로 구성한 SPA 와이어프레임</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                이후 API 연동 전까지는 목업 데이터 기반으로 구조와 인터랙션을 먼저 검증하는 단계입니다.
              </p>
            </div>
          </aside>

          <main className="space-y-6">
            <header className="rounded-[28px] border border-white/10 bg-slate-950/60 px-5 py-5 backdrop-blur-xl">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-sm font-medium text-cyan-300">세련된 다크모드 관리자 UI 시안</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                    파일 운영부터 매출 분석까지 이어지는 Admin Workspace
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                    실제 운영자가 가장 많이 쓰는 흐름을 기준으로 작업 보드, 배정, 속기사 관리, 진행 현황,
                    정산, 매출, 집계, 분석 화면을 하나의 경험으로 엮었습니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                    오늘 업로드 24건
                  </button>
                  <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                    미수 4건
                  </button>
                  <button className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
                    새 배정 시작
                  </button>
                </div>
              </div>
            </header>

            {content}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
