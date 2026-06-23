import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ZERO_HMS,
  calculateQuote,
  clampHms,
  formatDurationHuman,
  formatKrw,
  formatSegmentClock,
  hmsToMs,
  msToHms,
  readMediaDuration,
  sumSelectedSegmentDurationMs,
  QUOTE_FILE_ACCEPT,
  type Hms,
} from "../lib/quotePricing";

type QuoteFileEntry = {
  id: string;
  file: File;
  url: string;
  durationMs: number | null;
  loading: boolean;
  error: string;
};

type QuoteSegment = {
  id: string;
  fileId: string;
  start_ms: number;
  end_ms: number;
  selected: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatSegmentRange(startMs: number, endMs: number): string {
  return `${formatSegmentClock(startMs)} ~ ${formatSegmentClock(endMs)}`;
}

function HmsSelect({
  name,
  value,
  maxMs,
  label,
  onChange,
}: {
  name: "start" | "end";
  value: Hms;
  maxMs?: number | null;
  label: string;
  onChange: (next: Hms) => void;
}) {
  const max = maxMs != null ? msToHms(maxMs) : { hour: 23, minute: 59, second: 59 };
  const minuteMax = value.hour === max.hour ? max.minute : 59;
  const secondMax = value.hour === max.hour && value.minute === max.minute ? max.second : 59;
  const hours = Array.from({ length: max.hour + 1 }, (_, hour) => hour);
  const minutes = Array.from({ length: minuteMax + 1 }, (_, minute) => minute);
  const seconds = Array.from({ length: secondMax + 1 }, (_, second) => second);

  const update = (part: keyof Hms, raw: string) => {
    const next = clampHms({ ...value, [part]: Number(raw) }, maxMs);
    onChange(next);
  };

  return (
    <div className="quote-hms-field">
      <span className="quote-hms-label">{label}</span>
      <div className="quote-hms-row">
        <select
          className="quote-hms-select"
          value={value.hour}
          onChange={(event) => update("hour", event.target.value)}
          aria-label={`${label} 시`}
        >
          {hours.map((hour) => (
            <option key={`${name}-h-${hour}`} value={hour}>
              {hour}
            </option>
          ))}
        </select>
        <span className="quote-hms-unit">시</span>
        <select
          className="quote-hms-select"
          value={value.minute}
          onChange={(event) => update("minute", event.target.value)}
          aria-label={`${label} 분`}
        >
          {minutes.map((minute) => (
            <option key={`${name}-m-${minute}`} value={minute}>
              {minute}
            </option>
          ))}
        </select>
        <span className="quote-hms-unit">분</span>
        <select
          className="quote-hms-select"
          value={value.second}
          onChange={(event) => update("second", event.target.value)}
          aria-label={`${label} 초`}
        >
          {seconds.map((second) => (
            <option key={`${name}-s-${second}`} value={second}>
              {second}
            </option>
          ))}
        </select>
        <span className="quote-hms-unit">초</span>
      </div>
    </div>
  );
}

function QuoteSummary({
  quote,
  mode,
  fileCount,
  billableDurationMs,
}: {
  quote: ReturnType<typeof calculateQuote>;
  mode: "full" | "segments";
  fileCount: number;
  billableDurationMs: number;
}) {
  if (mode === "segments" && billableDurationMs === 0) {
    return (
      <div className="quote-notice quote-notice--warn">견적을 보려면 구간을 추가하고 선택해 주세요.</div>
    );
  }
  if (quote.overLimit) {
    return (
      <div className="quote-notice quote-notice--warn">
        <strong>60분 이상은 별도 문의</strong>
        <br />
        계산 시간 {formatDurationHuman(quote.durationMs)}
      </div>
    );
  }
  if (!quote.tier) return null;

  return (
    <div className="quote-summary">
      <p className="quote-summary__label">예상 견적</p>
      {mode === "full" && fileCount > 1 ? (
        <p className="quote-summary__meta">
          대상 파일: <strong>{fileCount}개 합산</strong>
        </p>
      ) : null}
      <p className="quote-summary__meta">
        계산 기준 시간: <strong>{formatDurationHuman(quote.durationMs)}</strong>
      </p>
      <p className="quote-summary__meta">
        적용 구간: <strong>{quote.tier.label}</strong>
      </p>
      <div className="quote-summary__grid">
        <div className="quote-summary__box">
          <p className="quote-summary__box-label">PDF 기본요금</p>
          <p className="quote-summary__box-value">{formatKrw(quote.tier.baseFee)}</p>
        </div>
        <div className="quote-summary__box quote-summary__box--accent">
          <p className="quote-summary__box-label">부가세 포함 결제금액</p>
          <p className="quote-summary__box-value quote-summary__box-value--lg">
            {formatKrw(quote.tier.totalWithVat)}
          </p>
        </div>
      </div>
      <p className="quote-summary__note">※ 실제 의뢰·작업 조건에 따라 최종 금액이 달라질 수 있습니다.</p>
    </div>
  );
}

export default function QuoteModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentStopHandlerRef = useRef<(() => void) | null>(null);
  const filesRef = useRef<QuoteFileEntry[]>([]);

  const [files, setFiles] = useState<QuoteFileEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [mode, setMode] = useState<"full" | "segments">("full");
  const [segments, setSegments] = useState<QuoteSegment[]>([]);
  const [segmentForm, setSegmentForm] = useState({ start: { ...ZERO_HMS }, end: { ...ZERO_HMS } });
  const [segmentFormError, setSegmentFormError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const activeFile = useMemo(
    () => files.find((entry) => entry.id === activeFileId) ?? null,
    [activeFileId, files],
  );

  const totalDurationMs = useMemo(
    () => files.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
    [files],
  );

  const billableDurationMs = useMemo(() => {
    if (!files.some((entry) => entry.durationMs != null && !entry.loading)) return 0;
    if (mode === "full") return totalDurationMs;
    return sumSelectedSegmentDurationMs(segments);
  }, [files, mode, segments, totalDurationMs]);

  const hasLoadedDuration = files.some((entry) => entry.durationMs != null && !entry.loading);
  const loadedFileCount = files.filter((entry) => entry.durationMs != null).length;
  const loadingFileCount = files.filter((entry) => entry.loading).length;
  const quote = calculateQuote(billableDurationMs);
  const hasContent = files.length > 0 || segments.length > 0;

  filesRef.current = files;

  const revokeAllUrls = useCallback((entries: QuoteFileEntry[]) => {
    for (const entry of entries) {
      URL.revokeObjectURL(entry.url);
    }
  }, []);

  const resetQuote = useCallback(() => {
    setFiles((current) => {
      revokeAllUrls(current);
      return [];
    });
    setActiveFileId(null);
    setMode("full");
    setSegments([]);
    setSegmentForm({ start: { ...ZERO_HMS }, end: { ...ZERO_HMS } });
    setSegmentFormError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [revokeAllUrls]);

  useEffect(() => {
    document.body.classList.toggle("terms-modal-open", open);
    return () => {
      document.body.classList.remove("terms-modal-open");
    };
  }, [open]);

  useEffect(() => {
    return () => {
      revokeAllUrls(filesRef.current);
    };
  }, [revokeAllUrls]);

  const loadDurations = async (entries: QuoteFileEntry[]) => {
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const durationMs = await readMediaDuration(entry.file);
          entry.durationMs = durationMs;
          entry.loading = false;
          entry.error = "";
        } catch (error) {
          entry.durationMs = null;
          entry.loading = false;
          entry.error = error instanceof Error ? error.message : "재생 시간을 확인할 수 없습니다.";
        }
      }),
    );

    setFiles((current) =>
      current.map((entry) => entries.find((added) => added.id === entry.id) ?? entry),
    );
    setActiveFileId((current) => current ?? entries[0]?.id ?? null);
  };

  const addFiles = (fileList: FileList | File[] | null | undefined) => {
    const incoming = Array.from(fileList ?? []).filter((file) => file.size > 0);
    if (!incoming.length) return;

    const added: QuoteFileEntry[] = incoming.map((file) => ({
      id: createId("quote-file"),
      file,
      url: URL.createObjectURL(file),
      durationMs: null,
      loading: true,
      error: "",
    }));

    setFiles((current) => [...current, ...added]);
    setActiveFileId((current) => current ?? added[0].id);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void loadDurations(added);
  };

  const removeFile = (fileId: string) => {
    setFiles((current) => {
      const target = current.find((entry) => entry.id === fileId);
      if (target) URL.revokeObjectURL(target.url);
      const next = current.filter((entry) => entry.id !== fileId);
      setActiveFileId((activeId) => {
        if (activeId !== fileId) return activeId;
        return next[0]?.id ?? null;
      });
      return next;
    });
    setSegments((current) => current.filter((segment) => segment.fileId !== fileId));
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

    const nextSegment: QuoteSegment = {
      id: createId("quote-seg"),
      fileId: activeFile.id,
      start_ms,
      end_ms,
      selected: true,
    };

    setSegments((current) =>
      [...current, nextSegment].sort(
        (left, right) =>
          left.fileId.localeCompare(right.fileId) ||
          left.start_ms - right.start_ms ||
          left.end_ms - right.end_ms,
      ),
    );
    setSegmentForm({ start: { ...ZERO_HMS }, end: { ...ZERO_HMS } });
    setSegmentFormError("");
  };

  const playSegment = (segment: QuoteSegment, fileUrl: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (segmentStopHandlerRef.current) {
      audio.removeEventListener("timeupdate", segmentStopHandlerRef.current);
      segmentStopHandlerRef.current = null;
    }

    if (audio.src !== fileUrl) audio.src = fileUrl;
    audio.currentTime = segment.start_ms / 1000;
    void audio.play();

    const stopHandler = () => {
      if (audio.currentTime >= segment.end_ms / 1000) {
        audio.pause();
        if (segmentStopHandlerRef.current) {
          audio.removeEventListener("timeupdate", segmentStopHandlerRef.current);
          segmentStopHandlerRef.current = null;
        }
      }
    };
    segmentStopHandlerRef.current = stopHandler;
    audio.addEventListener("timeupdate", stopHandler);
  };

  const setCurrentToForm = (target: "start" | "end") => {
    const audio = audioRef.current;
    if (!audio || !activeFile?.durationMs) return;
    const next = clampHms(msToHms(Math.floor(audio.currentTime * 1000)), activeFile.durationMs);
    setSegmentForm((current) => ({
      ...current,
      [target]: next,
    }));
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  };

  if (!open) return null;

  return (
    <div className="terms-modal quote-modal" role="presentation">
      <button type="button" className="terms-modal__backdrop" aria-label="닫기" onClick={onClose} />
      <div
        className="terms-modal__panel quote-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-modal-title"
        aria-describedby="quote-modal-desc"
      >
        <div className="quote-modal__topbar">
          <button type="button" className="modal-close-btn quote-modal__close" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="quote-modal__body">
          <div className="quote-modal__head">
            <p className="quote-modal__eyebrow">무료 견적</p>
            <div className="quote-modal__title-row">
              <h2 className="quote-modal__title" id="quote-modal-title">
                녹취록 작성 비용 계산
              </h2>
              <button
                type="button"
                className="quote-reset-btn"
                disabled={!hasContent}
                onClick={resetQuote}
              >
                견적초기화
              </button>
            </div>
            <p className="quote-modal__desc" id="quote-modal-desc">
              음성·영상 파일을 올리면 예상 견적을 확인할 수 있습니다.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={QUOTE_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => addFiles(event.target.files)}
          />

          <button
            type="button"
            className={`quote-dropzone${dragActive ? " is-drag" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <span className="quote-dropzone__icon">📋</span>
            <span className="quote-dropzone__title">
              {files.length ? "파일 추가" : "견적용 파일 선택"}
            </span>
            <span className="quote-dropzone__desc">
              여러 파일 선택 가능 · wav, mp3, m4a, mp4 등 · 드래그 앤 드롭
            </span>
          </button>

          {files.length > 0 ? (
            <div className="quote-files">
              <div className="quote-files__head">
                <div>
                  <p className="quote-files__title">
                    업로드 파일 {files.length}개
                    {loadedFileCount ? ` · 합계 ${formatDurationHuman(totalDurationMs)}` : ""}
                  </p>
                  {loadingFileCount ? (
                    <p className="quote-files__sub">재생 시간 확인 중 {loadingFileCount}개…</p>
                  ) : null}
                </div>
              </div>
              <div className="quote-files__list">
                {files.map((entry) => (
                  <div
                    key={entry.id}
                    className={`quote-file-item${entry.id === activeFileId ? " is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="quote-file-item__main"
                      onClick={() => setActiveFileId(entry.id)}
                    >
                      <span className="quote-file-item__name">{entry.file.name}</span>
                      <span className="quote-file-item__meta">
                        {entry.loading
                          ? "재생 시간 확인 중…"
                          : entry.error
                            ? entry.error
                            : entry.durationMs != null
                              ? formatDurationHuman(entry.durationMs)
                              : "재생 시간 미확인"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="quote-file-item__remove"
                      onClick={() => removeFile(entry.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hasLoadedDuration ? (
            <>
              <div className="quote-mode-toggle">
                <button
                  type="button"
                  className={`quote-mode-btn${mode === "full" ? " is-active" : ""}`}
                  onClick={() => setMode("full")}
                >
                  파일 전체
                </button>
                <button
                  type="button"
                  className={`quote-mode-btn${mode === "segments" ? " is-active" : ""}`}
                  onClick={() => setMode("segments")}
                >
                  구간 선택
                </button>
              </div>

              {mode === "full" ? (
                <p className="quote-mode-note">
                  업로드한 {loadedFileCount}개 파일 재생 시간 합계(
                  {formatDurationHuman(totalDurationMs)})를 기준으로 견적을 계산합니다.
                </p>
              ) : (
                <div className="quote-segment-panel">
                  <p className="quote-segment-panel__title">구간 추가</p>
                  <p className="quote-segment-panel__desc">
                    파일을 선택한 뒤 구간을 추가하세요. 선택한 구간 시간의 합으로 견적이 계산됩니다.
                  </p>
                  {activeFile ? (
                    <>
                      <p className="quote-segment-panel__file">
                        편집 중: <strong>{activeFile.file.name}</strong>
                        {activeFile.durationMs != null
                          ? ` · ${formatDurationHuman(activeFile.durationMs)}`
                          : ""}
                      </p>
                      {activeFile.durationMs != null && !activeFile.error ? (
                        <audio
                          ref={audioRef}
                          className="quote-audio"
                          controls
                          preload="metadata"
                          src={activeFile.url}
                        />
                      ) : null}
                      <HmsSelect
                        name="start"
                        value={segmentForm.start}
                        maxMs={activeFile.durationMs}
                        label="시작"
                        onChange={(next) => setSegmentForm((current) => ({ ...current, start: next }))}
                      />
                      <HmsSelect
                        name="end"
                        value={segmentForm.end}
                        maxMs={activeFile.durationMs}
                        label="종료"
                        onChange={(next) => setSegmentForm((current) => ({ ...current, end: next }))}
                      />
                      <div className="quote-segment-actions">
                        <button type="button" className="quote-chip-btn" onClick={() => setCurrentToForm("start")}>
                          현재→시작
                        </button>
                        <button type="button" className="quote-chip-btn" onClick={() => setCurrentToForm("end")}>
                          현재→종료
                        </button>
                        <button type="button" className="quote-chip-btn quote-chip-btn--primary" onClick={addSegment}>
                          구간 추가
                        </button>
                      </div>
                      {segmentFormError ? <p className="quote-error">{segmentFormError}</p> : null}
                      <div className="quote-segment-list">
                        {segments.length ? (
                          segments.map((segment) => {
                            const segmentFile = files.find((entry) => entry.id === segment.fileId);
                            const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
                            return (
                              <div key={segment.id} className="quote-segment-item">
                                <input
                                  type="checkbox"
                                  checked={segment.selected}
                                  onChange={(event) => {
                                    const checked = event.target.checked;
                                    setSegments((current) =>
                                      current.map((item) =>
                                        item.id === segment.id ? { ...item, selected: checked } : item,
                                      ),
                                    );
                                  }}
                                />
                                <div className="quote-segment-item__body">
                                  <p className="quote-segment-item__range">
                                    {formatSegmentRange(segment.start_ms, segment.end_ms)}
                                  </p>
                                  <p className="quote-segment-item__meta">
                                    {segmentFile?.file.name ?? "파일"} · {formatDurationHuman(segmentDuration)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className="quote-chip-btn"
                                  onClick={() => {
                                    if (!segmentFile) return;
                                    playSegment(segment, segmentFile.url);
                                  }}
                                >
                                  재생
                                </button>
                                <button
                                  type="button"
                                  className="quote-chip-btn quote-chip-btn--danger"
                                  onClick={() =>
                                    setSegments((current) => current.filter((item) => item.id !== segment.id))
                                  }
                                >
                                  삭제
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <p className="quote-segment-empty">
                            아직 구간이 없습니다. 파일을 선택하고 구간을 추가해 주세요.
                          </p>
                        )}
                      </div>
                      <p className="quote-segment-sum">
                        선택 구간 합계: {formatDurationHuman(billableDurationMs)}
                      </p>
                    </>
                  ) : null}
                </div>
              )}

              <QuoteSummary
                quote={quote}
                mode={mode}
                fileCount={loadedFileCount}
                billableDurationMs={billableDurationMs}
              />
            </>
          ) : null}
        </div>

        <div className="quote-modal__footer">
          <button type="button" className="quote-modal__cancel" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
