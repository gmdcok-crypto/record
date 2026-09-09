import { useMemo, useState } from "react";
import type { TranscriberProject, TranscriberProjectFile } from "./api";
import { formatKstDateTime } from "./formatKstDateTime";

export type MyWorkStatusKey =
  | "all"
  | "new_assign"
  | "writing"
  | "draft_submitted"
  | "admin_review"
  | "revision"
  | "done";

export type MyWorkTypeKey = "all" | "write" | "revise" | "done";

type MyWorkRow = {
  jobId: string;
  projectKey: string;
  requestNo: string;
  title: string;
  type: Exclude<MyWorkTypeKey, "all">;
  typeLabel: string;
  durationLabel: string;
  dueLabel: string;
  dueAt: string | null;
  statusKey: Exclude<MyWorkStatusKey, "all">;
  statusLabel: string;
};

const STATUS_TABS: { key: MyWorkStatusKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "new_assign", label: "신규 배정" },
  { key: "writing", label: "작성 중" },
  { key: "draft_submitted", label: "초안 제출" },
  { key: "admin_review", label: "관리자 확인 중" },
  { key: "revision", label: "수정 요청" },
  { key: "done", label: "완료" },
];

const TYPE_OPTIONS: { key: MyWorkTypeKey; label: string }[] = [
  { key: "all", label: "전체 유형" },
  { key: "write", label: "작성" },
  { key: "revise", label: "수정" },
  { key: "done", label: "완료" },
];

const PAGE_SIZE = 10;

function normalizeWorkflowStatus(status: string): string {
  switch (status) {
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
      return status;
  }
}

function mapWorkStatus(status: string): Exclude<MyWorkStatusKey, "all"> {
  switch (normalizeWorkflowStatus(status)) {
    case "waiting_assignment":
      return "new_assign";
    case "working":
      return "writing";
    case "client_review":
      return "draft_submitted";
    case "transcriber_review":
      return "admin_review";
    case "transcript_request":
      return "revision";
    case "pdf_sent":
      return "done";
    default:
      return "writing";
  }
}

function mapWorkStatusLabel(key: Exclude<MyWorkStatusKey, "all">): string {
  switch (key) {
    case "new_assign":
      return "신규 배정";
    case "writing":
      return "작성 중";
    case "draft_submitted":
      return "초안 제출";
    case "admin_review":
      return "관리자 확인 중";
    case "revision":
      return "수정 요청";
    case "done":
      return "완료";
  }
}

function mapWorkType(statusKey: Exclude<MyWorkStatusKey, "all">): Exclude<MyWorkTypeKey, "all"> {
  if (statusKey === "revision") return "revise";
  if (statusKey === "done") return "done";
  return "write";
}

function mapWorkTypeLabel(type: Exclude<MyWorkTypeKey, "all">): string {
  switch (type) {
    case "write":
      return "작성";
    case "revise":
      return "수정";
    case "done":
      return "완료";
  }
}

function formatRequestNo(jobId: string): string {
  const trimmed = jobId.trim();
  if (/^BP-/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^\d{6,}/.test(trimmed)) return `BP-${trimmed.slice(0, 6)}-${trimmed.slice(-3).padStart(3, "0")}`;
  return trimmed || "—";
}

function formatDurationMinutes(totalSeconds: number | undefined, fileCount: number): string {
  if (!totalSeconds || totalSeconds <= 0 || fileCount <= 0) return "—";
  const minutes = Math.max(1, Math.round(totalSeconds / fileCount / 60));
  return `${minutes}분`;
}

function formatDueShort(value: string | null | undefined): string {
  if (!value) return "—";
  const full = formatKstDateTime(value);
  if (!full || full === "—") return "—";
  // Expect "YYYY-MM-DD HH:mm" style → "MM.DD HH:mm"
  const match = full.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
  if (match) return `${match[2]}.${match[3]} ${match[4]}`;
  return full;
}

function projectKeyOf(project: TranscriberProject): string {
  return project.project_id || `solo-${project.files[0]?.job_id || project.title}`;
}

function fileStatus(file: TranscriberProjectFile): string {
  return file.workflow_status || file.status || "";
}

