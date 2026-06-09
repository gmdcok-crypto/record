import { useEffect, useMemo, useRef, useState } from "react";

import { formatDurationInput, parseDurationInput } from "./transcriptEditor";
import {
  QUOTE_TIERS,
  calculateQuote,
  createQuoteSegmentId,
  formatDurationHuman,
  formatKrw,
  readMediaDuration,
  sumSelectedSegmentDurationMs,
  type QuoteSegment,
} from "./quotePricing";
import { playSegmentAudio } from "./segmentAudio";

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";

type QuoteMode = "full" | "segments";

function formatSegmentRange(startMs: number, endMs: number): string {
  return `${formatDurationInput(startMs)} ~ ${formatDurationInput(endMs)}`;
}

export default function QuoteRequestTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [loadingDuration, setLoadingDuration] = useState(false);
  const [durationError, setDurationError] = useState("");
  const [mode, setMode] = useState<QuoteMode>("full");
  const [segments, setSegments] = useState<QuoteSegment[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [segmentForm, setSegmentForm] = useState({
    label: "",
    startTime: "",
    endTime: "",
  });
  const [segmentFormError, setSegmentFormError] = useState("");

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const billableDurationMs = useMemo(() => {
    if (!durationMs) return 0;
    if (mode === "full") return durationMs;
    return sumSelectedSegmentDurationMs(segments);
  }, [durationMs, mode, segments]);

  const quote = useMemo(() => calculateQuote(billableDurationMs), [billableDurationMs]);

  const resetFileState = () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setFileUrl("");
    setDurationMs(null);
    setDurationError("");
    setSegments([]);
    setSegmentForm({ label: "", startTime: "", endTime: "" });
    setSegmentFormError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const loadFile = async (nextFile: File) => {
    resetFileState();
    setLoadingDuration(true);
    try {
      const nextUrl = URL.createObjectURL(nextFile);
      const nextDuration = await readMediaDuration(nextFile);
      setFile(nextFile);
      setFileUrl(nextUrl);
      setDurationMs(nextDuration);
    } catch (err) {
      setDurationError(err instanceof Error ? err.message : "파일을 불러오지 못했습니다.");
    } finally {
      setLoadingDuration(false);
    }
  };

  const onSelectFile = (files: FileList | null) => {
    const nextFile = files?.[0];
    if (!nextFile) return;
    void loadFile(nextFile);
  };

  const addSegment = () => {
    if (durationMs == null) return;

    const start_ms = parseDurationInput(segmentForm.startTime);
    const end_ms = parseDurationInput(segmentForm.endTime);

    if (start_ms == null || end_ms == null) {
      setSegmentFormError("시작·종료 시간을 분:초 형식으로 입력해 주세요. (예: 01:23)");
      return;
    }
    if (end_ms <= start_ms) {
      setSegmentFormError("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    if (end_ms > durationMs) {
      setSegmentFormError("종료 시간이 파일 길이를 넘을 수 없습니다.");
      return;
    }

    const segment: QuoteSegment = {
      id: createQuoteSegmentId(),
      label: segmentForm.label.trim() || `구간 ${segments.length + 1}`,
      start_ms,
      end_ms,
      selected: true,
    };

    setSegments((prev) =>
      [...prev, segment].sort((left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms),
    );
    setSegmentForm({ label: "", startTime: "", endTime: "" });
    setSegmentFormError("");
  };

  const playSegment = (startMs: number, endMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  const setCurrentTimeToForm = (field: "startTime" | "endTime") => {
    const audio = audioRef.current;
    if (!audio) return;
    const value = formatDurationInput(Math.floor(audio.currentTime * 1000));
    setSegmentForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
      <div className="mb-5">
        <p className="text-sm font-semibold text-cyan-300">견적 의뢰</p>
        <h2 className="mt-1 text-xl font-bold text-white">녹취록 작성 비용 계산</h2>
        <p className="mt-1 text-sm text-slate-400">
          음성·영상 파일을 올리면 요금표 기준으로 예상 견적을 확인할 수 있습니다.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => onSelectFile(event.target.files)}
      />

      {!file ? (
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
            onSelectFile(event.dataTransfer.files);
          }}
          className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-12 text-center transition ${
            isDragActive
              ? "border-cyan-400 bg-slate-900"
              : "border-slate-700 bg-slate-950/80 hover:border-cyan-400 hover:bg-slate-900"
          }`}
        >
          <span className="text-4xl">📋</span>
          <span className="mt-3 font-semibold text-slate-100">견적용 파일 선택</span>
          <span className="mt-1 text-sm text-slate-400">wav, mp3, m4a, mp4 등 · 드래그 앤 드롭 가능</span>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{file.name}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {loadingDuration
                    ? "재생 시간 확인 중…"
                    : durationMs != null
                      ? `전체 길이 ${formatDurationHuman(durationMs)}`
                      : "재생 시간 미확인"}
                </p>
              </div>
              <button
                type="button"
                onClick={resetFileState}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                다른 파일
              </button>
            </div>

            {durationError ? (
              <p className="mt-3 text-sm text-rose-300">{durationError}</p>
            ) : fileUrl ? (
              <audio ref={audioRef} controls preload="metadata" src={fileUrl} className="mt-3 w-full rounded-xl" />
            ) : null}
          </div>

          {durationMs != null ? (
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
                  파일 전체 재생 시간({formatDurationHuman(durationMs)})을 기준으로 견적을 계산합니다.
                </p>
              ) : (
                <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">구간 추가</p>
                    <p className="mt-1 text-xs text-slate-500">
                      재생하며 시작·종료 시각을 맞추거나 직접 입력하세요. 선택한 구간 시간의 합으로 견적이 계산됩니다.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block sm:col-span-3">
                      <span className="mb-1 block text-xs font-medium text-slate-500">구간 이름 (선택)</span>
                      <input
                        value={segmentForm.label}
                        onChange={(event) => setSegmentForm((prev) => ({ ...prev, label: event.target.value }))}
                        placeholder="예: 1차 통화"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-500">시작</span>
                      <input
                        value={segmentForm.startTime}
                        onChange={(event) => setSegmentForm((prev) => ({ ...prev, startTime: event.target.value }))}
                        placeholder="00:00"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-500">종료</span>
                      <input
                        value={segmentForm.endTime}
                        onChange={(event) => setSegmentForm((prev) => ({ ...prev, endTime: event.target.value }))}
                        placeholder="01:30"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <div className="flex flex-wrap items-end gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentTimeToForm("startTime")}
                        className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                      >
                        현재→시작
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentTimeToForm("endTime")}
                        className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                      >
                        현재→종료
                      </button>
                      <button
                        type="button"
                        onClick={addSegment}
                        className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500"
                      >
                        구간 추가
                      </button>
                    </div>
                  </div>

                  {segmentFormError ? <p className="text-sm text-rose-300">{segmentFormError}</p> : null}

                  <div className="space-y-2">
                    {segments.length ? (
                      segments.map((segment) => {
                        const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
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
                              <p className="text-sm font-semibold text-white">{segment.label}</p>
                              <p className="text-xs text-slate-500">
                                {formatSegmentRange(segment.start_ms, segment.end_ms)} ·{" "}
                                {formatDurationHuman(segmentDuration)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => playSegment(segment.start_ms, segment.end_ms)}
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
                        아직 구간이 없습니다. 위에서 구간을 추가해 주세요.
                      </p>
                    )}
                  </div>

                  <p className="text-sm text-cyan-100">
                    선택 구간 합계: {formatDurationHuman(billableDurationMs)}
                  </p>
                </div>
              )}

              <QuoteSummary quote={quote} billableDurationMs={billableDurationMs} mode={mode} />
            </>
          ) : null}
        </div>
      )}

      <PriceTableReference activeTierLabel={quote.tier?.label ?? null} />
    </section>
  );
}

function QuoteSummary({
  quote,
  billableDurationMs,
  mode,
}: {
  quote: ReturnType<typeof calculateQuote>;
  billableDurationMs: number;
  mode: QuoteMode;
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
