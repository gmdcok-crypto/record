import { useCallback, useEffect, useState } from "react";
import type { TranscriptChangeEntry } from "./api";
import { formatKstDateTime } from "./formatKstDateTime";
import TranscriptChangeLine from "./TranscriptChangeLine";

type Props = {
  jobId: string | null;
  refreshKey?: number;
  loadEntries: (jobId: string) => Promise<TranscriptChangeEntry[]>;
  onSegmentFocus?: (segmentIndex: number) => void;
};

function roleLabel(role: string): string {
  switch (role) {
    case "client":
      return "의뢰인";
    case "transcriber":
      return "속기사";
    case "admin":
      return "관리자";
    case "share":
      return "공유 사용자";
    default:
      return role;
  }
}

export default function TranscriptChangeHistory({
  jobId,
  refreshKey = 0,
  loadEntries,
  onSegmentFocus,
}: Props) {
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
    <div className="client-edit__panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="client-edit__panel-toggle"
      >
        <span className="client-edit__panel-toggle-title">변경 이력</span>
        <span className="client-edit__panel-toggle-action">{open ? "접기" : "펼치기"}</span>
      </button>

      {open ? (
        <div className="client-edit__panel-body border-t border-[var(--bp-line)]">
          {loading ? <p className="text-sm text-[var(--bp-body)]">불러오는 중...</p> : null}
          {error ? <p className="client-edit__error">{error}</p> : null}
          {!loading && !error && entries.length === 0 ? (
            <p className="text-sm text-[var(--bp-body)]">저장된 변경 이력이 없습니다.</p>
          ) : null}
          {onSegmentFocus ? (
            <p className="client-edit__history-hint">구간이 있는 항목을 클릭하면 편집 화면에서 해당 위치로 이동합니다.</p>
          ) : null}
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {entries.map((entry) => (
              <div key={`${entry.version}-${entry.created_at}`} className="client-edit__history-item">
                <div className="client-edit__history-meta">
                  <span className="client-edit__history-version">v{entry.version}</span>
                  <span>{entry.save_kind_label}</span>
                  <span>·</span>
                  <span>
                    {roleLabel(entry.editor_role)} {entry.editor_name}
                  </span>
                  {entry.created_at ? (
                    <>
                      <span>·</span>
                      <span>{formatKstDateTime(entry.created_at)}</span>
                    </>
                  ) : null}
                </div>
                <ul className="client-edit__history-changes">
                  {entry.changes.map((change, index) => (
                    <TranscriptChangeLine
                      key={`${entry.version}-${index}`}
                      change={change}
                      onSegmentFocus={onSegmentFocus}
                    />
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
