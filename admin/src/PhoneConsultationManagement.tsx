import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchPhoneConsultations, type PhoneConsultation } from "./api";

const INQUIRY_LABELS: Record<string, string> = {
  recording: "녹취",
  onsite: "출장",
  foreign: "외국어",
  phone_restore: "폰복원",
};

const ORDER_LABELS: Record<string, string> = {
  reorder: "재주문",
  new: "신규",
  company: "업체",
};

const FILE_KIND_LABELS: Record<string, string> = {
  field: "현장",
  call: "통화",
};

const DELIVERY_LABELS: Record<string, string> = {
  pdf: "PDF",
  registered: "등기",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "임시저장",
  completed: "완료",
};

function labelOf(map: Record<string, string>, value: string): string {
  if (!value) return "—";
  return map[value] ?? value;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits || "—";
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

function formatAmount(value: number): string {
  if (!value) return "—";
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function SummaryChip({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "cyan" | "amber";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-slate-700 bg-slate-950/70 text-slate-200";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

type StatusFilter = "all" | "draft" | "completed";

export default function PhoneConsultationManagement() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PhoneConsultation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<PhoneConsultation | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const consultations = await fetchPhoneConsultations({
        status: statusFilter === "all" ? undefined : statusFilter,
        q: query.trim() || undefined,
        limit: 300,
      });
      setRows(consultations);
    } catch (err) {
      console.error(err);
      setRows([]);
      setError(err instanceof Error ? err.message : "전화상담 내역을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const stats = useMemo(() => {
    const draft = rows.filter((r) => r.status === "draft").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const amount = rows.reduce((sum, r) => sum + (r.estimated_amount || 0), 0);
    return { total: rows.length, draft, completed, amount };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryChip label="조회 건수" value={`${stats.total}건`} />
        <SummaryChip label="임시저장" value={`${stats.draft}건`} tone="amber" />
        <SummaryChip label="완료" value={`${stats.completed}건`} tone="cyan" />
        <SummaryChip label="예상금액 합계" value={formatAmount(stats.amount)} />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">상담 내역</h3>
            <p className="mt-1 text-[12px] text-slate-400">
              TelWork 전화상담 등록 건을 확인하고 상세 메모를 조회합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 · 전화 · 담당자 검색"
              className="min-h-10 min-w-[200px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
            >
              <option value="all">전체 상태</option>
              <option value="draft">임시저장</option>
              <option value="completed">완료</option>
            </select>
            <button
              type="button"
              onClick={() => void loadRows()}
              className="min-h-10 rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm font-semibold text-slate-100 hover:bg-slate-700"
            >
              새로고침
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
          <table className="w-full min-w-[1180px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <th className="px-3 py-2">등록일시</th>
                <th className="px-3 py-2">의뢰인</th>
                <th className="px-3 py-2">전화</th>
                <th className="px-3 py-2">문의</th>
                <th className="px-3 py-2">주문</th>
                <th className="px-3 py-2">파일</th>
                <th className="px-3 py-2">분량</th>
                <th className="px-3 py-2">예상금액</th>
                <th className="px-3 py-2">마감</th>
                <th className="px-3 py-2">담당</th>
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    표시할 상담 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60"
                    onClick={() => setSelected(row)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-100">{row.customer_name || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatPhone(row.phone)}</td>
                    <td className="px-3 py-2">{labelOf(INQUIRY_LABELS, row.inquiry_type)}</td>
                    <td className="px-3 py-2">{labelOf(ORDER_LABELS, row.order_type)}</td>
                    <td className="px-3 py-2">
                      {labelOf(FILE_KIND_LABELS, row.file_kind)}
                      {row.file_count ? ` · ${row.file_count}` : ""}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDuration(row.duration_seconds)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatAmount(row.estimated_amount)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.deadline)}</td>
                    <td className="px-3 py-2">{row.assignee || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-lg px-2 py-1 text-[11px] font-semibold ${
                          row.status === "completed"
                            ? "bg-cyan-500/15 text-cyan-200"
                            : "bg-amber-500/15 text-amber-200"
                        }`}
                      >
                        {labelOf(STATUS_LABELS, row.status)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{selected.customer_name || "상담 상세"}</h3>
                <p className="mt-1 text-sm text-slate-400">{formatPhone(selected.phone)}</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => setSelected(null)}
              >
                닫기
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
              <Detail label="문의 유형" value={labelOf(INQUIRY_LABELS, selected.inquiry_type)} />
              <Detail label="주문사항" value={labelOf(ORDER_LABELS, selected.order_type)} />
              <Detail label="파일 종류" value={labelOf(FILE_KIND_LABELS, selected.file_kind)} />
              <Detail label="파일 개수" value={selected.file_count || "—"} />
              <Detail
                label="작성 구간"
                value={
                  selected.range_start || selected.range_end
                    ? `${selected.range_start || "—"} ~ ${selected.range_end || "—"}`
                    : "—"
                }
              />
              <Detail label="예상분량" value={formatDuration(selected.duration_seconds)} />
              <Detail label="예상금액" value={formatAmount(selected.estimated_amount)} />
              <Detail label="전달방법" value={labelOf(DELIVERY_LABELS, selected.delivery_method)} />
              <Detail label="마감일시" value={formatDateTime(selected.deadline)} />
              <Detail label="담당자" value={selected.assignee || "—"} />
              <Detail label="상태" value={labelOf(STATUS_LABELS, selected.status)} />
              <Detail label="등록일시" value={formatDateTime(selected.created_at)} />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">상담 메모</p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm text-slate-200">
                {selected.memo || "메모 없음"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-slate-100">{value}</p>
    </div>
  );
}
