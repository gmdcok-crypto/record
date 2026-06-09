import { useCallback, useEffect, useState } from "react";
import type { TranscriptChangeEntry } from "./api";

type Props = {
  jobId: string | null;
  refreshKey?: number;
  loadEntries: (jobId: string) => Promise<TranscriptChangeEntry[]>;
};

function formatChangeLine(change: TranscriptChangeEntry["changes"][number]): string {
  const segmentNo =
    change.segment_index != null ? `구간 ${change.segment_index + 1}` : "";

  switch (change.type) {
    case "segment_text":
      return `${segmentNo}: "${change.before || "(없음)"}" → "${change.after || "(없음)"}"`;
    case "segment_speaker":
      return `${segmentNo} 화자: ${change.before || "-"} → ${change.after || "-"}`;
    case "speaker_label":
      return `화자 ${change.speaker_id} 이름: ${change.before || "(기본)"} → ${change.after || "(기본)"}`;
    case "segment_added":
      return `${segmentNo} 추가: ${change.after || ""}`;
    case "segment_removed":
      return `${segmentNo} 삭제: ${change.before || ""}`;
    default:
      return JSON.stringify(change);
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "client":
      return "의뢰인";
    case "transcriber":
      return "속기사";
    default:
      return role;
  }
}

export default function TranscriptChangeHistory({ jobId, refreshKey = 0, loadEntries }: Props) {
  const [entries, setEntries] = useState<TranscriptChangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!jobId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await loadEntries(jobId);
      setEntries(data);
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : "변경 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [jobId, loadEntries]);

  useEffect(() => {
    if (open) {
      void reload();
    }
  }, [open, reload, refreshKey]);

  if (!jobId) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-200">변경 이력</span>
        <span className="text-xs text-slate-500">{open ? "접기" : "펼치기"}</span>
      </button>

      {open ? (
        <div className="border-t border-slate-800 px-4 py-3">
          {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!loading && !error && entries.length === 0 ? (
            <p className="text-sm text-slate-500">저장된 변경 이력이 없습니다.</p>
          ) : null}
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {entries.map((entry) => (
              <div key={`${entry.version}-${entry.created_at}`} className="rounded-xl border border-slate-800 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-violet-300">v{entry.version}</span>
                  <span>{entry.save_kind_label}</span>
                  <span>·</span>
                  <span>
                    {roleLabel(entry.editor_role)} {entry.editor_name}
                  </span>
                  {entry.created_at ? (
                    <>
                      <span>·</span>
                      <span>{new Date(entry.created_at).toLocaleString("ko-KR")}</span>
                    </>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-200">
                  {entry.changes.map((change, index) => (
                    <li key={`${entry.version}-${index}`} className="leading-6">
                      {formatChangeLine(change)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
