import { useEffect, useMemo, useRef, useState } from "react";

import TimeHmsSelect from "./TimeHmsSelect";
import {
  ZERO_HMS,
  clampHms,
  formatDurationHuman,
  formatSegmentClock,
  hmsToMs,
  msToHms,
  readMediaDuration,
  type QuoteSegment,
} from "./quotePricing";
import { playSegmentAudio } from "./segmentAudio";
import {
  createUploadSegment,
  fileBillableDurationMs,
  isUploadBillingReady,
  type UploadBillingFile,
  type UploadBillingMode,
} from "./uploadBilling";

type Props = {
  files: File[];
  fileIdentity: (file: File) => string;
  formatSize: (bytes: number) => string;
  uploading?: boolean;
  onRemoveFile: (file: File) => void;
  onEntriesChange?: (entries: UploadBillingFile[]) => void;
};

function formatSegmentRange(startMs: number, endMs: number): string {
  return `${formatSegmentClock(startMs)} ~ ${formatSegmentClock(endMs)}`;
}

function revokeUrls(entries: UploadBillingFile[]) {
  for (const entry of entries) {
    URL.revokeObjectURL(entry.url);
  }
}

export default function AdminUploadScopePanel({
  files,
  fileIdentity,
  formatSize,
  uploading = false,
  onRemoveFile,
  onEntriesChange,
}: Props) {
  const entriesRef = useRef<UploadBillingFile[]>([]);
  const [entries, setEntries] = useState<UploadBillingFile[]>([]);
  const [segmentForms, setSegmentForms] = useState<Record<string, { start: typeof ZERO_HMS; end: typeof ZERO_HMS }>>({});
  const [segmentFormErrors, setSegmentFormErrors] = useState<Record<string, string>>({});

  const billingReady = useMemo(() => isUploadBillingReady(entries), [entries]);
  entriesRef.current = entries;

  useEffect(() => {
    return () => {
      revokeUrls(entriesRef.current);
    };
  }, []);

  useEffect(() => {
    const incomingKeys = new Set(files.map(fileIdentity));
    setEntries((prev) => {
      const kept = prev.filter((entry) => incomingKeys.has(entry.key));
      const keptKeys = new Set(kept.map((entry) => entry.key));
      const added = files
        .filter((file) => !keptKeys.has(fileIdentity(file)))
        .map((file) => ({
          key: fileIdentity(file),
          file,
          url: URL.createObjectURL(file),
          durationMs: null,
          loading: true,
          error: "",
          mode: "full" as UploadBillingMode,
          segments: [] as QuoteSegment[],
        }));
      const removed = prev.filter((entry) => !incomingKeys.has(entry.key));
      for (const entry of removed) {
        URL.revokeObjectURL(entry.url);
      }
      return [...kept, ...added];
    });
  }, [files, fileIdentity]);

  const loadingKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const pending = entries.filter((entry) => entry.loading && !loadingKeysRef.current.has(entry.key));
    if (!pending.length) return;
    for (const entry of pending) {
      loadingKeysRef.current.add(entry.key);
      void readMediaDuration(entry.file)
        .then((durationMs) => {
          setEntries((prev) =>
            prev.map((item) =>
              item.key === entry.key ? { ...item, durationMs, loading: false, error: "" } : item,
            ),
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "재생 시간을 확인할 수 없습니다.";
          setEntries((prev) =>
            prev.map((item) =>
              item.key === entry.key ? { ...item, durationMs: null, loading: false, error: message } : item,
            ),
          );
        });
    }
  }, [entries]);

  useEffect(() => {
    onEntriesChange?.(entries);
  }, [entries, onEntriesChange]);

  const updateEntry = (key: string, patch: Partial<UploadBillingFile>) => {
    setEntries((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  };

  const getSegmentForm = (key: string) => segmentForms[key] ?? { start: ZERO_HMS, end: ZERO_HMS };

  const setSegmentForm = (key: string, patch: Partial<{ start: typeof ZERO_HMS; end: typeof ZERO_HMS }>) => {
    setSegmentForms((prev) => ({
      ...prev,
      [key]: { ...getSegmentForm(key), ...patch },
    }));
  };

  const addSegment = (entry: UploadBillingFile) => {
    if (!entry.durationMs) return;
    const form = getSegmentForm(entry.key);
    const start_ms = hmsToMs(form.start);
    const end_ms = hmsToMs(form.end);
    if (end_ms <= start_ms) {
      setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "종료 시간은 시작 시간보다 늦어야 합니다." }));
      return;
    }
    if (end_ms > entry.durationMs) {
      setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "종료 시간이 파일 길이를 넘을 수 없습니다." }));
      return;
    }
    const segment = createUploadSegment(entry.key, start_ms, end_ms);
    updateEntry(entry.key, {
      segments: [...entry.segments, segment].sort(
        (left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms,
      ),
    });
    setSegmentForm(entry.key, { start: ZERO_HMS, end: ZERO_HMS });
    setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "" }));
  };

  if (!entries.length) return null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">파일별 업로드 범위</p>
        {!billingReady ? (
          <span className="text-[11px] text-amber-300">
            {entries.some((entry) => entry.loading) ? "재생 시간 확인 중…" : "구간 선택 파일을 확인해 주세요"}
          </span>
        ) : null}
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <UploadScopeCard
            key={entry.key}
            entry={entry}
            formatSize={formatSize}
            disabled={uploading}
            segmentForm={getSegmentForm(entry.key)}
            segmentFormError={segmentFormErrors[entry.key] ?? ""}
            billableDurationMs={fileBillableDurationMs(entry)}
            onModeChange={(mode) => updateEntry(entry.key, { mode })}
            onRemove={() => onRemoveFile(entry.file)}
            onSegmentFormChange={(patch) => setSegmentForm(entry.key, patch)}
            onAddSegment={() => addSegment(entry)}
            onSegmentsChange={(segments) => updateEntry(entry.key, { segments })}
          />
        ))}
      </div>
    </div>
  );
}

