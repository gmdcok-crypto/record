import { useEffect, useMemo, useRef, useState } from "react";

import {
  QUOTE_TIERS,
  ZERO_HMS,
  calculateQuote,
  createQuoteFileId,
  createQuoteSegmentId,
  formatDurationHuman,
  formatKrw,
  formatSegmentClock,
  hmsToMs,
  msToHms,
  readMediaDuration,
  sumQuoteFileDurationsMs,
  sumSelectedSegmentDurationMs,
  type HmsTime,
  type QuoteFileEntry,
  type QuoteSegment,
} from "./quotePricing";
import { playSegmentAudio } from "./segmentAudio";

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";

type QuoteMode = "full" | "segments";

const SELECT_CLASS =
  "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500";

function formatSegmentRange(startMs: number, endMs: number): string {
  return `${formatSegmentClock(startMs)} ~ ${formatSegmentClock(endMs)}`;
}

function clampHms(value: HmsTime, maxMs?: number): HmsTime {
  if (maxMs == null) return value;

  const max = msToHms(maxMs);
  let next = { ...value };
  if (next.hour > max.hour) next.hour = max.hour;
  const minuteMax = next.hour === max.hour ? max.minute : 59;
  if (next.minute > minuteMax) next.minute = minuteMax;
  const secondMax = next.hour === max.hour && next.minute === max.minute ? max.second : 59;
  if (next.second > secondMax) next.second = secondMax;
  if (hmsToMs(next) > maxMs) {
    return msToHms(maxMs);
  }
  return next;
}

