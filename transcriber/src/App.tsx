import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapTranscriberTokenFromUrl,
  clearUrlQuery,
  clearTranscriberSession,
  createAdminEventsSource,
  createTranscriberJobInquiry,
  deliverTranscriptPdf,
  fetchAssignedProjects,
  fetchTranscriberFrontendVersion,
  fetchJob,
  fetchTranscriberMe,
  fetchTranscriberLicenseObjectUrl,
  fetchTranscriberJobInquiries,
  fetchTranscriptChanges,
  finalTranscriptPdfUrl,
  finalizeTranscriptPdf,
  readPortOneIdentityVerificationIdFromUrl,
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
import ConfirmModal from "./ConfirmModal";
import TranscriberLogin from "./TranscriberLogin";
import TranscriberProfileSettingsModal from "./TranscriberProfileSettingsModal";
import TranscriberSignup from "./TranscriberSignup";
import AddSegmentModal, { type AddSegmentDraft } from "./AddSegmentModal";
import ManagerInquiryPanel from "./ManagerInquiryPanel";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";
import { formatKstDateTime } from "./formatKstDateTime";
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
import {
  enableWebPush,
  getNotificationPermissionState,
  hasRegisteredPushSubscription,
  syncWebPushRegistration,
} from "./webPush";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type AuthScreen = "signup" | "login";
type MenuKey = "work";
type WorkTab = "projects" | "files" | "editor";
type PushPermissionState = NotificationPermission | "unsupported";
type EditableSegment = TranscriptSegment & { id: string };
const FRONTEND_VERSION_POLL_MS = 60_000;

const TRANSCRIBER_MENUS: { key: MenuKey; label: string }[] = [{ key: "work", label: "녹취 작업" }];

const WORK_TABS: { key: WorkTab; label: string }[] = [
  { key: "projects", label: "프로젝트" },
  { key: "files", label: "파일" },
  { key: "editor", label: "편집" },
];

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

function formatTotalDurationLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

function formatProjectFileCount(count: number, totalSeconds: number): string {
  const duration = formatTotalDurationLabel(totalSeconds);
  return duration ? `${count}개(${duration})` : `${count}개`;
}

function normalizeWorkflowStatus(status: string): string {
  switch (status) {
    case "uploaded":
      return "waiting_assignment";
    case "assigned":
      return "working";
    case "first_done":
    case "client_editing":
      return "client_review";
    case "review_waiting":
      return "transcript_request";
    case "final_done":
      return "pdf_sent";
    default:
      return status;
  }
}

function mapFileStatusLabel(status: string): string {
  switch (normalizeWorkflowStatus(status)) {
    case "waiting_assignment":
      return "배정 대기";
    case "working":
      return "작업 중";
    case "client_review":
      return "의뢰인 검토";
    case "transcriber_review":
      return "속기사검토";
    case "transcript_request":
      return "녹취록 요청";
    case "pdf_sent":
      return "최종완료";
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
      <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        답변 필요
      </span>
    );
  }
  if (status === "reply_arrived") {
    return (
      <span className="inline-flex rounded-full border border-violet-500/30 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
        답변 도착
      </span>
    );
  }
  return null;
}

function fileStatusStyle(status: string): string {
  switch (normalizeWorkflowStatus(status)) {
    case "pdf_sent":
      return "border border-emerald-500/30 bg-emerald-50 text-emerald-700";
    case "client_review":
    case "transcriber_review":
    case "transcript_request":
      return "border border-violet-500/30 bg-violet-50 text-violet-700";
    case "working":
      return "border border-cyan-500/30 bg-cyan-50 text-cyan-700";
    default:
      return "border border-amber-500/30 bg-amber-50 text-amber-800";
  }
}

