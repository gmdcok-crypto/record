import { useCallback, useEffect, useState } from "react";
import type { TranscriptChangeEntry } from "./api";
import { formatKstDateTime } from "./formatKstDateTime";

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
    case "segment_omitted":
      return `${segmentNo} 생략: "${change.before || "(없음)"}" → ${change.after || "(생략)"}`;
    case "segment_restored":
      return `${segmentNo} 복구: ${change.before || "(생략)"} → "${change.after || "(없음)"}"`;
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
                    <li key={`${entry.version}-${index}`}>{formatChangeLine(change)}</li>
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