function TimeHmsSelect({
  value,
  onChange,
  maxMs,
  label,
}: {
  value: HmsTime;
  onChange: (next: HmsTime) => void;
  maxMs?: number;
  label: string;
}) {
  const max = maxMs != null ? msToHms(maxMs) : { hour: 23, minute: 59, second: 59 };
  const minuteMax = value.hour === max.hour ? max.minute : 59;
  const secondMax = value.hour === max.hour && value.minute === max.minute ? max.second : 59;

  const update = (patch: Partial<HmsTime>) => {
    onChange(clampHms({ ...value, ...patch }, maxMs));
  };

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={value.hour}
          onChange={(event) => update({ hour: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: max.hour + 1 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">시</span>
        <select
          value={value.minute}
          onChange={(event) => update({ minute: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: minuteMax + 1 }, (_, minute) => (
            <option key={minute} value={minute}>
              {minute}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">분</span>
        <select
          value={value.second}
          onChange={(event) => update({ second: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: secondMax + 1 }, (_, second) => (
            <option key={second} value={second}>
              {second}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">초</span>
      </div>
    </div>
  );
}

function revokeQuoteFileUrls(files: QuoteFileEntry[]) {
  for (const entry of files) {
    URL.revokeObjectURL(entry.url);
  }
}

export default function QuoteRequestTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const filesRef = useRef<QuoteFileEntry[]>([]);
  const [files, setFiles] = useState<QuoteFileEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [mode, setMode] = useState<QuoteMode>("full");
  const [segments, setSegments] = useState<QuoteSegment[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [segmentForm, setSegmentForm] = useState({
    start: ZERO_HMS,
    end: ZERO_HMS,
  });
  const [segmentFormError, setSegmentFormError] = useState("");

  filesRef.current = files;

  const activeFile = useMemo(
    () => files.find((entry) => entry.id === activeFileId) ?? null,
    [activeFileId, files],
  );

  const totalDurationMs = useMemo(() => sumQuoteFileDurationsMs(files), [files]);
  const hasLoadedDuration = files.some((entry) => entry.durationMs != null && !entry.loading);

  const billableDurationMs = useMemo(() => {
    if (!hasLoadedDuration) return 0;
    if (mode === "full") return totalDurationMs;
    return sumSelectedSegmentDurationMs(segments);
  }, [hasLoadedDuration, mode, segments, totalDurationMs]);

  const quote = useMemo(() => calculateQuote(billableDurationMs), [billableDurationMs]);

  useEffect(() => {
    return () => {
      revokeQuoteFileUrls(filesRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeFileId && files.length) {
      setActiveFileId(files[0].id);
      return;
    }
    if (activeFileId && !files.some((entry) => entry.id === activeFileId)) {
      setActiveFileId(files[0]?.id ?? null);
    }
  }, [activeFileId, files]);

  const resetAll = () => {
    revokeQuoteFileUrls(files);
    setFiles([]);
    setActiveFileId(null);
    setSegments([]);
    setSegmentForm({ start: ZERO_HMS, end: ZERO_HMS });
    setSegmentFormError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => {
      const target = prev.find((entry) => entry.id === fileId);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((entry) => entry.id !== fileId);
    });
    setSegments((prev) => prev.filter((segment) => segment.fileId !== fileId));
  };

  const loadDurations = async (entries: QuoteFileEntry[]) => {
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const durationMs = await readMediaDuration(entry.file);
          setFiles((prev) =>
            prev.map((item) =>
              item.id === entry.id ? { ...item, durationMs, loading: false, error: "" } : item,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "재생 시간을 확인할 수 없습니다.";
          setFiles((prev) =>
            prev.map((item) =>
              item.id === entry.id ? { ...item, durationMs: null, loading: false, error: message } : item,
            ),
          );
        }
      }),
    );
  };

  const addFiles = (incoming: File[]) => {
    const mediaFiles = incoming.filter((file) => file.size > 0);
    if (!mediaFiles.length) return;

    const nextEntries: QuoteFileEntry[] = mediaFiles.map((file) => ({
      id: createQuoteFileId(),
      file,
      url: URL.createObjectURL(file),
      durationMs: null,
      loading: true,
      error: "",
    }));

    setFiles((prev) => [...prev, ...nextEntries]);
    if (!activeFileId) {
      setActiveFileId(nextEntries[0].id);
    }
    void loadDurations(nextEntries);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSelectFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    addFiles(Array.from(fileList));
  };

  const addSegment = () => {
    if (!activeFile?.durationMs) return;

    const start_ms = hmsToMs(segmentForm.start);
    const end_ms = hmsToMs(segmentForm.end);

    if (end_ms <= start_ms) {
      setSegmentFormError("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    if (end_ms > activeFile.durationMs) {
      setSegmentFormError("종료 시간이 파일 길이를 넘을 수 없습니다.");
      return;
    }

    const segment: QuoteSegment = {
      id: createQuoteSegmentId(),
      fileId: activeFile.id,
      start_ms,
      end_ms,
      selected: true,
    };

    setSegments((prev) =>
      [...prev, segment].sort(
        (left, right) =>
          left.fileId.localeCompare(right.fileId) ||
          left.start_ms - right.start_ms ||
          left.end_ms - right.end_ms,
      ),
    );
    setSegmentForm({ start: ZERO_HMS, end: ZERO_HMS });
    setSegmentFormError("");
  };

  const playSegment = (fileId: string, startMs: number, endMs: number) => {
    const entry = files.find((item) => item.id === fileId);
    const audio = audioRef.current;
    if (!entry || !audio) return;

    if (audio.src !== entry.url) {
      audio.src = entry.url;
    }
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  const setCurrentTimeToForm = (field: "start" | "end") => {
    const audio = audioRef.current;
    if (!audio || !activeFile?.durationMs) return;
    const next = clampHms(msToHms(Math.floor(audio.currentTime * 1000)), activeFile.durationMs);
    setSegmentForm((prev) => ({ ...prev, [field]: next }));
  };

  const loadedFileCount = files.filter((entry) => entry.durationMs != null).length;
  const loadingFileCount = files.filter((entry) => entry.loading).length;

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
      <div className="mb-5">
        <p className="text-sm font-semibold text-cyan-300">견적 의뢰</p>
        <h2 className="mt-1 text-xl font-bold text-white">녹취록 작성 비용 계산</h2>
        <p className="mt-1 text-sm text-slate-400">
          음성·영상 파일을 여러 개 올릴 수 있으며, 파일 전체 모드에서는 모든 파일 재생 시간의 합으로 견적을 계산합니다.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => onSelectFiles(event.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragActive(false);
          onSelectFiles(event.dataTransfer.files);
        }}
        className={`mb-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
          isDragActive
            ? "border-cyan-400 bg-slate-900"
            : "border-slate-700 bg-slate-950/80 hover:border-cyan-400 hover:bg-slate-900"
        }`}
      >
        <span className="text-3xl">📋</span>
        <span className="mt-2 font-semibold text-slate-100">
          {files.length ? "파일 추가" : "견적용 파일 선택"}
        </span>
        <span className="mt-1 text-sm text-slate-400">
          여러 파일 선택 가능 · wav, mp3, m4a, mp4 등 · 드래그 앤 드롭
        </span>
      </button>

      {files.length ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  업로드 파일 {files.length}개
                  {loadedFileCount ? ` · 합계 ${formatDurationHuman(totalDurationMs)}` : ""}
                </p>
                {loadingFileCount ? (
                  <p className="mt-1 text-xs text-slate-500">재생 시간 확인 중 {loadingFileCount}개…</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={resetAll}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                전체 삭제
              </button>
            </div>

            <div className="space-y-2">
              {files.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    entry.id === activeFileId
                      ? "border-cyan-500/40 bg-cyan-500/10"
                      : "border-slate-800 bg-slate-900/70"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFileId(entry.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-semibold text-white">{entry.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {entry.loading
                        ? "재생 시간 확인 중…"
                        : entry.error
                          ? entry.error
                          : entry.durationMs != null
                            ? formatDurationHuman(entry.durationMs)
                            : "재생 시간 미확인"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFile(entry.id)}
                    className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>

          {hasLoadedDuration ? (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-1">
                <button
                  type="button"
                  onClick={() => setMode("full")}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    mode === "full" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  파일 전체
                </button>
                <button
                  type="button"
                  onClick={() => setMode("segments")}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    mode === "segments" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  구간 선택
                </button>
              </div>

              {mode === "full" ? (
                <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                  업로드한 {loadedFileCount}개 파일 재생 시간 합계({formatDurationHuman(totalDurationMs)})를 기준으로
                  견적을 계산합니다.
                </p>
              ) : (
                <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">구간 추가</p>
                    <p className="mt-1 text-xs text-slate-500">
                      파일을 선택한 뒤 구간을 추가하세요. 선택한 구간 시간의 합으로 견적이 계산됩니다.
                    </p>
                  </div>

                  {activeFile ? (
                    <>
                      <p className="text-xs text-cyan-200">
                        편집 중: <span className="font-semibold">{activeFile.file.name}</span>
                        {activeFile.durationMs != null ? ` · ${formatDurationHuman(activeFile.durationMs)}` : ""}
                      </p>

                      {activeFile.durationMs != null && !activeFile.error ? (
                        <audio
                          ref={audioRef}
                          key={activeFile.id}
                          controls
                          preload="metadata"
                          src={activeFile.url}
                          className="w-full rounded-xl"
                        />
                      ) : null}

                      <div className="space-y-3">
                        <TimeHmsSelect
                          label="시작"
                          value={segmentForm.start}
                          maxMs={activeFile.durationMs ?? undefined}
                          onChange={(start) => setSegmentForm((prev) => ({ ...prev, start }))}
                        />
                        <TimeHmsSelect
                          label="종료"
                          value={segmentForm.end}
                          maxMs={activeFile.durationMs ?? undefined}
                          onChange={(end) => setSegmentForm((prev) => ({ ...prev, end }))}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCurrentTimeToForm("start")}
                            disabled={!activeFile.durationMs}
                            className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                          >
                            현재→시작
                          </button>
                          <button
                            type="button"
                            onClick={() => setCurrentTimeToForm("end")}
                            disabled={!activeFile.durationMs}
                            className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                          >
                            현재→종료
                          </button>
                          <button
                            type="button"
                            onClick={addSegment}
                            disabled={!activeFile.durationMs}
                            className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
                          >
                            구간 추가
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {segmentFormError ? <p className="text-sm text-rose-300">{segmentFormError}</p> : null}

                  <div className="space-y-2">
                    {segments.length ? (
                      segments.map((segment) => {
                        const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
                        const segmentFile = files.find((entry) => entry.id === segment.fileId);
                        return (
                          <div
                            key={segment.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2.5"
                          >
                            <input
                              type="checkbox"
                              checked={segment.selected}
                              onChange={(event) =>
                                setSegments((prev) =>
                                  prev.map((item) =>
                                    item.id === segment.id ? { ...item, selected: event.target.checked } : item,
                                  ),
                                )
                              }
                              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-cyan-500"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-white">
                                {formatSegmentRange(segment.start_ms, segment.end_ms)}
                              </p>
                              <p className="text-xs text-slate-500">
                                {segmentFile?.file.name ?? "파일"} · {formatDurationHuman(segmentDuration)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => playSegment(segment.fileId, segment.start_ms, segment.end_ms)}
                              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                            >
                              재생
                            </button>
                            <button
                              type="button"
                              onClick={() => setSegments((prev) => prev.filter((item) => item.id !== segment.id))}
                              className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                            >
                              삭제
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
                        아직 구간이 없습니다. 파일을 선택하고 구간을 추가해 주세요.
                      </p>
                    )}
                  </div>

                  <p className="text-sm text-cyan-100">선택 구간 합계: {formatDurationHuman(billableDurationMs)}</p>
                </div>
              )}

              <QuoteSummary
                quote={quote}
                billableDurationMs={billableDurationMs}
                mode={mode}
                fileCount={loadedFileCount}
              />
            </>
          ) : null}
        </div>
      ) : null}

      <PriceTableReference activeTierLabel={quote.tier?.label ?? null} />
    </section>
  );
}

function QuoteSummary({
  quote,
  billableDurationMs,
  mode,
  fileCount,
}: {
  quote: ReturnType<typeof calculateQuote>;
  billableDurationMs: number;
  mode: QuoteMode;
  fileCount: number;
}) {
  if (mode === "segments" && billableDurationMs === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
        견적을 보려면 구간을 추가하고 선택해 주세요.
      </div>
    );
  }

  if (quote.overLimit) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4">
        <p className="text-sm font-semibold text-amber-100">60분 이상은 별도 문의</p>
        <p className="mt-1 text-sm text-amber-100/90">
          계산 시간 {formatDurationHuman(quote.durationMs)} — 60분 미만 구간 요금표를 초과합니다. 정확한 견적은
          운영팀에 문의해 주세요.
        </p>
      </div>
    );
  }

  if (!quote.tier) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 to-slate-950 px-4 py-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">예상 견적</p>
      {mode === "full" && fileCount > 1 ? (
        <p className="mt-2 text-sm text-slate-300">
          대상 파일: <span className="font-semibold text-white">{fileCount}개 합산</span>
        </p>
      ) : null}
      <p className="mt-2 text-sm text-slate-300">
        계산 기준 시간: <span className="font-semibold text-white">{formatDurationHuman(quote.durationMs)}</span>
      </p>
      <p className="mt-1 text-sm text-slate-300">
        적용 구간: <span className="font-semibold text-white">{quote.tier.label}</span>
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3">
          <p className="text-xs text-slate-500">PDF 기본요금</p>
          <p className="mt-1 text-lg font-bold text-white">{formatKrw(quote.tier.baseFee)}</p>
        </div>
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-3">
          <p className="text-xs text-cyan-200/80">부가세 포함 결제금액</p>
          <p className="mt-1 text-2xl font-bold text-cyan-100">{formatKrw(quote.tier.totalWithVat)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">※ 실제 의뢰·작업 조건에 따라 최종 금액이 달라질 수 있습니다.</p>
    </div>
  );
}

function PriceTableReference({ activeTierLabel }: { activeTierLabel: string | null }) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-sm font-semibold text-white">요금표</p>
      <p className="mt-1 text-xs text-slate-500">최종 통합 녹취록 요금표 (부가세 10% 포함)</p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500">
              <th className="px-2 py-2 font-medium">녹음 시간</th>
              <th className="px-2 py-2 font-medium">PDF 기본요금</th>
              <th className="px-2 py-2 font-medium">부가세 포함</th>
            </tr>
          </thead>
          <tbody>
            {QUOTE_TIERS.map((tier) => {
              const active = tier.label === activeTierLabel;
              return (
                <tr
                  key={tier.label}
                  className={`border-b border-slate-900/80 ${active ? "bg-cyan-500/10 text-cyan-100" : "text-slate-300"}`}
                >
                  <td className="px-2 py-2">{tier.label}</td>
                  <td className="px-2 py-2">{formatKrw(tier.baseFee)}</td>
                  <td className="px-2 py-2 font-semibold">{formatKrw(tier.totalWithVat)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
