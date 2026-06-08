import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapTranscriberTokenFromUrl,
  clearTranscriberSession,
  downloadFinalTranscriptPdf,
  fetchAssignedProjects,
  fetchJob,
  fetchTranscriberMe,
  finalizeTranscriptPdf,
  resolveUrl,
  saveTranscript,
  speakerLabel,
  type JobResponse,
  type TranscriberAuthProfile,
  type TranscriberProject,
  type TranscriberProjectFile,
  type TranscriptJson,
  type TranscriptSegment,
} from "./api";
import TranscriberLogin from "./TranscriberLogin";
import TranscriberSignup from "./TranscriberSignup";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type AuthScreen = "signup" | "login";

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

function projectKey(project: TranscriberProject): string {
  return project.project_id || `solo-${project.files[0]?.job_id || project.title}`;
}

function mapProjectStatus(status: string): string {
  switch (status) {
    case "waiting_assignment":
      return "배정 대기";
    case "working":
      return "작업 중";
    case "client_review":
      return "의뢰인 확인";
    case "completed":
      return "완료";
    default:
      return status;
  }
}

function mapFileStatusLabel(status: string): string {
  switch (status) {
    case "assigned":
      return "배정 완료";
    case "working":
      return "초벌 작성 중";
    case "first_done":
      return "의뢰인 확인";
    case "client_editing":
      return "의뢰인 수정 중";
    case "review_waiting":
      return "재검수";
    case "final_done":
    case "pdf_sent":
      return "PDF 완료";
    default:
      return status;
  }
}

