import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  bootstrapTranscriberTokenFromUrl,
  clearTranscriberSession,
  downloadFinalTranscriptPdf,
  fetchAssignedProjects,
  fetchJob,
  fetchTranscriberMe,
  finalizeTranscriptPdf,
  resolveUrl,
  runAiDraft,
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
type EditableSegment = TranscriptSegment & { id: string };

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

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authScreen, setAuthScreen] = useState<AuthScreen>("signup");
  const [transcriberName, setTranscriberName] = useState<string | null>(null);
  const [projects, setProjects] = useState<TranscriberProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
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
    () => segmentsToTranscript(job?.transcript_json ?? null, segments),
    [job, segments],
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
    setSegments([]);
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
      setSegments([]);
      return;
    }
    setLoadingJob(true);
    setMessage("");
    setError("");
    fetchJob(selectedJobId)
      .then((data) => {
        setJob(data);
        setSegments(buildEditableSegments(data.transcript_json));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
      })
      .finally(() => setLoadingJob(false));
  }, [selectedJobId]);

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

  const playSegment = (startMs: number | null | undefined, endMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;

    segmentEndRef.current = endMs != null ? Math.max(startMs / 1000, endMs / 1000) : null;
    audio.currentTime = Math.max(0, startMs / 1000);
    void audio.play().catch(() => {
      segmentEndRef.current = null;
    });
  };

  const handleSegmentTextMouseDown = (
    event: MouseEvent<HTMLTextAreaElement>,
    startMs: number | null | undefined,
    endMs: number | null | undefined,
  ) => {
    const textarea = event.currentTarget;
    if (document.activeElement !== textarea) {
      event.preventDefault();
      playSegment(startMs, endMs);
      textarea.focus();
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

  const busy = saving || aiRunning || downloadingPdf;

  const selectProject = (project: TranscriberProject) => {
    const key = projectKey(project);
    setSelectedProjectKey(key);
    setSelectedJobId(project.files[0]?.job_id ?? "");
  };

  const onRunAiDraft = async () => {
    if (!job) return;
    if (segments.some((segment) => segment.text.trim()) && !window.confirm("기존 편집 내용을 AI 초벌 결과로 덮어씁니다. 계속할까요?")) {
      return;
    }

    setAiRunning(true);
    setError("");
    setMessage("");
    try {
      const result = await runAiDraft(job.job_id);
      const transcript = result.transcript_json;
      setJob({ ...job, transcript_json: transcript, status: job.status === "assigned" ? "working" : job.status });
      setSegments(buildEditableSegments(transcript));
      setMessage("AI 초벌 작업이 완료되었습니다. 내용을 확인한 뒤 저장하세요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 초벌 작업에 실패했습니다.");
    } finally {
      setAiRunning(false);
    }
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
              <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-12 text-center text-sm text-slate-400 shadow-2xl shadow-black/20">
                파일을 불러오는 중입니다...
              </section>
            ) : job ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-violet-300">편집</p>
                    {currentProject && currentFile ? (
                      <p className="mt-1 text-sm text-cyan-300/90">
                        {currentProject.title} &gt; {currentFile.filename}
                      </p>
                    ) : null}
                    <h2 className="mt-1 text-xl font-bold text-white">{currentFile?.title || "녹취 편집"}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      구간 텍스트를 누르면 해당 오디오가 재생되고, 같은 영역에서 바로 수정할 수 있습니다.
                    </p>
                    {currentProject ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {currentProject.client.name} · 마감 {formatDateTime(currentProject.due_at)} ·{" "}
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${fileStatusStyle(job.status || "")}`}>
                          {mapFileStatusLabel(job.status || "")}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                    <div>작업 ID</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-100">{job.job_id}</div>
                  </div>
                </div>

                {aiRunning ? (
                  <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    음성을 분석해 AI 초벌을 생성하는 중입니다. 완료될 때까지 잠시만 기다려 주세요.
                  </div>
                ) : null}

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
                    <label className="mb-1 block text-sm font-medium text-slate-300">녹취 초벌 / 속기사 편집본</label>
                    <div className="max-h-[min(62vh,640px)] space-y-2 overflow-y-auto pr-1">
                      {segments.length ? (
                        segments.map((segment, index) => (
                          <div key={segment.id} className="rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2.5">
                            <div className="mb-1.5 flex min-w-0 items-center gap-2">
                              <input
                                value={segment.speaker}
                                disabled={aiRunning}
                                onChange={(e) => updateSegment(index, { speaker: e.target.value })}
                                className="w-24 shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-100 outline-none transition focus:border-blue-500 disabled:opacity-50"
                              />
                              <span className="text-[11px] text-slate-500">
                                {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                              </span>
                            </div>
                            <textarea
                              value={segment.text}
                              rows={1}
                              disabled={aiRunning}
                              onChange={(e) => {
                                updateSegment(index, { text: e.target.value });
                                autoResizeTextarea(e.currentTarget);
                              }}
                              onMouseDown={(e) =>
                                handleSegmentTextMouseDown(e, segment.start_ms, segment.end_ms)
                              }
                              onFocus={(e) => autoResizeTextarea(e.currentTarget)}
                              ref={(element) => {
                                if (element) autoResizeTextarea(element);
                              }}
                              placeholder="텍스트를 눌러 재생하고, 여기서 바로 수정하세요."
                              className="w-full resize-none overflow-hidden rounded-lg border border-transparent bg-slate-900/60 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-slate-700 focus:border-blue-500 focus:bg-slate-900 disabled:opacity-50"
                            />
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                          {aiRunning ? "AI 초벌을 생성하는 중입니다..." : "수정할 대화 구간이 없습니다."}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void onRunAiDraft()}
                      disabled={busy}
                      className="rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
                    >
                      {aiRunning ? "AI 초벌 진행 중..." : "AI 초벌작업"}
                    </button>
                    <button
                      type="button"
                      onClick={onSaveDraft}
                      disabled={busy}
                      className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? "저장 중..." : "초벌 임시 저장"}
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
                      onClick={onSendToClient}
                      disabled={busy}
                      className="rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                    >
                      의뢰인에게 초벌 전달
                    </button>
                    <button
                      type="button"
                      onClick={onFinalize}
                      disabled={busy}
                      className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                    >
                      최종본 확정
                    </button>
                    <button
                      type="button"
                      onClick={onDownloadStampedPdf}
                      disabled={busy}
                      className="rounded-xl bg-slate-200 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-50"
                    >
                      {downloadingPdf ? "PDF 생성 중..." : "도장 날인 PDF"}
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-sm text-slate-400 shadow-2xl shadow-black/20">
                왼쪽에서 프로젝트와 파일을 선택하세요.
              </section>
            )}
          </main>
          </div>
        </div>
      </div>
    </div>
  );
}
