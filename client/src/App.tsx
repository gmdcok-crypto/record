import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelClientJob,
  checkHealth,
  downloadTranscriptPdf,
  downloadFinalTranscriptPdf,
  fetchClientJobs,
  fetchJob,
  resolveUrl,
  saveTranscript,
  speakerLabel,
  updateJobStatus,
  uploadVoice,
  type JobArchiveItem,
  type JobResponse,
  type TranscriptJson,
  type TranscriptSegment,
  type UploadResponse,
} from "./api";

type Step = "idle" | "uploading" | "ready" | "error";
type EditableSegment = TranscriptSegment & { id: string };

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const TEST_CLIENT_NAME = "홍길동";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function buildEditableSegments(transcript?: TranscriptJson | null): EditableSegment[] {
  const segments = transcript?.segments ?? [];
  if (segments.length) {
    return segments.map((segment, index) => ({
      ...segment,
      id: `${segment.speaker}-${segment.start_ms ?? "na"}-${index}`,
    }));
  }
  const body = (transcript?.text || transcript?.plain_text || "").trim();
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      return {
        id: `fallback-${index}`,
        speaker: match?.[1]?.trim() || `${index + 1}`,
        text: match?.[2]?.trim() || line,
        start_ms: null,
        end_ms: null,
      };
    });
}

function segmentsToTranscript(base: TranscriptJson | null, segments: EditableSegment[]): TranscriptJson {
  const cleaned = segments.map(({ id: _id, ...segment }) => ({
    ...segment,
    speaker: segment.speaker.trim() || "화자",
    text: segment.text.trim(),
  }));
  const body = cleaned
    .filter((segment) => segment.text.trim())
    .map((segment) => `${speakerLabel(segment.speaker, base?.speaker_labels)}: ${segment.text.trim()}`)
    .join("\n\n");

  return {
    ...base,
    text: body,
    plain_text: body,
    segments: cleaned,
    tokens: base?.tokens ?? [],
    speaker_labels: base?.speaker_labels ?? {},
  };
}

function formatSegmentTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function archiveStatusStyle(status: string): string {
  switch (status) {
    case "review_waiting":
      return "bg-violet-500/15 text-violet-300";
    case "client_editing":
      return "bg-cyan-500/15 text-cyan-300";
    case "final_done":
    case "pdf_sent":
      return "bg-emerald-500/15 text-emerald-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function normalizeUploadFilename(filename: string): string {
  return filename.trim();
}

function fileIdentity(file: File): string {
  return `${normalizeUploadFilename(file.name)}::${file.size}::${file.lastModified}`;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [jobIdInput, setJobIdInput] = useState("");
  const [archive, setArchive] = useState<JobArchiveItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<JobArchiveItem | null>(null);
  const [duplicateDialogMessage, setDuplicateDialogMessage] = useState("");
  const segmentEndRef = useRef<number | null>(null);

  const busy = step === "uploading" || loadingJob || saving || downloadingPdf;
  const archivedFilenames = useMemo(
    () => new Set(archive.map((item) => normalizeUploadFilename(item.filename))),
    [archive],
  );
  const currentTranscript = useMemo(
    () => segmentsToTranscript(job?.transcript_json ?? null, segments),
    [job, segments],
  );
  const currentTitle = useMemo(
    () => job?.title || job?.transcript_json.filename || selectedFiles[0]?.name || "새 녹취 작업",
    [job, selectedFiles],
  );

  const refreshArchive = async () => {
    try {
      const jobs = await fetchClientJobs();
      setArchive(jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "보관함을 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    checkHealth()
      .then((h) => {
        setR2Ready(h.r2_configured);
        setDbReady(Boolean(h.database_configured));
      })
      .catch(() => {
        setR2Ready(false);
        setDbReady(false);
      });
    void refreshArchive();
  }, []);

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventWindowDrop);
    window.addEventListener("drop", preventWindowDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowDrop);
      window.removeEventListener("drop", preventWindowDrop);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      if (segmentEndRef.current == null) return;
      if (audio.currentTime >= segmentEndRef.current) {
        audio.pause();
        segmentEndRef.current = null;
      }
    };

    const clearSegmentTarget = () => {
      segmentEndRef.current = null;
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", clearSegmentTarget);
    audio.addEventListener("pause", clearSegmentTarget);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", clearSegmentTarget);
      audio.removeEventListener("pause", clearSegmentTarget);
    };
  }, [job?.job_id]);

  const resetUploadUi = (nextMessage = "") => {
    setSelectedFiles([]);
    setProgress(0);
    setStep("idle");
    setError("");
    setMessage(nextMessage);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSelect = (files: FileList | null) => {
    const incomingFiles = files ? Array.from(files) : [];
    if (!incomingFiles.length) return;

    const duplicateFile = incomingFiles.find((file) => archivedFilenames.has(normalizeUploadFilename(file.name)));
    if (duplicateFile) {
      openDuplicateDialog(`이미 업로드된 파일입니다: ${duplicateFile.name}`);
      return;
    }

    setSelectedFiles((prev) => {
      const existing = new Set(prev.map(fileIdentity));
      const appended = incomingFiles.filter((file) => !existing.has(fileIdentity(file)));
      return [...prev, ...appended];
    });
    setStep("idle");
    setProgress(0);
    setError("");
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDropFiles = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    onSelect(event.dataTransfer.files);
  };

  const playSegment = (startMs: number | null | undefined, endMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;

    segmentEndRef.current = endMs != null ? Math.max(startMs / 1000, endMs / 1000) : null;
    audio.currentTime = Math.max(0, startMs / 1000);
    void audio.play().catch(() => {
      segmentEndRef.current = null;
    });
  };

  const loadJobById = async (jobId: string) => {
    if (!jobId.trim()) return;
    setLoadingJob(true);
    setError("");
    setMessage("");
    try {
      const data = await fetchJob(jobId.trim());
      setJob(data);
      setJobIdInput(data.job_id);
      setSegments(buildEditableSegments(data.transcript_json));
      setStep("ready");
      setMessage("업로드된 작업을 불러왔습니다. 속기사 작업 후 보관함 상태가 갱신됩니다.");
      await refreshArchive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
    } finally {
      setLoadingJob(false);
    }
  };

  const performUpload = async (fileToUpload: File) => {
    setStep("uploading");
    setProgress(0);
    setError("");
    try {
      const uploaded: UploadResponse = await uploadVoice(fileToUpload, setProgress);
      setJob(null);
      setSegments([]);
      setJobIdInput(uploaded.job_id);
      await refreshArchive();
    } catch (err) {
      const message = err instanceof Error ? err.message : "업로드 실패";
      if (message.includes("이미 업로드된 파일입니다")) {
        setError("");
        openDuplicateDialog(message);
      } else {
        setError(message);
      }
      setStep("error");
      throw err;
    }
  };

  const onUpload = async () => {
    if (!selectedFiles.length) return;
    const filesToUpload = [...selectedFiles];

    const duplicateFile = filesToUpload.find((file) => archivedFilenames.has(normalizeUploadFilename(file.name)));
    if (duplicateFile) {
      openDuplicateDialog(`이미 업로드된 파일입니다: ${duplicateFile.name}`);
      return;
    }

    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        setMessage(`업로드 중 ${index + 1}/${filesToUpload.length}: ${file.name}`);
        await performUpload(file);
      }
      resetUploadUi(`${filesToUpload.length}개 파일 업로드가 완료되었습니다. 업로드된 파일은 관리자 배정 후 속기사가 직접 녹취록을 작성합니다.`);
    } catch {
      // Error state is already handled in performUpload.
    }
  };

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      await updateJobStatus(job.job_id, "client_editing", "의뢰인 수정본 저장");
      setJob({ ...job, transcript_json: currentTranscript, status: "client_editing" });
      setMessage("의뢰인 수정본이 DB와 R2에 저장되었습니다.");
      await refreshArchive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSubmitForReview = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      await updateJobStatus(job.job_id, "review_waiting", "의뢰인 수정 후 속기사 재검수 요청");
      setJob({ ...job, transcript_json: currentTranscript, status: "review_waiting" });
      setMessage("재검수 요청이 DB에 반영되었습니다.");
      await refreshArchive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "검수 요청 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDownloadPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    setError("");
    setMessage("");
    try {
      if (job.final_pdf_ready) {
        await downloadFinalTranscriptPdf(job.job_id);
        setMessage("저장된 최종 PDF를 다운로드했습니다.");
      } else {
        await downloadTranscriptPdf(job.job_id, currentTranscript);
        setMessage("현재 문서 기준 PDF를 다운로드했습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const updateSegment = (index: number, patch: Partial<TranscriptSegment>) => {
    setSegments((prev) =>
      prev.map((segment, currentIndex) => (currentIndex === index ? { ...segment, ...patch } : segment)),
    );
  };

  const restoreFromServerDraft = () => {
    if (!job) return;
    setSegments(buildEditableSegments(job.transcript_json));
    setMessage("서버에 저장된 최신 문서로 되돌렸습니다.");
    setError("");
  };

  const onCancelUpload = async (jobId: string) => {
    setError("");
    setMessage("");
    try {
      await cancelClientJob(jobId);
      if (job?.job_id === jobId) {
        setJob(null);
        setSegments([]);
        setJobIdInput("");
        setStep("idle");
      }
      await refreshArchive();
      setMessage("배정 전 업로드를 취소했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 취소 실패");
    }
  };

  const closeCancelDialog = () => {
    setCancelTarget(null);
  };

  const openDuplicateDialog = (nextMessage: string) => {
    resetUploadUi();
    setDuplicateDialogMessage(nextMessage);
  };

  const closeDuplicateDialog = () => {
    setDuplicateDialogMessage("");
  };

  const confirmCancelUpload = async () => {
    if (!cancelTarget) return;
    const jobId = cancelTarget.job_id;
    setCancelTarget(null);
    await onCancelUpload(jobId);
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:gap-6">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-1">
            <div className="mb-5">
              <p className="text-sm font-semibold text-blue-300">1. 파일 업로드</p>
              <h2 className="mt-1 text-xl font-bold text-white">{TEST_CLIENT_NAME} 의뢰 업로드</h2>
              <p className="mt-2 text-sm text-slate-400">
                업로드와 보관함은 DB 연동형으로 동작합니다.
              </p>
            </div>

            <div className="space-y-4">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => onSelect(e.target.files)}
              />

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
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
                onDrop={onDropFiles}
                className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition disabled:opacity-60 ${
                  isDragActive
                    ? "border-blue-400 bg-slate-900"
                    : "border-slate-700 bg-slate-950/80 hover:border-blue-400 hover:bg-slate-900"
                }`}
              >
                <span className="text-4xl">🎙️</span>
                <span className="mt-3 font-semibold text-slate-100">
                  {selectedFiles.length > 0 ? `${selectedFiles.length}개 파일 선택됨` : "음성/영상 파일 선택"}
                </span>
                <span className="mt-1 text-sm text-slate-400">
                  {selectedFiles.length > 0
                    ? `${selectedFiles[0].name}${selectedFiles.length > 1 ? ` 외 ${selectedFiles.length - 1}개` : ""} · 총 ${formatSize(
                        selectedFiles.reduce((sum, file) => sum + file.size, 0),
                      )}`
                    : "wav, mp3, m4a, mp4 등 지원 · 드래그 앤 드롭 가능"}
                </span>
              </button>

              {step === "uploading" && (
                <div>
                  <div className="mb-1 flex justify-between text-sm text-slate-400">
                    <span>업로드 중...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {selectedFiles.length > 1 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">선택된 파일</p>
                  <div className="space-y-2">
                    {selectedFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-slate-200">{file.name}</span>
                        <span className="shrink-0 text-slate-500">{formatSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onUpload}
                disabled={!selectedFiles.length || busy || r2Ready === false || dbReady === false}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {selectedFiles.length > 1 ? `${selectedFiles.length}개 파일 업로드` : "업로드"}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-3 lg:col-span-2">
            <div className="mb-5">
              <p className="text-sm font-semibold text-emerald-300">3. 보관함</p>
              <h2 className="mt-1 text-xl font-bold text-white">DB 저장 작업 목록</h2>
              <p className="mt-1 text-sm text-slate-400">
                의뢰인 업로드 이력과 상태는 DB에서 조회합니다.
              </p>
            </div>

            <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                작업번호로 불러오기
              </label>
              <div className="flex gap-2">
                <input
                  value={jobIdInput}
                  onChange={(e) => setJobIdInput(e.target.value)}
                  placeholder="job_id 입력"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => void loadJobById(jobIdInput)}
                  disabled={busy || !jobIdInput.trim()}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  열기
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {archive.length ? (
                archive.map((item) => (
                  <div
                    key={item.job_id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-blue-500 hover:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => void loadJobById(item.job_id)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-semibold text-slate-100">{item.title}</p>
                        <p className="mt-1 truncate text-sm text-slate-400">{item.filename}</p>
                      </button>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${archiveStatusStyle(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono">{item.job_id}</span>
                      <div className="flex items-center gap-2">
                        <span>{formatDateTime(item.updated_at)}</span>
                        {item.status === "waiting_assignment" ? (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(item)}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300"
                          >
                            업로드 취소
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                  아직 저장된 작업이 없습니다.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void refreshArchive()}
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              보관함 새로고침
            </button>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-2">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-violet-300">2. 직접 편집</p>
                <h2 className="mt-1 text-xl font-bold text-white">{currentTitle}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  대화 텍스트를 눌러 오디오 구간을 들으면서 수정하고 재검수를 요청할 수 있습니다.
                </p>
              </div>
              {job && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                  <div>작업 ID</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-100">{job.job_id}</div>
                </div>
              )}
            </div>

            {job ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">원본 음성</label>
                  <audio
                    ref={audioRef}
                    controls
                    preload="metadata"
                    src={resolveUrl(job.audio_url)}
                    className="w-full rounded-xl"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">
                    녹취 초안 / 의뢰인 수정본
                  </label>
                  <div className="space-y-3">
                    {segments.length ? (
                      segments.map((segment, index) => (
                        <div key={segment.id} className="rounded-2xl border border-slate-700 bg-slate-950/80 p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <input
                                value={segment.speaker}
                                onChange={(e) => updateSegment(index, { speaker: e.target.value })}
                                className="w-28 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition focus:border-blue-500"
                              />
                              <span className="text-xs text-slate-500">
                                {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => playSegment(segment.start_ms, segment.end_ms)}
                              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
                            >
                              이 구간 재생
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => playSegment(segment.start_ms, segment.end_ms)}
                            className="block w-full rounded-2xl bg-slate-900/80 px-4 py-3 text-left text-sm leading-7 text-slate-200 transition hover:bg-slate-800"
                          >
                            {segment.text || "내용을 입력하세요."}
                          </button>
                          <textarea
                            value={segment.text}
                            onChange={(e) => updateSegment(index, { text: e.target.value })}
                            placeholder="이 구간의 수정 내용을 입력하세요."
                            className="mt-3 min-h-[120px] w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                          />
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                        수정할 대화 구간이 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={busy}
                    className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    임시 저장
                  </button>
                  <button
                    type="button"
                    onClick={restoreFromServerDraft}
                    disabled={busy}
                    className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    서버본 다시 불러오기
                  </button>
                  <button
                    type="button"
                    onClick={onSubmitForReview}
                    disabled={busy}
                    className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                  >
                    속기사 재검수 요청
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadPdf}
                    disabled={busy}
                    className="rounded-xl bg-slate-200 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-50"
                  >
                    PDF 다운로드
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-6 py-14 text-center text-sm text-slate-400">
                업로드 후 보관함이나 작업번호로 문서를 불러오세요.
              </div>
            )}
          </section>
        </div>

        <div className="sr-only" aria-live="polite">
          {error || message}
        </div>

        {cancelTarget ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40">
              <h3 className="text-lg font-semibold text-white">업로드 취소</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                <span className="font-medium text-white">{cancelTarget.filename}</span> 업로드를 취소하시겠습니까?
                배정 전 파일만 취소할 수 있으며, 취소하면 보관함과 저장된 원본 파일이 함께 삭제됩니다.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCancelDialog}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => void confirmCancelUpload()}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                >
                  취소 진행
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {duplicateDialogMessage ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40">
              <h3 className="text-lg font-semibold text-white">중복 업로드 안내</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{duplicateDialogMessage}</p>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeDuplicateDialog}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
