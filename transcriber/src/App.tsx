import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapTranscriberTokenFromUrl,
  clearTranscriberSession,
  createAdminEventsSource,
  createTranscriberJobInquiry,
  downloadFinalTranscriptPdf,
  fetchAssignedProjects,
  fetchJob,
  fetchTranscriberMe,
  fetchTranscriberLicenseObjectUrl,
  fetchTranscriberJobInquiries,
  fetchTranscriptChanges,
  finalizeTranscriptPdf,
  resolveUrl,
  deliverDraftToClient,
  runAiDraft,
  saveTranscript,
  updateTranscriberProfile,
  uploadTranscriberLicense,
  speakerLabel,
  type JobResponse,
  type TranscriberAuthProfile,
  type TranscriberProject,
  type TranscriberProjectFile,
  type TranscriptJson,
  type TranscriptSegment,
} from "./api";
import ActionNoticeModal, { type ActionNotice, type ActionNoticeKind } from "./ActionNoticeModal";
import TranscriberLogin from "./TranscriberLogin";
import TranscriberProfileSettingsModal from "./TranscriberProfileSettingsModal";
import TranscriberSignup from "./TranscriberSignup";
import AddSegmentModal, { type AddSegmentDraft } from "./AddSegmentModal";
import ManagerInquiryPanel from "./ManagerInquiryPanel";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";
import {
  createManualSegmentId,
  deriveExtraSpeakerIds,
  insertSegmentAfter,
  mergeSpeakerIds,
  nextSpeakerId,
} from "./transcriptEditor";
import SegmentPlaybackText from "./SegmentPlaybackText";
import { buildSegmentTimedWords, segmentContainsActiveWord } from "./playbackHighlight";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";

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
      return "의뢰인 검토";
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
      return "의뢰인 검토";
    case "client_editing":
      return "의뢰인 검토";
    case "review_waiting":
      return "속기사검토";
    case "final_done":
    case "pdf_sent":
      return "PDF 완료";
    default:
      return status;
  }
}

function jobWorkflowStatus(job: { status?: string; workflow_status?: string } | null | undefined): string {
  return job?.workflow_status ?? job?.status ?? "";
}

function fileWorkflowStatus(file: { status: string; workflow_status?: string }): string {
  return file.workflow_status ?? file.status;
}