function projectStatusStyle(status: string): string {
  switch (status) {
    case "completed":
      return "border border-emerald-500/30 bg-emerald-50 text-emerald-700";
    case "client_review":
      return "border border-violet-500/30 bg-violet-50 text-violet-700";
    case "working":
      return "border border-cyan-500/30 bg-cyan-50 text-cyan-700";
    default:
      return "border border-amber-500/30 bg-amber-50 text-amber-800";
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
  const frontendVersionRef = useRef<string | null>(null);
  const frontendReloadingRef = useRef(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authScreen, setAuthScreen] = useState<AuthScreen>("login");
  const [pendingSignupIdentityVerificationId, setPendingSignupIdentityVerificationId] = useState<string | null>(null);
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
  const [pushPermission, setPushPermission] = useState<PushPermissionState>("default");
  const [pushRegistered, setPushRegistered] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [aiDraftConfirmOpen, setAiDraftConfirmOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey>("work");
  const [workTab, setWorkTab] = useState<WorkTab>("projects");

  const showNotice = useCallback((kind: ActionNoticeKind, message: string, title?: string) => {
    setActionNotice({ kind, message, title });
  }, []);

  const openJobFromNotification = useCallback(
    (jobId: string) => {
      const normalizedJobId = jobId.trim();
      if (!normalizedJobId) return;
      for (const project of projects) {
        const file = project.files.find((entry) => entry.job_id === normalizedJobId);
        if (file) {
          setActiveMenu("work");
          setSelectedProjectKey(projectKey(project));
          setSelectedJobId(file.job_id);
          setWorkTab("editor");
          return;
        }
      }
    },
    [projects],
  );

  const refreshPushPermission = useCallback(async () => {
    const permission = await getNotificationPermissionState();
    setPushPermission(permission);
    setPushRegistered(await hasRegisteredPushSubscription());
  }, []);

  const handleEnablePush = useCallback(async () => {
    if (!transcriberProfile) return;
    setEnablingPush(true);
    try {
      if (Notification.permission === "default") {
        showNotice("info", "브라우저 상단 또는 주소창 옆의 알림 허용 창을 확인해 주세요.");
      }
      const result = await enableWebPush(transcriberProfile);
      const permission = await getNotificationPermissionState();
      setPushPermission(permission);
      setPushRegistered(await hasRegisteredPushSubscription());
      if (result === "enabled") {
        showNotice("success", "웹푸시 알림이 활성화되었습니다.");
      } else if (result === "denied") {
        showNotice("error", "브라우저 알림 권한이 차단되어 있습니다.");
      } else if (result === "disabled") {
        showNotice("error", "서버 웹푸시 설정이 아직 준비되지 않았습니다.");
      } else {
        showNotice("error", "이 브라우저에서는 웹푸시를 지원하지 않습니다.");
      }
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "웹푸시 활성화 실패");
    } finally {
      setEnablingPush(false);
    }
  }, [showNotice, transcriberProfile]);

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
  const selectedUploadSegments = useMemo(() => job?.selected_segments ?? [], [job?.selected_segments]);

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
    const signupIdentityVerificationId = readPortOneIdentityVerificationIdFromUrl();
    if (signupIdentityVerificationId) {
      setAuthScreen("signup");
      setPendingSignupIdentityVerificationId(signupIdentityVerificationId);
    }
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
    const title = "불판속기사";
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:site_name"]')?.setAttribute("content", title);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="application-name"]')?.setAttribute("content", title);
  }, []);

  useEffect(() => {
    void restoreSession();
    void refreshPushPermission();
    // restoreSession is intentionally run once on mount; it schedules the initial project load itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!transcriberProfile) return;
    void syncWebPushRegistration()
      .then((registered) => {
        if (registered) setPushRegistered(true);
      })
      .catch(() => {
        setPushRegistered(false);
      });
  }, [transcriberProfile]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "WEB_PUSH_NOTIFICATION_CLICK") return;
      const jobId = event.data?.payload?.jobId;
      if (typeof jobId === "string" && jobId.trim()) {
        openJobFromNotification(jobId);
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [openJobFromNotification]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !projects.length) return;
    const jobId = new URLSearchParams(window.location.search).get("job_id");
    if (!jobId) return;
    openJobFromNotification(jobId);
    window.history.replaceState(null, "", window.location.pathname);
  }, [authStatus, openJobFromNotification, projects]);

  useEffect(() => {
    let cancelled = false;

    const checkFrontendVersion = async () => {
      if (frontendReloadingRef.current) return;
      const nextVersion = await fetchTranscriberFrontendVersion();
      if (cancelled || !nextVersion) return;

      if (!frontendVersionRef.current) {
        frontendVersionRef.current = nextVersion;
        return;
      }

      if (frontendVersionRef.current !== nextVersion) {
        frontendReloadingRef.current = true;
        window.location.reload();
      }
    };

    void checkFrontendVersion();
    const intervalId = window.setInterval(() => {
      void checkFrontendVersion();
    }, FRONTEND_VERSION_POLL_MS);

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void checkFrontendVersion();
      }
    };

    window.addEventListener("focus", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
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

  const requestedRanges = useMemo(
    () => selectedUploadSegments.filter((segment) => segment.selected !== false && segment.end_ms > segment.start_ms),
    [selectedUploadSegments],
  );

  const playRequestedRange = (startMs: number, endMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
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
    setWorkTab("files");
  };

  const selectFile = (jobId: string) => {
    setSelectedJobId(jobId);
    setWorkTab("editor");
  };

  const onRunAiDraft = async () => {
    if (!job || aiRunning) return;
    if (segments.some((segment) => segment.text.trim())) {
      setAiDraftConfirmOpen(true);
      return;
    }
    await executeAiDraft();
  };

  const executeAiDraft = async () => {
    if (!job) return;
    setAiRunning(true);
    try {
      const result = await runAiDraft(job.job_id);
      const transcript = result.transcript_json;
      setJob({ ...job, transcript_json: transcript, status: "working", workflow_status: "working" });
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

  const onDeliverPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    try {
      if (!job.final_pdf_ready) {
        await saveTranscript(job.job_id, currentTranscript, "pdf_finalize");
        await finalizeTranscriptPdf(job.job_id, currentTranscript);
      }
      const result = await deliverTranscriptPdf(job.job_id, false);
      const refreshed = await fetchJob(job.job_id);
      setJob({
        ...refreshed,
        transcript_json: refreshed.transcript_json ?? currentTranscript,
        status: result.workflow_status ?? result.status ?? refreshed.workflow_status ?? refreshed.status ?? "pdf_sent",
        workflow_status: result.workflow_status ?? result.status ?? refreshed.workflow_status ?? refreshed.status ?? "pdf_sent",
        final_pdf_ready: true,
      });
      await loadProjects();
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "PDF를 의뢰인에게 전달했습니다.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "PDF 전달 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (authStatus === "loading") {
    return (
      <div className="esl-login flex min-h-dvh items-center justify-center">
        <p className="text-sm text-[var(--esl-muted)]">로그인 확인 중…</p>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    if (authScreen === "signup") {
      return (
        <TranscriberSignup
          onSuccess={handleLoginSuccess}
          onLogin={() => setAuthScreen("login")}
          initialIdentityVerificationId={pendingSignupIdentityVerificationId}
          onIdentityVerificationHandled={() => {
            clearUrlQuery();
            setPendingSignupIdentityVerificationId(null);
          }}
        />
      );
    }
    return <TranscriberLogin onSuccess={handleLoginSuccess} onSignup={() => setAuthScreen("signup")} />;
  }

  return (
    <div className="esl-theme min-h-screen">
      <div className="esl-shell relative min-h-screen">
        <div className="esl-layout relative mx-auto grid min-h-screen max-w-[1880px] lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="esl-sidebar" aria-label="주 메뉴">
            <div className="esl-logo">불판속기사</div>

            <nav className="esl-nav" aria-label="메뉴">
              <div className="esl-menu-group">
                <div className="esl-menu-title">
                  작업 메뉴
                  <span className="esl-chev" aria-hidden="true">
                    ▾
                  </span>
                </div>
                <ul className="esl-submenu">
                  {TRANSCRIBER_MENUS.map((item) => {
                    const active = item.key === activeMenu;
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          className={`esl-menu-item${active ? " is-active" : ""}`}
                          onClick={() => setActiveMenu(item.key)}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

            <div className="esl-sidebar-push lg:hidden">
              <p className="esl-sidebar-push-title">모바일 알림</p>
              <p className="esl-sidebar-push-copy">
                {pushRegistered
                  ? "이 기기에서 작업 알림을 받고 있습니다."
                  : "배정·검토 알림을 이 기기로 받으려면 알림을 허용해 주세요."}
              </p>
              <div className="esl-sidebar-push-actions">
                <span>
                  상태:{" "}
                  {pushRegistered
                    ? "등록됨"
                    : pushPermission === "denied"
                      ? "차단됨"
                      : pushPermission === "unsupported"
                        ? "미지원"
                        : "미등록"}
                </span>
                {!pushRegistered || pushPermission !== "granted" ? (
                  <button
                    type="button"
                    disabled={enablingPush}
                    onClick={() => void handleEnablePush()}
                    className="esl-sidebar-push-btn"
                  >
                    {enablingPush ? "등록 중..." : "알림 받기"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="esl-sidebar-foot">
              <button type="button" className="esl-menu-item" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          </aside>

          <main className="esl-main space-y-4">
            <section className="esl-topbar px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--esl-muted)]">Workspace</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    {activeMenu === "work" ? "녹취 작업" : "작업"}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--esl-muted)]">
                    {transcriberName ? `${transcriberName}님` : "속기사"}
                    {currentProject && currentFile
                      ? ` · ${currentProject.title} > ${currentFile.filename}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="rounded-md border px-2.5 py-1 text-[11px] text-[var(--esl-muted)]">
                    {transcriberProfile?.code || "속기사"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void openProfileSettings()}
                    className="rounded-md border px-3 py-1.5 text-[11px] font-semibold transition hover:bg-[#f7f9fc]"
                  >
                    설정
                  </button>
                  {(!pushRegistered || pushPermission !== "granted") ? (
                    <button
                      type="button"
                      onClick={() => void handleEnablePush()}
                      disabled={enablingPush}
                      className="hidden rounded-md border px-3 py-1.5 text-[11px] font-semibold transition hover:bg-[#f7f9fc] disabled:opacity-50 lg:inline-flex"
                    >
                      {enablingPush ? "알림 설정 중..." : "알림 받기"}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="esl-content">
              {activeMenu === "work" ? (
                <>
                  <div className="esl-tabs" role="tablist" aria-label="녹취 작업 탭">
                    {WORK_TABS.map((tab) => {
                      const disabled =
                        (tab.key === "files" && !currentProject) || (tab.key === "editor" && !selectedJobId);
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          role="tab"
                          aria-selected={workTab === tab.key}
                          disabled={disabled}
                          className={`esl-tab${workTab === tab.key ? " is-active" : ""}`}
                          onClick={() => setWorkTab(tab.key)}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {workTab === "projects" ? (
                    <div className="esl-tab-panel" role="tabpanel">
                      <div className="esl-list-panel">
                        <h3 className="esl-list-panel-title">배정 사건</h3>
                        <p className="esl-list-panel-subtitle">작업할 프로젝트를 선택하세요.</p>
                        <div className="esl-list">
                          {loadingProjectsAfterLogin && !projects.length ? (
                            <p className="esl-list-empty">프로젝트를 불러오는 중입니다.</p>
                          ) : loadingProjects ? (
                            <p className="esl-list-empty">불러오는 중…</p>
                          ) : projects.length === 0 ? (
                            <p className="esl-list-empty">배정된 프로젝트가 없습니다.</p>
                          ) : (
                            projects.map((project) => {
                              const key = projectKey(project);
                              const active = key === selectedProjectKey;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => selectProject(project)}
                                  className={`esl-list-item${active ? " is-active" : ""}`}
                                >
                                  <p className="truncate text-sm font-semibold">{project.title}</p>
                                  <p className="mt-1 truncate text-xs text-[var(--esl-muted)]">{project.client.name}</p>
                                  <p className="mt-1 truncate text-[11px] text-[var(--esl-muted)]">
                                    배정 {formatKstDateTime(project.files.find((file) => file.assigned_at)?.assigned_at)}
                                  </p>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${projectStatusStyle(project.status)}`}>
                                      {mapProjectStatus(project.status)}
                                    </span>
                                    <span className="text-[11px] font-medium text-[var(--esl-muted)]">
                                      {formatProjectFileCount(project.file_count, project.total_duration_seconds ?? 0)}
                                    </span>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {workTab === "files" ? (
                    <div className="esl-tab-panel" role="tabpanel">
                      <div className="esl-list-panel">
                        <h3 className="esl-list-panel-title">녹음 목록</h3>
                        <p className="esl-list-panel-subtitle">{currentProject?.title || "프로젝트를 먼저 선택하세요."}</p>
                        <div className="esl-list">
                          {currentProject?.files.length ? (
                            currentProject.files.map((file) => {
                              const active = file.job_id === selectedJobId;
                              return (
                                <button
                                  key={file.job_id}
                                  type="button"
                                  onClick={() => selectFile(file.job_id)}
                                  disabled={loadingJob}
                                  className={`esl-list-item${active ? " is-active" : ""}`}
                                >
                                  <p className="truncate text-sm font-medium">{file.filename}</p>
                                  <p className="mt-1 text-[11px] text-[var(--esl-muted)]">마감 {formatKstDateTime(file.due_at)}</p>
                                  <p className="mt-1 text-[11px] text-[var(--esl-muted)]">배정 {formatKstDateTime(file.assigned_at)}</p>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {renderTranscriberInquiryBadge(file.transcriber_inquiry_status)}
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${fileStatusStyle(fileWorkflowStatus(file))}`}>
                                      {mapFileStatusLabel(fileWorkflowStatus(file))}
                                    </span>
                                  </div>
                                </button>
                              );
                            })
                          ) : (
                            <p className="esl-list-empty">
                              {currentProject ? "선택한 프로젝트에 파일이 없습니다." : "프로젝트 탭에서 사건을 선택하세요."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {workTab === "editor" ? (
                    <div className="esl-tab-panel" role="tabpanel">
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
                        {currentProject.client.name} · 마감 {formatKstDateTime(currentProject.due_at)} ·{" "}
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

                  {requestedRanges.length ? (
                    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-cyan-200">의뢰 구간</p>
                          <p className="mt-1 text-xs text-slate-400">
                            의뢰인이 선택한 구간입니다. 이 구간을 기준으로 녹취록을 작성하세요. PDF에는 이 구간만 반영됩니다.
                          </p>
                        </div>
                        <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                          {requestedRanges.length}개
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {requestedRanges.map((range, index) => (
                          <div
                            key={`${range.start_ms}-${range.end_ms}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-100">
                                구간 {index + 1}
                              </p>
                              <p className="mt-0.5 font-mono text-xs text-slate-300">
                                {formatSegmentTime(range.start_ms)} ~ {formatSegmentTime(range.end_ms)}
                                <span className="ml-2 text-slate-500">
                                  ({formatSegmentTime(Math.max(0, range.end_ms - range.start_ms))})
                                </span>
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => playRequestedRange(range.start_ms, range.end_ms)}
                              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                            >
                              재생
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

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
                    <p className="mb-2 text-xs text-slate-500">
                      빨간 글자는 AI가 인식을 어려워해 재검토가 필요한 구간입니다.
                    </p>
                    <p className="mb-2 text-xs text-slate-500">
                      노란 글자는 의뢰인이 업로드 시 선택한 구간 밖의 텍스트이며, PDF에는 선택 구간만 반영됩니다.
                    </p>
                    <div className="max-h-[min(62vh,640px)] space-y-2 overflow-y-auto pr-1">
                      {segments.length ? (
                        segments.map((segment, index) => {
                          const segmentWords = buildSegmentTimedWords(
                            segment.text,
                            segment,
                            index,
                            segments,
                            transcriptTokens,
                            selectedUploadSegments,
                          );
                          const hasActiveWord =
                            isAudioPlaying && segmentContainsActiveWord(segmentWords, playbackMs);

                          return (
                          <div
                            key={segment.id}
                            className={`rounded-xl border px-3 py-2.5 transition-colors ${
                              hasActiveWord
                                ? "esl-segment-active border-violet-300/70 bg-violet-400/10"
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
                              selectedSegments={selectedUploadSegments}
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
                      onClick={onDeliverPdf}
                      disabled={busy}
                      className="rounded-xl bg-slate-200 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-50"
                    >
                      {downloadingPdf ? "PDF 전달 중..." : "PDF 전달"}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(finalTranscriptPdfUrl(job.job_id), "_blank", "noopener,noreferrer")}
                      disabled={!job.final_pdf_ready}
                      className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      완성된 PDF 보기
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-sm text-slate-400 shadow-2xl shadow-black/20">
                파일 탭에서 녹음 파일을 선택하세요.
              </section>
            )}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </main>
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

        <ConfirmModal
          open={aiDraftConfirmOpen}
          title="AI 초벌"
          message="이미 초벌작업한 파일입니다."
          confirmLabel="확인"
          hideCancel
          onCancel={() => setAiDraftConfirmOpen(false)}
          onConfirm={() => setAiDraftConfirmOpen(false)}
        />
      </div>
    </div>
  );
}