function fileStatusStyle(status: string): string {
  switch (status) {
    case "final_done":
    case "pdf_sent":
      return "bg-emerald-500/15 text-emerald-300";
    case "first_done":
    case "review_waiting":
    case "client_editing":
      return "bg-violet-500/15 text-violet-300";
    case "assigned":
    case "working":
      return "bg-cyan-500/15 text-cyan-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function projectStatusStyle(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300";
    case "client_review":
      return "bg-violet-500/15 text-violet-300";
    case "working":
      return "bg-cyan-500/15 text-cyan-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
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

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authScreen, setAuthScreen] = useState<AuthScreen>("signup");
  const [transcriberName, setTranscriberName] = useState<string | null>(null);
  const [projects, setProjects] = useState<TranscriberProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentProject = useMemo(
    () => projects.find((project) => projectKey(project) === selectedProjectKey) ?? null,
    [projects, selectedProjectKey],
  );

  const currentFile = useMemo<TranscriberProjectFile | null>(() => {
    if (!currentProject) return null;
    return currentProject.files.find((file) => file.job_id === selectedJobId) ?? currentProject.files[0] ?? null;
  }, [currentProject, selectedJobId]);

  const currentTranscript = useMemo(
    () => draftToTranscript(job?.transcript_json ?? null, draft),
    [job, draft],
  );

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError("");
    try {
      const data = await fetchAssignedProjects();
      setProjects(data);
      const first = data[0];
      if (first) {
        const key = projectKey(first);
        setSelectedProjectKey(key);
        setSelectedJobId(first.files[0]?.job_id ?? "");
      } else {
        setSelectedProjectKey("");
        setSelectedJobId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "배정 프로젝트를 불러오지 못했습니다.");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const restoreSession = async () => {
    bootstrapTranscriberTokenFromUrl();
    const transcriber = await fetchTranscriberMe();
    if (transcriber) {
      setTranscriberName(transcriber.name);
      setAuthStatus("authenticated");
      return transcriber;
    }
    setTranscriberName(null);
    setAuthStatus("unauthenticated");
    return null;
  };

  const handleLoginSuccess = (transcriber: TranscriberAuthProfile) => {
    setTranscriberName(transcriber.name);
    setAuthStatus("authenticated");
    setError("");
    void loadProjects();
  };

  const handleLogout = () => {
    clearTranscriberSession();
    setTranscriberName(null);
    setAuthStatus("unauthenticated");
    setProjects([]);
    setSelectedProjectKey("");
    setSelectedJobId("");
    setJob(null);
    setDraft("");
    setMessage("");
    setError("");
  };

  useEffect(() => {
    void restoreSession().then((transcriber) => {
      if (transcriber) void loadProjects();
    });
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedJobId) {
      setJob(null);
      setDraft("");
      return;
    }
    setLoadingJob(true);
    setMessage("");
    setError("");
    fetchJob(selectedJobId)
      .then((data) => {
        setJob(data);
        setDraft(buildDraftFromTranscript(data.transcript_json));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
      })
      .finally(() => setLoadingJob(false));
  }, [selectedJobId]);

  const selectProject = (project: TranscriberProject) => {
    const key = projectKey(project);
    setSelectedProjectKey(key);
    setSelectedJobId(project.files[0]?.job_id ?? "");
  };

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      setMessage("초벌 임시 저장이 완료되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSendToClient = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      setMessage("의뢰인 검토용 초벌본을 저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "전달 실패");
    } finally {
      setSaving(false);
    }
  };

  const onFinalize = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      setMessage("최종본이 저장되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "확정 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDownloadStampedPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      await finalizeTranscriptPdf(job.job_id, currentTranscript);
      await downloadFinalTranscriptPdf(job.job_id);
      setJob({ ...job, transcript_json: currentTranscript, final_pdf_ready: true, status: "pdf_sent" });
      setMessage("최종 PDF를 R2에 저장하고 다운로드했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400">
        로그인 확인 중…
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    if (authScreen === "signup") {
      return <TranscriberSignup onSuccess={handleLoginSuccess} onLogin={() => setAuthScreen("login")} />;
    }
    return <TranscriberLogin onSuccess={handleLoginSuccess} onSignup={() => setAuthScreen("signup")} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_22%),linear-gradient(to_bottom,rgba(15,23,42,0.84),rgba(2,6,23,0.98))]" />
        <div className="relative mx-auto min-h-screen max-w-[1680px] px-4 py-4 lg:px-6">
          <header className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-cyan-300">속기사 녹취</p>
              <h1 className="mt-1 text-2xl font-bold text-white">{transcriberName ? `${transcriberName}님` : "속기사"}</h1>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              로그아웃
            </button>
          </header>

          <div className="grid min-h-[calc(100vh-6rem)] gap-4 lg:grid-cols-[220px_240px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/10 bg-slate-950/70 p-4 backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">프로젝트</p>
            <h2 className="mt-2 text-lg font-semibold text-white">배정 사건</h2>
            <div className="mt-4 space-y-2">
              {loadingProjects ? (
                <p className="text-sm text-slate-400">불러오는 중…</p>
              ) : projects.length === 0 ? (
                <p className="text-sm text-slate-400">배정된 프로젝트가 없습니다.</p>
              ) : (
                projects.map((project) => {
                  const key = projectKey(project);
                  const active = key === selectedProjectKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectProject(project)}
                      className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-cyan-500/40 bg-cyan-500/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <p className="truncate text-sm font-semibold text-white">{project.title}</p>
                      <p className="mt-1 truncate text-xs text-slate-400">{project.client.name}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${projectStatusStyle(project.status)}`}>
                          {mapProjectStatus(project.status)}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {project.completed_count}/{project.file_count}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <aside className="rounded-[28px] border border-white/10 bg-slate-950/70 p-4 backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">파일</p>
            <h2 className="mt-2 text-lg font-semibold text-white">녹음 목록</h2>
            <p className="mt-1 truncate text-xs text-slate-400">{currentProject?.title || "프로젝트 선택"}</p>
            <div className="mt-4 space-y-2">
              {currentProject?.files.length ? (
                currentProject.files.map((file) => {
                  const active = file.job_id === selectedJobId;
                  return (
                    <button
                      key={file.job_id}
                      type="button"
                      onClick={() => setSelectedJobId(file.job_id)}
                      className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-violet-500/40 bg-violet-500/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <p className="truncate text-sm font-medium text-white">{file.filename}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{formatDateTime(file.due_at)}</p>
                      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${fileStatusStyle(file.status)}`}>
                        {mapFileStatusLabel(file.status)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-slate-400">선택한 프로젝트에 파일이 없습니다.</p>
              )}
            </div>
          </aside>

          <main className="space-y-4">
            <header className="rounded-[28px] border border-white/10 bg-slate-950/60 px-5 py-5 backdrop-blur-xl">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-sm font-medium text-cyan-300">속기사 편집</p>
                  {currentProject && currentFile ? (
                    <p className="mt-2 text-sm text-slate-400">
                      {currentProject.title} &gt; {currentFile.filename}
                    </p>
                  ) : null}
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">
                    {currentFile?.title || "파일을 선택하세요"}
                  </h2>
                  {currentProject ? (
                    <p className="mt-2 text-sm text-slate-400">
                      {currentProject.client.name} · 마감 {formatDateTime(currentProject.due_at)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={!job || saving}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "초벌 임시 저장"}
                  </button>
                  <button
                    type="button"
                    onClick={onSendToClient}
                    disabled={!job || saving}
                    className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                  >
                    의뢰인에게 초벌 전달
                  </button>
                  <button
                    type="button"
                    onClick={onFinalize}
                    disabled={!job || saving}
                    className="rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
                  >
                    최종본 확정
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadStampedPdf}
                    disabled={!job || downloadingPdf}
                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {downloadingPdf ? "PDF 생성 중..." : "도장 날인 PDF"}
                  </button>
                </div>
              </div>
            </header>

            {(message || error) && (
              <div
                className={`rounded-3xl px-4 py-3 text-sm ${
                  error
                    ? "border border-red-500/30 bg-red-500/10 text-red-300"
                    : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {error || message}
              </div>
            )}

            {loadingJob ? (
              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-12 text-center text-slate-400 backdrop-blur-xl">
                파일을 불러오는 중입니다...
              </div>
            ) : job ? (
              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.85fr]">
                <section className="space-y-6">
                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-cyan-300">원본 음성</p>
                    <audio
                      ref={audioRef}
                      controls
                      preload="metadata"
                      src={resolveUrl(job.audio_url)}
                      className="mt-4 w-full rounded-2xl"
                    />
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-violet-300">문서 편집</p>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="화자명: 발언 내용 형식으로 초벌을 작성하세요."
                      className="mt-4 min-h-[480px] w-full rounded-3xl border border-slate-700 bg-slate-950 px-5 py-4 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                    />
                  </div>
                </section>
                <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                  <p className="text-sm font-semibold text-emerald-300">작업 정보</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">작업번호</dt>
                      <dd className="mt-1 break-all font-mono text-white">{job.job_id}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">파일명</dt>
                      <dd className="mt-1 text-white">{currentFile?.filename || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">상태</dt>
                      <dd className="mt-1">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${fileStatusStyle(job.status || "")}`}>
                          {mapFileStatusLabel(job.status || "")}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">
                왼쪽에서 프로젝트와 파일을 선택하세요.
              </div>
            )}
          </main>
          </div>
        </div>
      </div>
    </div>
  );
}