function buildRows(projects: TranscriberProject[]): MyWorkRow[] {
  const rows: MyWorkRow[] = [];
  for (const project of projects) {
    const fileCount = Math.max(1, project.file_count || project.files.length || 1);
    const durationLabel = formatDurationMinutes(project.total_duration_seconds, fileCount);
    for (const file of project.files) {
      const statusKey = mapWorkStatus(fileStatus(file));
      const type = mapWorkType(statusKey);
      rows.push({
        jobId: file.job_id,
        projectKey: projectKeyOf(project),
        requestNo: formatRequestNo(file.job_id),
        title: file.title || file.filename || project.title || "작업",
        type,
        typeLabel: mapWorkTypeLabel(type),
        durationLabel,
        dueLabel: formatDueShort(file.due_at || project.due_at),
        dueAt: file.due_at || project.due_at,
        statusKey,
        statusLabel: mapWorkStatusLabel(statusKey),
      });
    }
  }
  return rows.sort((a, b) => {
    const aTime = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const bTime = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
}

function statusBadgeClass(key: Exclude<MyWorkStatusKey, "all">): string {
  switch (key) {
    case "new_assign":
      return "my-work-badge my-work-badge--new";
    case "writing":
      return "my-work-badge my-work-badge--writing";
    case "draft_submitted":
      return "my-work-badge my-work-badge--draft";
    case "admin_review":
      return "my-work-badge my-work-badge--review";
    case "revision":
      return "my-work-badge my-work-badge--revision";
    case "done":
      return "my-work-badge my-work-badge--done";
  }
}

type MyWorkPageProps = {
  projects: TranscriberProject[];
  loading?: boolean;
  onOpenJob: (jobId: string, projectKey: string) => void;
};

export default function MyWorkPage({ projects, loading = false, onOpenJob }: MyWorkPageProps) {
  const [statusTab, setStatusTab] = useState<MyWorkStatusKey>("all");
  const [typeFilter, setTypeFilter] = useState<MyWorkTypeKey>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => buildRows(projects), [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusTab !== "all" && row.statusKey !== statusTab) return false;
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (dateFrom) {
        const from = Date.parse(`${dateFrom}T00:00:00`);
        const due = row.dueAt ? Date.parse(row.dueAt) : NaN;
        if (!Number.isNaN(from) && (Number.isNaN(due) || due < from)) return false;
      }
      if (dateTo) {
        const to = Date.parse(`${dateTo}T23:59:59`);
        const due = row.dueAt ? Date.parse(row.dueAt) : NaN;
        if (!Number.isNaN(to) && (Number.isNaN(due) || due > to)) return false;
      }
      if (q) {
        const hay = `${row.requestNo} ${row.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusTab, typeFilter, dateFrom, dateTo, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function changeStatusTab(key: MyWorkStatusKey) {
    setStatusTab(key);
    setPage(1);
  }

  function changeTypeFilter(key: MyWorkTypeKey) {
    setTypeFilter(key);
    setPage(1);
  }

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    const list: number[] = [];
    for (let i = start; i <= end; i += 1) list.push(i);
    return list;
  }, [safePage, totalPages]);

  return (
    <section className="my-work">
      <header className="my-work-header">
        <h1 className="my-work-title">내 작업</h1>
      </header>

      <div className="my-work-tabs" role="tablist" aria-label="작업 상태">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={statusTab === tab.key}
            className={`my-work-tab${statusTab === tab.key ? " is-active" : ""}`}
            onClick={() => changeStatusTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="my-work-filters">
        <label className="my-work-filter">
          <span className="sr-only">유형</span>
          <select
            value={typeFilter}
            onChange={(e) => changeTypeFilter(e.target.value as MyWorkTypeKey)}
            aria-label="전체 유형"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="my-work-filter my-work-filter--dates">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="시작일"
          />
          <span className="my-work-date-sep">~</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="종료일"
          />
        </div>

        <label className="my-work-filter my-work-filter--search">
          <span className="sr-only">검색</span>
          <input
            type="search"
            placeholder="의뢰번호/작업명 검색"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <span className="my-work-search-icon" aria-hidden="true">
            ⌕
          </span>
        </label>
      </div>

      <div className="my-work-table-wrap">
        <table className="my-work-table">
          <thead>
            <tr>
              <th>의뢰번호</th>
              <th>작업명</th>
              <th>유형</th>
              <th>녹음시간</th>
              <th>마감일</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="my-work-empty">
                  불러오는 중…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="my-work-empty">
                  표시할 작업이 없습니다.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.jobId} onClick={() => onOpenJob(row.jobId, row.projectKey)}>
                  <td className="my-work-mono">{row.requestNo}</td>
                  <td className="my-work-title-cell">{row.title}</td>
                  <td>{row.typeLabel}</td>
                  <td>{row.durationLabel}</td>
                  <td>{row.dueLabel}</td>
                  <td>
                    <span className={statusBadgeClass(row.statusKey)}>{row.statusLabel}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="my-work-pagination" aria-label="페이지">
        <button
          type="button"
          className="my-work-page-btn"
          disabled={safePage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          aria-label="이전 페이지"
        >
          ‹
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            type="button"
            className={`my-work-page-btn${n === safePage ? " is-active" : ""}`}
            onClick={() => setPage(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="my-work-page-btn"
          disabled={safePage >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          aria-label="다음 페이지"
        >
          ›
        </button>
      </div>
    </section>
  );
}
