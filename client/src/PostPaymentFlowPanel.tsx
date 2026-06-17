import type { PostPaymentStepTrace } from "./postPaymentFlow";

type PostPaymentFlowPanelProps = {
  trace: PostPaymentStepTrace[];
  visible: boolean;
};

function statusSymbol(status: PostPaymentStepTrace["status"]): string {
  switch (status) {
    case "ok":
      return "✓";
    case "running":
      return "…";
    case "error":
      return "✕";
    case "skipped":
      return "–";
    default:
      return "○";
  }
}

function statusClass(status: PostPaymentStepTrace["status"]): string {
  switch (status) {
    case "ok":
      return "text-emerald-300";
    case "running":
      return "text-cyan-300";
    case "error":
      return "text-rose-300";
    case "skipped":
      return "text-slate-500";
    default:
      return "text-slate-500";
  }
}

export default function PostPaymentFlowPanel({ trace, visible }: PostPaymentFlowPanelProps) {
  if (!visible || !trace.length) return null;

  const failed = trace.find((entry) => entry.status === "error");

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/90 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">결제 후 진행 단계</p>
      {failed ? (
        <p className="mt-2 text-sm font-medium text-rose-200">
          실패 지점: {failed.label.replace(/^\d+\.\s*/, "")}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">어느 단계에서 멈췄는지 확인할 수 있습니다.</p>
      )}
      <ol className="mt-3 space-y-1.5">
        {trace.map((entry) => (
          <li key={entry.id} className="text-sm">
            <span className={`mr-2 font-mono ${statusClass(entry.status)}`}>{statusSymbol(entry.status)}</span>
            <span className={entry.status === "error" ? "text-rose-100" : "text-slate-300"}>{entry.label}</span>
            {entry.detail ? (
              <span className={`mt-0.5 block pl-6 text-xs ${entry.status === "error" ? "text-rose-200" : "text-slate-500"}`}>
                {entry.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
