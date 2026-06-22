import { useCallback, useEffect, useMemo, useState } from "react";

import {
  confirmSettlementSnapshot,
  fetchSettlementSnapshots,
  type SettlementSnapshotRow,
} from "./api";
import { todayKstDateKey } from "./formatKstDateTime";

type SettlementStatus = "정산 대기" | "정산 확정" | "지급 완료";

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
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

function settlementStatusTone(status: SettlementStatus): string {
  switch (status) {
    case "지급 완료":
      return "bg-emerald-500/15 text-emerald-300";
    case "정산 확정":
      return "bg-cyan-500/15 text-cyan-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
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

type TranscriberSettlementPanelProps = {
  refreshToken?: number;
  onPay?: (row: SettlementSnapshotRow) => void;
  onChanged?: () => void;
};

export default function TranscriberSettlementPanel({ refreshToken = 0, onPay, onChanged }: TranscriberSettlementPanelProps) {
  const [asOf, setAsOf] = useState(() => todayKstDateKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthLabel, setMonthLabel] = useState("");
  const [summary, setSummary] = useState({ total_jobs: 0, total_amount: 0, total_net_pay_amount: 0, active_settlement_count: 0 });
  const [rows, setRows] = useState<SettlementSnapshotRow[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const visibleRows = useMemo(() => rows.filter((row) => row.jobs > 0), [rows]);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSettlementSnapshots(asOf);
      setMonthLabel(data.month);
      setSummary({
        total_jobs: data.summary.total_jobs,
        total_amount: data.summary.total_amount,
        total_net_pay_amount: data.summary.total_net_pay_amount,
        active_settlement_count: data.summary.active_settlement_count,
      });
      setRows(data.rows);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "정산 내역을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots, refreshToken]);

  const handleConfirm = async (row: SettlementSnapshotRow) => {
    if (!row.can_confirm) return;
    if (!window.confirm(`${row.transcriber_name} ${monthLabel} 정산을 확정하시겠습니까?`)) return;
    setConfirmingId(row.transcriber_id);
    try {
      await confirmSettlementSnapshot(row.transcriber_id, asOf);
      await loadSnapshots();
      onChanged?.();
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "정산 확정에 실패했습니다.");
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">정산 관리</p>
          <h3 className="mt-1 text-lg font-semibold text-white">당월 정산</h3>
          <p className="mt-1 text-sm text-slate-400">
            기준일까지 완료된 작업을 집계합니다. 원천징수 3.3% 공제 후 실지급액을 익월에 지급합니다.
          </p>
        </div>
        <label className="block w-full max-w-[220px]">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">기준일</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <SummaryChip label={`${monthLabel || "-"} 정산 대상`} value={`${summary.active_settlement_count}명`} />
        <SummaryChip label="완료 건수" value={`${summary.total_jobs}건`} tone="cyan" />
        <SummaryChip label="총 정산액" value={formatCurrency(summary.total_amount)} tone="amber" />
        <SummaryChip label="실지급 합계" value={formatCurrency(summary.total_net_pay_amount)} tone="cyan" />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">정산 내역을 불러오는 중...</div>
        ) : visibleRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">선택한 기준일까지 정산할 완료 작업이 없습니다.</div>
        ) : (
          <table className="w-full min-w-[1280px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">속기사</th>
                <th className="px-3 py-2">총금액</th>
                <th className="px-3 py-2">3%</th>
                <th className="px-3 py-2">0.3%</th>
                <th className="px-3 py-2">3.3%</th>
                <th className="px-3 py-2">실지급액</th>
                <th className="px-3 py-2">은행</th>
                <th className="px-3 py-2">계좌번호</th>
                <th className="px-3 py-2">예금주</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">동작</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const status = mapSettlementStatus(row.status);
                return (
                  <tr key={row.transcriber_id} className="border-t border-slate-800 bg-slate-950/40 text-slate-300">
                    <td className="px-3 py-2">
                      <p className="font-medium text-white">{row.transcriber_name}</p>
                      <p className="text-[11px] text-slate-500">{row.transcriber_code}</p>
                    </td>
                    <td className="px-3 py-2 font-medium text-white">{formatCurrency(row.amount)}</td>
                    <td className="px-3 py-2 text-rose-300">-{formatCurrency(row.income_tax)}</td>
                    <td className="px-3 py-2 text-rose-300">-{formatCurrency(row.local_tax)}</td>
                    <td className="px-3 py-2 text-rose-300">-{formatCurrency(row.total_withholding)}</td>
                    <td className="px-3 py-2 font-semibold text-cyan-200">{formatCurrency(row.net_pay_amount)}</td>
                    <td className="px-3 py-2">{row.bank_name || "-"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{row.account_number || "-"}</td>
                    <td className="px-3 py-2">{row.account_holder || "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${settlementStatusTone(status)}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!row.can_confirm || confirmingId === row.transcriber_id}
                          onClick={() => void handleConfirm(row)}
                          className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {confirmingId === row.transcriber_id ? "확정 중..." : "확정"}
                        </button>
                        {row.can_pay && onPay ? (
                          <button
                            type="button"
                            onClick={() => onPay(row)}
                            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300"
                          >
                            지급
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
