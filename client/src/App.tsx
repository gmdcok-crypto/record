import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkHealth,
  downloadTranscriptPdf,
  fetchJob,
  resolveUrl,
  saveTranscript,
  speakerLabel,
  uploadVoice,
  type JobResponse,
  type TranscriptJson,
  type TranscriptSegment,
  type UploadResponse,
} from "./api";

type Step = "idle" | "uploading" | "ready" | "error";
type ArchiveStatus = "속기사 1차 초벌 대기" | "의뢰인 수정 중" | "속기사 재검수 대기";

type ArchiveItem = {
  jobId: string;
  title: string;
  filename: string;
  status: ArchiveStatus;
  updatedAt: string;
};

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const STORAGE_KEY = "client-record-archive";
const TEST_CLIENT_NAME = "홍길동";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
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

function formatDateCode(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function readArchive(): ArchiveItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ArchiveItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveArchive(items: ArchiveItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function buildDraftFromTranscript(transcript?: TranscriptJson | null): string {
  if (!transcript) return "";
  if (transcript.segments?.length) {
    return transcript.segments
      .map((segment) => `${speakerLabel(segment.speaker, transcript.speaker_labels)}: ${segment.text}`)
      .join("\n\n");
  }
  return (transcript.text || transcript.plain_text || "").trim();
}

function draftToTranscript(base: TranscriptJson | null, draft: string): TranscriptJson {
  const normalizedDraft = draft.trim();
  const lines = normalizedDraft
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = lines.map((line, index) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    const speaker = match?.[1]?.trim() || `${index + 1}`;
    const text = match?.[2]?.trim() || line;
    return {
      speaker,
      text,
      start_ms: base?.segments?.[index]?.start_ms ?? null,
      end_ms: base?.segments?.[index]?.end_ms ?? null,
    };
  });

  return {
    ...base,
    text: normalizedDraft,
    plain_text: normalizedDraft,
    segments: segments.length ? segments : base?.segments ?? [],
    tokens: base?.tokens ?? [],
    speaker_labels: base?.speaker_labels ?? {},
  };
}

function upsertArchiveItem(current: ArchiveItem[], next: ArchiveItem): ArchiveItem[] {
  const filtered = current.filter((item) => item.jobId !== next.jobId);
  return [next, ...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function buildAutoDisplayName(items: ArchiveItem[], dateCode: string): string {
  const countForToday = items.filter((item) =>
    item.title.startsWith(`${TEST_CLIENT_NAME}_녹취_${dateCode}_`),
  ).length;
  const sequence = String(countForToday + 1).padStart(2, "0");
  return `${TEST_CLIENT_NAME}_녹취_${dateCode}_${sequence}`;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [jobIdInput, setJobIdInput] = useState("");
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    checkHealth()
      .then((h) => {
        setR2Ready(h.r2_configured);
      })
      .catch(() => {
        setR2Ready(false);
      });
    setArchive(readArchive());
  }, []);

  const busy = step === "uploading" || loadingJob || saving || downloadingPdf;
  const currentTranscript = useMemo(() => draftToTranscript(job?.transcript_json ?? null, draft), [job, draft]);
  const dateCode = useMemo(() => formatDateCode(), []);
  const autoDisplayName = useMemo(() => buildAutoDisplayName(archive, dateCode), [archive, dateCode]);
  const currentTitle = useMemo(() => {
    return job?.transcript_json.filename || autoDisplayName || selectedFile?.name || "새 녹취 작업";
  }, [job, selectedFile, autoDisplayName]);

  const refreshArchive = () => setArchive(readArchive());

  const pushArchive = (status: ArchiveStatus, filename?: string) => {
    if (!job) return;
    const next = upsertArchiveItem(readArchive(), {
      jobId: job.job_id,
      title: currentTitle,
      filename: filename || job.transcript_json.filename || selectedFile?.name || "원본 파일",
      status,
      updatedAt: new Date().toISOString(),
    });
    saveArchive(next);
    setArchive(next);
  };

  const onSelect = (file: File | null) => {
    setSelectedFile(file);
    setStep("idle");
    setProgress(0);
    setError("");
    setMessage("");
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
      setDraft(buildDraftFromTranscript(data.transcript_json));
      setStep("ready");
      pushArchive("의뢰인 수정 중", data.transcript_json.filename);
      setMessage("속기사가 작성한 1차 초벌 문서를 불러왔습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
    } finally {
      setLoadingJob(false);
    }
  };

  const onUpload = async () => {
    if (!selectedFile) return;
    setStep("uploading");
    setProgress(0);
    setError("");
    setMessage("");

    try {
      const uploaded: UploadResponse = await uploadVoice(
        selectedFile,
        setProgress,
      );
      setJob(null);
      setDraft("");
      setJobIdInput(uploaded.job_id);
      setStep("idle");

      const nextArchive = upsertArchiveItem(readArchive(), {
        jobId: uploaded.job_id,
        title: currentTitle,
        filename: selectedFile.name,
        status: "속기사 1차 초벌 대기",
        updatedAt: new Date().toISOString(),
      });
      saveArchive(nextArchive);
      setArchive(nextArchive);
      setMessage("업로드가 완료되었습니다. 속기사 1차 초벌 후 보관함 또는 작업번호로 문서를 열어 수정할 수 있습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
      setStep("error");
    }
  };

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript, {
        editor: TEST_CLIENT_NAME,
        changeSummary: "의뢰인 초안 저장",
      });
      setJob({
        ...job,
        transcript_json: currentTranscript,
      });
      pushArchive("의뢰인 수정 중");
      setMessage("의뢰인 수정본이 저장되었습니다.");
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
      await saveTranscript(job.job_id, currentTranscript, {
        editor: TEST_CLIENT_NAME,
        changeSummary: "의뢰인 수정 후 속기사 검수 요청",
      });
      setJob({
        ...job,
        transcript_json: currentTranscript,
      });
      pushArchive("속기사 재검수 대기");
      setMessage("속기사 검수 요청이 저장되었습니다. 보관함에서 상태를 확인하세요.");
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
      await downloadTranscriptPdf(job.job_id, currentTranscript);
      setMessage("PDF를 다운로드했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:gap-6">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-1">
            <div className="mb-5">
              <p className="text-sm font-semibold text-blue-300">1. 파일 업로드</p>
            </div>

            <div className="space-y-4">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
              />

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/80 px-4 py-10 text-center transition hover:border-blue-400 hover:bg-slate-900 disabled:opacity-60"
              >
                <span className="text-4xl">🎙️</span>
                <span className="mt-3 font-semibold text-slate-100">
                  {selectedFile ? selectedFile.name : "음성/영상 파일 선택"}
                </span>
                <span className="mt-1 text-sm text-slate-400">
                  {selectedFile ? formatSize(selectedFile.size) : "wav, mp3, m4a, mp4 등 지원"}
                </span>
              </button>

              {step === "uploading" && (
                <div>
                  <div className="mb-1 flex justify-between text-sm text-slate-400">
                    <span>업로드 중...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onUpload}
                disabled={!selectedFile || busy || r2Ready === false}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                업로드
              </button>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-400">
                <p className="font-semibold text-slate-100">추가 제안 기능</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>다중 파일을 하나의 사건으로 묶는 업로드</li>
                  <li>의뢰인 표시명 자동 생성 규칙</li>
                  <li>검수 요청 사유 / 메모 입력</li>
                  <li>속기사 검수 완료 알림</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-3 lg:col-span-2">
            <div className="mb-5">
              <p className="text-sm font-semibold text-emerald-300">3. 보관함</p>
              <h2 className="mt-1 text-xl font-bold text-white">업로드 파일 확인</h2>
              <p className="mt-1 text-sm text-slate-400">
                모바일에서는 여기서 파일을 선택한 뒤 아래 편집 영역으로 내려가 수정하는 흐름이 가장 편합니다.
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
                  <button
                    key={item.jobId}
                    type="button"
                    onClick={() => void loadJobById(item.jobId)}
                    className="block w-full rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-blue-500 hover:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-100">{item.title}</p>
                        <p className="mt-1 truncate text-sm text-slate-400">{item.filename}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          item.status === "속기사 재검수 대기"
                              ? "bg-violet-500/15 text-violet-300"
                              : item.status === "의뢰인 수정 중"
                                ? "bg-cyan-500/15 text-cyan-300"
                                : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono">{item.jobId}</span>
                      <span>{formatDateTime(item.updatedAt)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                  아직 보관함에 저장된 작업이 없습니다.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={refreshArchive}
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              보관함 새로고침
            </button>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20 lg:order-2">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-violet-300">2. 직접 편집</p>
                <h2 className="mt-1 text-xl font-bold text-white">
                  {currentTitle || "녹취 초안 편집"}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  의뢰인은 속기사가 작성한 1차 초벌 문서만 열어 수정하고 재검수를 요청할 수 있습니다.
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
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="속기사가 작성한 1차 초벌 문서가 여기에 표시됩니다. 화자명: 내용 형식으로 수정해도 됩니다."
                    className="min-h-[420px] w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                  />
                  <p className="mt-2 text-xs text-slate-400">
                    권장 형식: <code className="rounded bg-slate-800 px-1 text-slate-200">화자명: 발언 내용</code>
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
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
                업로드만 먼저 진행하고, 보관함에서 초벌 완료 파일을 선택한 뒤 여기서 수정하세요.
              </div>
            )}
          </section>
        </div>

        {(message || error) && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              error
                ? "border border-red-500/30 bg-red-500/10 text-red-300"
                : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {error || message}
          </div>
        )}
      </div>
    </div>
  );
}