function UploadScopeCard({
  entry,
  formatSize,
  disabled,
  segmentForm,
  segmentFormError,
  billableDurationMs,
  onModeChange,
  onRemove,
  onSegmentFormChange,
  onAddSegment,
  onSegmentsChange,
}: {
  entry: UploadBillingFile;
  formatSize: (bytes: number) => string;
  disabled: boolean;
  segmentForm: { start: typeof ZERO_HMS; end: typeof ZERO_HMS };
  segmentFormError: string;
  billableDurationMs: number;
  onModeChange: (mode: UploadBillingMode) => void;
  onRemove: () => void;
  onSegmentFormChange: (patch: Partial<{ start: typeof ZERO_HMS; end: typeof ZERO_HMS }>) => void;
  onAddSegment: () => void;
  onSegmentsChange: (segments: QuoteSegment[]) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);

  const setCurrentTimeToForm = (field: "start" | "end") => {
    const audio = audioRef.current;
    if (!audio || !entry.durationMs) return;
    const next = clampHms(msToHms(Math.floor(audio.currentTime * 1000)), entry.durationMs);
    onSegmentFormChange({ [field]: next });
  };

  const playSegment = (startMs: number, endMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{entry.file.name}</p>
          <p className="mt-1 text-xs text-slate-400">
            {formatSize(entry.file.size)}
            {entry.loading
              ? " · 재생 시간 확인 중…"
              : entry.error
                ? ` · ${entry.error}`
                : entry.durationMs != null
                  ? ` · ${formatDurationHuman(entry.durationMs)}`
                  : ""}
            {billableDurationMs > 0 ? ` · 적용 ${formatDurationHuman(billableDurationMs)}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="rounded-md border border-rose-500/30 px-2.5 py-1 text-[11px] font-medium text-rose-300 disabled:opacity-40"
        >
          제거
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onModeChange("full")}
          className={`rounded-lg border px-3 py-2 text-sm ${
            entry.mode === "full"
              ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
              : "border-slate-700 text-slate-300"
          }`}
        >
          파일 전체
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onModeChange("segments")}
          className={`rounded-lg border px-3 py-2 text-sm ${
            entry.mode === "segments"
              ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
              : "border-slate-700 text-slate-300"
          }`}
        >
          구간 선택
        </button>
      </div>

      {entry.mode === "segments" && entry.durationMs != null && !entry.error ? (
        <div className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <audio ref={audioRef} controls preload="metadata" src={entry.url} className="w-full rounded-xl" />
          <TimeHmsSelect
            label="시작"
            value={segmentForm.start}
            maxMs={entry.durationMs}
            onChange={(start) => onSegmentFormChange({ start })}
          />
          <TimeHmsSelect
            label="종료"
            value={segmentForm.end}
            maxMs={entry.durationMs}
            onChange={(end) => onSegmentFormChange({ end })}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCurrentTimeToForm("start")}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
            >
              현재→시작
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCurrentTimeToForm("end")}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
            >
              현재→종료
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onAddSegment}
              className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200"
            >
              구간 추가
            </button>
          </div>
          {segmentFormError ? <p className="text-xs text-rose-300">{segmentFormError}</p> : null}

          <div className="space-y-2">
            {entry.segments.length ? (
              entry.segments.map((segment) => {
                const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
                return (
                  <div
                    key={segment.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={segment.selected}
                      disabled={disabled}
                      onChange={(event) =>
                        onSegmentsChange(
                          entry.segments.map((item) =>
                            item.id === segment.id ? { ...item, selected: event.target.checked } : item,
                          ),
                        )
                      }
                      className="h-4 w-4 rounded border-slate-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100">{formatSegmentRange(segment.start_ms, segment.end_ms)}</p>
                      <p className="text-xs text-slate-400">{formatDurationHuman(segmentDuration)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => playSegment(segment.start_ms, segment.end_ms)}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
                    >
                      재생
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSegmentsChange(entry.segments.filter((item) => item.id !== segment.id))}
                      className="rounded-md border border-rose-500/30 px-2.5 py-1 text-[11px] text-rose-300"
                    >
                      삭제
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-xs text-slate-500">추가할 구간을 선택해 주세요.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