function renderTranscriberInquiryBadge(status?: "reply_pending" | "reply_arrived" | null) {
  if (status === "reply_pending") {
    return (
      <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
        답변 필요
      </span>
    );
  }
  if (status === "reply_arrived") {
    return (
      <span className="inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
        답변 도착
      </span>
    );
  }
  return null;
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

function segmentsToTranscript(
  base: TranscriptJson | null,
  segments: EditableSegment[],
  speaker_labels: Record<string, string>,
): TranscriptJson {
  const cleaned = segments.map(({ id: _id, ...segment }) => ({
    ...segment,
    speaker: segment.speaker.trim() || "1",
    text: segment.text.trim(),
  }));
  const body = cleaned
    .filter((segment) => segment.text.trim())
    .map((segment) => `${speakerLabel(segment.speaker, speaker_labels)}: ${segment.text.trim()}`)
    .join("\n\n");
  return {
    ...base,
    text: body,
    plain_text: body,
    segments: cleaned,
    tokens: base?.tokens ?? [],
    speaker_labels,
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
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authScreen, setAuthScreen] = useState<AuthScreen>("signup");
  const [transcriberName, setTranscriberName] = useState<string | null>(null);
  const [transcriberProfile, setTranscriberProfile] = useState<TranscriberAuthProfile | null>(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<TranscriberProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [extraSpeakerIds, setExtraSpeakerIds] = useState<string[]>([]);
  const [addSegmentAfterIndex, setAddSegmentAfterIndex] = useState<number | null>(null);
  const [changeHistoryRefresh, setChangeHistoryRefresh] = useState(0);
  const [inquiryRefresh, setInquiryRefresh] = useState(0);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingProjectsAfterLogin, setLoadingProjectsAfterLogin] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const showNotice = useCallback((kind: ActionNoticeKind, message: string, title?: string) => {
    setActionNotice({ kind, message, title });
  }, []);

  const currentProject = useMemo(
    () => projects.find((project) => projectKey(project) === selectedProjectKey) ?? null,
    [projects, selectedProjectKey],
  );

  const currentFile = useMemo<TranscriberProjectFile | null>(() => {
    if (!currentProject) return null;
    return currentProject.files.find((file) => file.job_id === selectedJobId) ?? currentProject.files[0] ?? null;
  }, [currentProject, selectedJobId]);

  const speakerIds = useMemo(
    () => mergeSpeakerIds(segments, extraSpeakerIds),
    [segments, extraSpeakerIds],
  );
  const currentTranscript = useMemo(
    () => segmentsToTranscript(job?.transcript_json ?? null, segments, speakerLabels),
    [job, segments, speakerLabels],
  );
  const transcriptTokens = useMemo(() => job?.transcript_json?.tokens ?? [], [job?.transcript_json?.tokens]);

  const loadProjects = useCallback(async (suppressError = false) => {
    setLoadingProjects(true);
    try {
      const data = await fetchAssignedProjects();
      setProjects(data);
    } catch (err) {
      if (!suppressError) {
        showNotice("error", err instanceof Error ? err.message : "배정 프로젝트를 불러오지 못했습니다.");
      }
    } finally {
      setLoadingProjects(false);
    }
  }, [showNotice]);

  useEffect(() => {
    const currentProjectExists = selectedProjectKey
      ? projects.some((project) => projectKey(project) === selectedProjectKey)
      : false;
    const currentJobExists = selectedJobId
      ? projects.some((project) => project.files.some((file) => file.job_id === selectedJobId))
      : false;

    if (projects.length === 0) {
      if (selectedProjectKey) setSelectedProjectKey("");
      if (selectedJobId) setSelectedJobId("");
      return;
    }

    if (!currentProjectExists) {
      const first = projects[0];
      setSelectedProjectKey(projectKey(first));
      setSelectedJobId(first.files[0]?.job_id ?? "");
      return;
    }

    if (!currentJobExists) {
      const selectedProject = projects.find((project) => projectKey(project) === selectedProjectKey) ?? projects[0];
      setSelectedProjectKey(projectKey(selectedProject));
      setSelectedJobId(selectedProject.files[0]?.job_id ?? "");
    }
  }, [projects, selectedProjectKey, selectedJobId]);

  const loadLicensePreviewUrl = useCallback(async () => fetchTranscriberLicenseObjectUrl(), []);

  const openProfileSettings = async () => {
    const fresh = await fetchTranscriberMe();
    if (fresh) {
      setTranscriberProfile(fresh);
      setTranscriberName(fresh.name);
    }
    setProfileSettingsOpen(true);
  };

  const restoreSession = async () => {
    bootstrapTranscriberTokenFromUrl();
    const transcriber = await fetchTranscriberMe();
    if (transcriber) {
      setTranscriberName(transcriber.name);
      setTranscriberProfile(transcriber);
      setLoadingProjectsAfterLogin(true);
      setAuthStatus("authenticated");
      window.setTimeout(() => {
        void loadProjects(false).finally(() => setLoadingProjectsAfterLogin(false));
      }, 0);
      return transcriber;
    }
    setTranscriberName(null);
    setTranscriberProfile(null);
    setLoadingProjectsAfterLogin(false);
    setAuthStatus("unauthenticated");
    return null;
  };

  const handleLoginSuccess = (transcriber: TranscriberAuthProfile) => {
    setTranscriberName(transcriber.name);
    setTranscriberProfile(transcriber);
    setLoadingProjectsAfterLogin(true);
    setAuthStatus("authenticated");
    window.setTimeout(() => {
      void loadProjects(false).finally(() => setLoadingProjectsAfterLogin(false));
    }, 0);
  };

  const handleLogout = () => {
    clearTranscriberSession();
    setTranscriberName(null);
    setTranscriberProfile(null);
    setAuthStatus("unauthenticated");
    setProjects([]);
    setSelectedProjectKey("");
    setSelectedJobId("");
    setJob(null);
    setSegments([]);
    setSpeakerLabels({});
  };

  useEffect(() => {
    void restoreSession();
    // restoreSession is intentionally run once on mount; it schedules the initial project load itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshVisibleProjects = useCallback(() => {
    if (document.visibilityState === "visible" && authStatus === "authenticated") {
      void loadProjects(true);
    }
  }, [authStatus, loadProjects]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    let alive = true;
    const eventSource = createAdminEventsSource();
    const handleAdminUpdate = () => {
      if (!alive) return;
      setInquiryRefresh((value) => value + 1);
      void loadProjects(true);
    };

    eventSource.addEventListener("admin_update", handleAdminUpdate);
    eventSource.addEventListener("error", () => {
      console.error("transcriber SSE connection error");
    });

    window.addEventListener("focus", refreshVisibleProjects);
    document.addEventListener("visibilitychange", refreshVisibleProjects);

    return () => {
      alive = false;
      eventSource.removeEventListener("admin_update", handleAdminUpdate);
      eventSource.close();
      window.removeEventListener("focus", refreshVisibleProjects);
      document.removeEventListener("visibilitychange", refreshVisibleProjects);
    };
  }, [authStatus, loadProjects, refreshVisibleProjects]);

  useEffect(() => {
    if (!selectedJobId) {
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      return;
    }
    setLoadingJob(true);
    fetchJob(selectedJobId)
      .then((data) => {
        setJob(data);
        const loadedSegments = buildEditableSegments(data.transcript_json);
        const loadedLabels = data.transcript_json?.speaker_labels ?? {};
        setSegments(loadedSegments);
        setSpeakerLabels(loadedLabels);
        setExtraSpeakerIds(deriveExtraSpeakerIds(loadedSegments, loadedLabels));
      })
      .catch((err) => {
        showNotice("error", err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
      })
      .finally(() => setLoadingJob(false));
  }, [selectedJobId, showNotice]);

  useEffect(() => {
    setPlaybackMs(0);
    setIsAudioPlaying(false);
    const audio = audioRef.current;
    if (!audio) return;

    const cleanupStop = attachSegmentStopListener(audio, segmentEndRef);
    const cleanupTime = attachPlaybackTimeListener(audio, {
      onTimeUpdate: setPlaybackMs,
      onPlayingChange: setIsAudioPlaying,
    });

    return () => {
      cleanupStop();
      cleanupTime();
    };
  }, [job?.job_id]);

  const playSegment = (index: number, startMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;
    const endMs = resolveSegmentEndMs(segments, index);
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  const updateSegment = (index: number, patch: Partial<TranscriptSegment>) => {
    setSegments((prev) =>
      prev.map((segment, currentIndex) => (currentIndex === index ? { ...segment, ...patch } : segment)),
    );
  };

  const applySpeakerLabels = (labels: Record<string, string>) => {
    const cleaned: Record<string, string> = {};
    for (const [id, name] of Object.entries(labels)) {
      if (name.trim()) cleaned[id] = name.trim();
    }
    setSpeakerLabels(cleaned);
    setExtraSpeakerIds((prev) => prev.filter((id) => speakerIds.includes(id)));
    setSpeakerSettingsOpen(false);
    showNotice("info", "화자 이름이 적용되었습니다. 저장하면 서버에 반영됩니다.");
  };

  const handleAddSpeaker = () => {
    const id = nextSpeakerId(speakerIds);
    setExtraSpeakerIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    showNotice("info", `${speakerLabel(id)}이(가) 추가되었습니다. 이름을 입력한 뒤 적용하세요.`);
  };

  const busy = saving || aiRunning || downloadingPdf;

  const openAddSegmentAfter = (index: number) => {
    if (busy || !speakerIds.length) return;
    setAddSegmentAfterIndex(index);
  };

  const handleAddSegment = (draft: AddSegmentDraft) => {
    if (addSegmentAfterIndex == null) return;
    const segment: EditableSegment = {
      id: createManualSegmentId(),
      speaker: draft.speaker,
      text: draft.text,
      start_ms: null,
      end_ms: null,
    };
    setSegments((prev) => insertSegmentAfter(prev, addSegmentAfterIndex, segment));
    setAddSegmentAfterIndex(null);
    showNotice("success", "대화 구간이 추가되었습니다.");
  };

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
    try {
      const result = await runAiDraft(job.job_id);
      const transcript = result.transcript_json;
      setJob({ ...job, transcript_json: transcript, status: job.status === "assigned" ? "working" : job.status });
      const aiSegments = buildEditableSegments(transcript);
      const aiLabels = transcript.speaker_labels ?? {};
      setSegments(aiSegments);
      setSpeakerLabels(aiLabels);
      setExtraSpeakerIds(deriveExtraSpeakerIds(aiSegments, aiLabels));
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "AI 초벌 작업이 완료되었습니다. 검토 후 ‘의뢰인 검토요청’을 눌러 주세요.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "AI 초벌 작업에 실패했습니다.");
    } finally {
      setAiRunning(false);
    }
  };

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setActionNotice(null);
    try {
      await saveTranscript(job.job_id, currentTranscript, "draft");
      setJob({ ...job, transcript_json: currentTranscript });
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "초벌 임시 저장이 완료되었습니다.", "임시 저장 완료");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "저장 실패", "임시 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSendToClient = async () => {
    if (!job) return;
    if (!segments.some((segment) => segment.text.trim())) {
      showNotice("error", "전달할 초벌 내용이 없습니다. AI 초벌작업을 실행하거나 직접 작성해 주세요.");
      return;
    }
    setSendingToClient(true);
    setSaving(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const result = await deliverDraftToClient(job.job_id, currentTranscript);
      setJob({
        ...job,
        transcript_json: result.transcript_json,
        status: result.status,
        workflow_status: result.workflow_status ?? result.status,
      });
      await loadProjects();
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "의뢰인 검토요청을 보냈습니다. 의뢰인 화면에서 의뢰인 검토 상태로 확인할 수 있습니다.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "전달 실패");
    } finally {
      setSaving(false);
      setSendingToClient(false);
    }
  };

  const onFinalize = async () => {
    if (!job) return;
    setSaving(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "finalize");
      setJob({ ...job, transcript_json: currentTranscript });
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "최종본이 저장되었습니다.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "확정 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDownloadStampedPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "pdf_finalize");
      await finalizeTranscriptPdf(job.job_id, currentTranscript);
      await downloadFinalTranscriptPdf(job.job_id);
      setJob({ ...job, transcript_json: currentTranscript, final_pdf_ready: true, status: "pdf_sent" });
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "최종 PDF를 R2에 저장하고 다운로드했습니다.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "PDF 다운로드 실패");
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
            <div className="min-w-0">
              <p className="text-sm font-semibold text-cyan-300">속기사 녹취</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-white">
                  {transcriberName ? `${transcriberName}님` : "속기사"}
                </h1>
                <button
                  type="button"
                  onClick={() => void openProfileSettings()}
                  className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/5 hover:text-white"
                >
                  설정
                </button>
              </div>
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
              {loadingProjectsAfterLogin && !projects.length ? (
                <p className="text-sm text-slate-400">프로젝트를 불러오는 중입니다.</p>
              ) : loadingProjects ? (
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
                      disabled={loadingJob}
                      className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-violet-500/40 bg-violet-500/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <p className="truncate text-sm font-medium text-white">{file.filename}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{formatDateTime(file.due_at)}</p>
                      <div className="mt-2 flex items-center gap-2">
                        {renderTranscriberInquiryBadge(file.transcriber_inquiry_status)}
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${fileStatusStyle(fileWorkflowStatus(file))}`}>
                          {mapFileStatusLabel(fileWorkflowStatus(file))}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-slate-400">선택한 프로젝트에 파일이 없습니다.</p>
              )}
            </div>
          </aside>

          <main className="space-y-4">
            {loadingJob ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-12 text-center text-sm text-slate-400 shadow-2xl shadow-black/20">
                파일을 불러오는 중입니다...
              </section>
            ) : job ? (
              <section className="relative rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
                {sendingToClient ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/75 px-6 backdrop-blur-sm">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/95 px-6 py-5 text-center shadow-2xl shadow-black/30">
                      <p className="text-sm font-semibold text-white">의뢰인에게 전달중입니다.</p>
                    </div>
                  </div>
                ) : null}
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
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${fileStatusStyle(jobWorkflowStatus(job))}`}>
                          {mapFileStatusLabel(jobWorkflowStatus(job))}
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
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="text-sm font-medium text-slate-300">녹취 초벌 / 속기사 편집본</label>
                      <button
                        type="button"
                        onClick={() => setSpeakerSettingsOpen(true)}
                        disabled={busy}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        화자 설정
                      </button>
                    </div>
                    <div className="max-h-[min(62vh,640px)] space-y-2 overflow-y-auto pr-1">
                      {segments.length ? (
                        segments.map((segment, index) => {
                          const segmentWords = buildSegmentTimedWords(
                            segment.text,
                            segment,
                            index,
                            segments,
                            transcriptTokens,
                          );
                          const hasActiveWord =
                            isAudioPlaying && segmentContainsActiveWord(segmentWords, playbackMs);

                          return (
                          <div
                            key={segment.id}
                            className={`rounded-xl border px-3 py-2.5 transition-colors ${
                              hasActiveWord
                                ? "border-violet-300/70 bg-violet-400/10"
                                : "border-slate-700/80 bg-slate-950/80"
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={busy || aiRunning || !speakerIds.length ? -1 : 0}
                              onClick={() => openAddSegmentAfter(index)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openAddSegmentAfter(index);
                                }
                              }}
                              title="클릭하여 이 대화 다음에 새 대화 추가"
                              className={`mb-1.5 flex w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 text-left transition ${
                                busy || aiRunning || !speakerIds.length
                                  ? "cursor-not-allowed opacity-50"
                                  : "cursor-pointer hover:border-violet-500/30 hover:bg-violet-500/10"
                              }`}
                            >
                              <select
                                value={segment.speaker}
                                disabled={aiRunning}
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                onChange={(e) => updateSegment(index, { speaker: e.target.value })}
                                className="max-w-[9rem] shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 outline-none transition focus:border-blue-500 disabled:opacity-50"
                              >
                                {speakerIds.map((id) => (
                                  <option key={id} value={id}>
                                    {speakerLabel(id, speakerLabels)}
                                  </option>
                                ))}
                              </select>
                              <span className="text-[11px] text-slate-500">
                                {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                              </span>
                              <span className="ml-auto text-[10px] font-semibold text-violet-400/80">+ 추가</span>
                            </div>
                            <SegmentPlaybackText
                              value={segment.text}
                              segment={segment}
                              segmentIndex={index}
                              segments={segments}
                              tokens={transcriptTokens}
                              playbackMs={playbackMs}
                              isAudioPlaying={isAudioPlaying}
                              disabled={aiRunning || busy}
                              placeholder="한 번 클릭: 재생 · 더블클릭: 수정"
                              onChange={(text) => updateSegment(index, { text })}
                              onPlayRequest={() => playSegment(index, segment.start_ms)}
                              onEditStart={() => audioRef.current?.pause()}
                              onAutoResize={autoResizeTextarea}
                            />
                          </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                          {aiRunning ? "AI 초벌을 생성하는 중입니다..." : "수정할 대화 구간이 없습니다."}
                        </div>
                      )}
                    </div>
                  </div>

                  <TranscriptChangeHistory
                    jobId={job.job_id}
                    refreshKey={changeHistoryRefresh}
                    loadEntries={fetchTranscriptChanges}
                  />

                  <ManagerInquiryPanel
                    jobId={job.job_id}
                    loadMessages={fetchTranscriberJobInquiries}
                    sendMessage={createTranscriberJobInquiry}
                    onError={(message) => showNotice("error", message)}
                    refreshKey={inquiryRefresh}
                  />

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
                      {saving ? "저장 중..." : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={onSendToClient}
                      disabled={busy}
                      className="rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                    >
                      의뢰인 검토요청
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

        <SpeakerSettingsModal
          open={speakerSettingsOpen}
          speakerIds={speakerIds}
          labels={speakerLabels}
          onClose={() => setSpeakerSettingsOpen(false)}
          onApply={applySpeakerLabels}
          onAddSpeaker={handleAddSpeaker}
        />

        <AddSegmentModal
          open={addSegmentAfterIndex != null}
          speakerIds={speakerIds}
          speakerLabels={speakerLabels}
          defaultSpeakerId={
            addSegmentAfterIndex != null ? segments[addSegmentAfterIndex]?.speaker : undefined
          }
          onClose={() => setAddSegmentAfterIndex(null)}
          onAdd={handleAddSegment}
        />

        <TranscriberProfileSettingsModal
          open={profileSettingsOpen}
          profile={transcriberProfile}
          onClose={() => setProfileSettingsOpen(false)}
          onSaved={(next) => {
            setTranscriberProfile(next);
            setTranscriberName(next.name);
            showNotice("success", "개인정보가 저장되었습니다.");
          }}
          onSaveProfile={updateTranscriberProfile}
          onUploadLicense={uploadTranscriberLicense}
          loadLicensePreviewUrl={loadLicensePreviewUrl}
        />

        <ActionNoticeModal notice={actionNotice} onClose={() => setActionNotice(null)} accent="violet" />
      </div>
    </div>
  );
}
