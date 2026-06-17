import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkHealth,
  createAdminEventsSource,
  createProject,
  createClientJobInquiry,
  createTranscriptShare,
  downloadProjectFinalTranscriptPdf,
  downloadTranscriptPdf,
  downloadFinalTranscriptPdf,
  fetchClientFrontendVersion,
  fetchJob,
  fetchClientJobInquiries,
  fetchMemberMe,
  hasMemberSession,
  fetchProjects,
  MEMBER_TOKEN_KEY,
  fetchTranscriptChanges,
  bootstrapMemberTokenFromUrl,
  clearUrlQuery,
  clearMemberSession,
  readPortOnePaymentIdFromUrl,
  resolveUrl,
  saveTranscript,
  speakerLabel,
  updateJobStatus,
  uploadVoice,
  type JobArchiveItem,
  type JobResponse,
  type ProjectFile,
  type ProjectSummary,
  type TranscriptJson,
  type TranscriptSegment,
  type MemberProfile,
} from "./api";
import ActionNoticeModal, { type ActionNotice, type ActionNoticeKind } from "./ActionNoticeModal";
import MemberLogin from "./MemberLogin";
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
import UploadBillingPanel, { type BillingRestoreHint } from "./UploadBillingPanel";
import type { UploadBillingFile } from "./uploadBilling";
import {
  clearPendingUploadSnapshot,
  restorePendingUploadSnapshot,
  savePendingUploadSnapshot,
} from "./pendingUploadStore";
import {
  formatStepError,
  readPaymentReturnFlags,
  type PostPaymentStepId,
} from "./postPaymentFlow";
import SegmentPlaybackText from "./SegmentPlaybackText";
import { buildSegmentTimedWords, segmentContainsActiveWord } from "./playbackHighlight";
import {
  enableWebPush,
  getNotificationPermissionState,
  hasRegisteredPushSubscription,
  postActiveMemberToServiceWorker,
  syncWebPushRegistration,
} from "./webPush";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";

type Step = "idle" | "uploading" | "ready" | "error";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type ClientTab = "upload" | "archive" | "edit";
type UploadProjectMode = "existing" | "new";
type EditableSegment = TranscriptSegment & { id: string };
type PushPermissionState = NotificationPermission | "unsupported";
const FRONTEND_VERSION_POLL_MS = 60_000;

const EDITABLE_JOB_STATUSES = new Set(["first_done", "client_editing"]);

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const GUEST_CLIENT_NAME = "의뢰인";
const INTRO_SIGNUP_URL =
  import.meta.env.VITE_INTRO_URL?.replace(/\/$/, "") || "https://record-voi.netlify.app";
const PENDING_PORTONE_PAYMENT_KEY = "pending_portone_payment";
const AUTO_UPLOAD_TRIGGER_KEY = "auto_upload_after_payment";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function mapClientJobStatus(status: string): string {
  switch (status) {
    case "waiting_assignment":
    case "uploaded":
      return "배정 대기";
    case "assigned":
    case "working":
      return "작업 중";
    case "first_done":
      return "의뢰인 검토";
    case "client_editing":
      return "의뢰인 검토";
    case "review_waiting":
      return "녹취록 요청";
    case "transcriber_review":
      return "속기사검토";
    case "final_done":
      return "PDF 준비";
    case "pdf_sent":
      return "PDF 수령";
    case "cancelled":
      return "취소됨";
    default:
      return status;
  }
}

function archiveStatusStyle(status: string): string {
  switch (status) {
    case "first_done":
    case "review_waiting":
    case "transcriber_review":
      return "bg-violet-500/15 text-violet-300";
    case "client_editing":
      return "bg-cyan-500/15 text-cyan-300";
    case "final_done":
    case "pdf_sent":
      return "bg-emerald-500/15 text-emerald-300";
    case "assigned":
    case "working":
      return "bg-blue-500/15 text-blue-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function isEditableArchiveStatus(status: string): boolean {
  return EDITABLE_JOB_STATUSES.has(status) || status === "pdf_sent";
}

function jobWorkflowStatus(job: { status?: string; workflow_status?: string } | null | undefined): string {
  return job?.workflow_status ?? job?.status ?? "";
}

function isPdfReceivedStatus(status: string): boolean {
  return status === "pdf_sent";
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
    case "empty":
      return "파일 없음";
    default:
      return status;
  }
}

function projectStatusStyle(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300";
    case "client_review":
      return "bg-violet-500/15 text-violet-300";
    case "working":
      return "bg-blue-500/15 text-blue-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function projectFileToArchiveItem(file: ProjectFile, clientName: string): JobArchiveItem {
  return {
    job_id: file.job_id,
    title: file.title,
    filename: file.filename,
    status: file.workflow_status ?? file.status,
    updated_at: file.uploaded_at,
    client_name: clientName,
    pdf_ready: file.pdf_ready,
    has_inquiry: file.has_inquiry,
    client_inquiry_status: file.client_inquiry_status,
  };
}

function renderClientInquiryBadge(status?: "reply_pending" | "reply_arrived" | null) {
  if (status === "reply_pending") {
    return (
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
        답변 필요
      </span>
    );
  }
  if (status === "reply_arrived") {
    return (
      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200">
        답변 도착
      </span>
    );
  }
  return null;
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
  const inquiryPanelRef = useRef<HTMLDivElement | null>(null);
  const frontendVersionRef = useRef<string | null>(null);
  const frontendReloadingRef = useRef(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadBillingEntries, setUploadBillingEntries] = useState<UploadBillingFile[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [extraSpeakerIds, setExtraSpeakerIds] = useState<string[]>([]);
  const [addSegmentAfterIndex, setAddSegmentAfterIndex] = useState<number | null>(null);
  const [changeHistoryRefresh, setChangeHistoryRefresh] = useState(0);
  const [inquiryRefresh, setInquiryRefresh] = useState(0);
  const [archive, setArchive] = useState<JobArchiveItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [uploadProjectMode, setUploadProjectMode] = useState<UploadProjectMode>("new");
  const [selectedUploadProjectId, setSelectedUploadProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [editContext, setEditContext] = useState<{
    projectId?: string;
    projectTitle: string;
    filename: string;
    pdfDeliveryMode?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [submittingTranscriptRequest, setSubmittingTranscriptRequest] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [duplicateDialogMessage, setDuplicateDialogMessage] = useState("");
  const [uploadPaid, setUploadPaid] = useState(false);
  const [activeTab, setActiveTab] = useState<ClientTab>("upload");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [memberName, setMemberName] = useState<string | null>(null);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [pushPermission, setPushPermission] = useState<PushPermissionState>("default");
  const [pushRegistered, setPushRegistered] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const segmentEndRef = useRef<number | null>(null);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const autoUploadStartedRef = useRef(false);
  const paymentFlowHandledRef = useRef<string | null>(null);
  const [billingRestoreByKey, setBillingRestoreByKey] = useState<Record<string, BillingRestoreHint>>({});
  const restoredBillingEntriesRef = useRef<
    Array<{
      key: string;
      mode: "full" | "segments";
      segments: { id: string; fileId: string; start_ms: number; end_ms: number; selected: boolean }[];
      durationMs?: number | null;
    }>
  >([]);

  const showNotice = useCallback((kind: ActionNoticeKind, message: string, title?: string) => {
    setActionNotice({ kind, message, title });
  }, []);

  const showStepError = useCallback(
    (stepId: PostPaymentStepId, message: string, title?: string) => {
      showNotice("error", formatStepError(stepId, message), title ?? "업로드 실패");
    },
    [showNotice],
  );

  useEffect(() => {
    const title = "불판녹취";
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:site_name"]')?.setAttribute("content", title);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="application-name"]')?.setAttribute("content", title);
  }, []);

  const busy = step === "uploading" || loadingJob || saving || downloadingPdf || submittingReview || submittingTranscriptRequest;
  const autoUploadPending = window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) === "1";
  const archivedFilenames = useMemo(
    () => new Set(archive.map((item) => normalizeUploadFilename(item.filename))),
    [archive],
  );
  const speakerIds = useMemo(
    () => mergeSpeakerIds(segments, extraSpeakerIds),
    [segments, extraSpeakerIds],
  );
  const currentTranscript = useMemo(
    () => segmentsToTranscript(job?.transcript_json ?? null, segments, speakerLabels),
    [job, segments, speakerLabels],
  );
  const transcriptTokens = useMemo(() => job?.transcript_json?.tokens ?? [], [job?.transcript_json?.tokens]);
  const currentWorkflowStatus = useMemo(() => jobWorkflowStatus(job), [job]);
  const pdfReceived = useMemo(() => isPdfReceivedStatus(currentWorkflowStatus), [currentWorkflowStatus]);
  const selectedUploadSegments = useMemo(() => job?.selected_segments ?? [], [job?.selected_segments]);
  const currentTitle = useMemo(
    () => job?.title || job?.transcript_json.filename || selectedFiles[0]?.name || "새 녹취 작업",
    [job, selectedFiles],
  );
  const selectedUploadProject = useMemo(
    () => projects.find((project) => project.project_id === selectedUploadProjectId) ?? null,
    [projects, selectedUploadProjectId],
  );
  const uploadProjectReady = useMemo(() => {
    if (uploadProjectMode === "existing") {
      return selectedUploadProject !== null;
    }
    return newProjectTitle.trim().length > 0;
  }, [uploadProjectMode, selectedUploadProject, newProjectTitle]);
  const uploadProjectLabel = useMemo(() => {
    if (uploadProjectMode === "existing") {
      return selectedUploadProject?.title ?? "";
    }
    return newProjectTitle.trim();
  }, [uploadProjectMode, selectedUploadProject, newProjectTitle]);

  const refreshWorkspace = useCallback(async (showLoading = false, suppressError = false) => {
    if (showLoading) setLoadingWorkspace(true);
    try {
      const projectList = await fetchProjects(true);
      setProjects(projectList);
      const clientLabel = memberName || GUEST_CLIENT_NAME;
      const flatArchive = projectList.flatMap((project) =>
        (project.files ?? []).map((file) => projectFileToArchiveItem(file, clientLabel)),
      );
      setArchive(flatArchive);
      if (projectList.length > 0) {
        setSelectedUploadProjectId((current) => current || projectList[0].project_id);
      }
    } catch (err) {
      if (!suppressError) {
        showNotice("error", err instanceof Error ? err.message : "보관함을 불러오지 못했습니다.");
      }
      throw err;
    } finally {
      if (showLoading) setLoadingWorkspace(false);
    }
  }, [memberName, showNotice]);

  const refreshVisibleWorkspace = useCallback(() => {
    if (document.visibilityState === "visible" && authStatus === "authenticated") {
      void refreshWorkspace(false, true);
    }
  }, [authStatus, refreshWorkspace]);

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? true;

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !(prev[projectId] ?? true) }));
  };

  const resolveEditContext = (jobId: string, projectList: ProjectSummary[]) => {
    for (const project of projectList) {
      const file = project.files?.find((item) => item.job_id === jobId);
      if (file) {
        return {
          projectId: project.project_id,
          projectTitle: project.title,
          filename: file.filename,
          pdfDeliveryMode: project.pdf_delivery_mode,
        };
      }
    }
    return null;
  };

  const restoreSession = async () => {
    bootstrapMemberTokenFromUrl();
    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    const paymentReturn = readPaymentReturnFlags();
    if (!token) {
      if (paymentReturn.paymentId) {
        showNotice("error", "로그인 토큰이 없습니다. 다시 로그인해 주세요.");
      }
      setMemberName(null);
      setMemberProfile(null);
      setLoadingWorkspace(false);
      setAuthStatus("unauthenticated");
      return null;
    }

    const member = await fetchMemberMe();
    if (member) {
      setMemberName(member.name);
      setMemberProfile(member);
      setAuthStatus("authenticated");
      setActiveTab("upload");
      if (!paymentReturn.paymentId) {
        setLoadingWorkspace(true);
        window.setTimeout(() => {
          void refreshWorkspace(true);
        }, 0);
      }
      return member;
    }

    setAuthStatus("authenticated");
    setActiveTab("upload");
    if (!paymentReturn.paymentId) {
      setLoadingWorkspace(true);
      window.setTimeout(() => {
        void refreshWorkspace(true).finally(() => setLoadingWorkspace(false));
      }, 0);
    }
    return null;
  };

  const handleLoginSuccess = (member: MemberProfile) => {
    setMemberName(member.name);
    setMemberProfile(member);
    setLoadingWorkspace(true);
    setAuthStatus("authenticated");
    setActiveTab("upload");
    window.setTimeout(() => {
      void refreshWorkspace(true);
    }, 0);
  };

  const restorePendingUploadState = useCallback(async (): Promise<number> => {
    try {
      const snapshot = await restorePendingUploadSnapshot();
      if (!snapshot) return 0;
      restoredBillingEntriesRef.current = snapshot.billingEntries;
      setBillingRestoreByKey(
        Object.fromEntries(
          snapshot.billingEntries.map((entry) => [
            entry.key,
            {
              mode: entry.mode,
              segments: entry.segments,
              durationMs: entry.durationMs ?? null,
            },
          ]),
        ),
      );
      setUploadProjectMode(snapshot.uploadProjectMode);
      setSelectedUploadProjectId(snapshot.selectedUploadProjectId);
      setNewProjectTitle(snapshot.newProjectTitle);
      setSelectedFiles(snapshot.files);
      return snapshot.files.length;
    } catch {
      return 0;
    }
  }, []);

  const storePendingPayment = useCallback((payload: { paymentId: string; amount: number; orderName: string } | null) => {
    if (!payload) {
      window.localStorage.removeItem(PENDING_PORTONE_PAYMENT_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_PORTONE_PAYMENT_KEY, JSON.stringify(payload));
  }, []);

  const finalizePaymentReturn = useCallback(() => {
    storePendingPayment(null);
    if (readPortOnePaymentIdFromUrl()) {
      clearUrlQuery();
    }
    paymentFlowHandledRef.current = null;
  }, [storePendingPayment]);

  const persistPendingUpload = useCallback(async () => {
    if (!selectedFiles.length) return;
    await savePendingUploadSnapshot({
      files: selectedFiles,
      uploadProjectMode,
      selectedUploadProjectId,
      newProjectTitle,
      billingEntries: uploadBillingEntries.map((entry) => ({
        key: entry.key,
        mode: entry.mode,
        segments: entry.segments,
        durationMs: entry.durationMs,
      })),
      savedAt: Date.now(),
    });
  }, [newProjectTitle, selectedFiles, selectedUploadProjectId, uploadBillingEntries, uploadProjectMode]);

  const setAutoUploadPending = useCallback((pending: boolean) => {
    if (pending) {
      window.localStorage.setItem(AUTO_UPLOAD_TRIGGER_KEY, "1");
    } else {
      window.localStorage.removeItem(AUTO_UPLOAD_TRIGGER_KEY);
    }
  }, []);

  const queueAutoUpload = useCallback(() => {
    setUploadPaid(true);
    setAutoUploadPending(true);
  }, [setAutoUploadPending]);

  useEffect(() => {
    const paymentId = readPortOnePaymentIdFromUrl();
    if (!paymentId) return;
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated" && !hasMemberSession()) return;
    if (paymentFlowHandledRef.current === paymentId) return;
    paymentFlowHandledRef.current = paymentId;

    const finishPostPayment = async () => {
      queueAutoUpload();
      const restoredCount = await restorePendingUploadState();
      if (!restoredCount) {
        showStepError(
          "restore_files",
          "업로드할 파일 정보를 불러오지 못했습니다. 결제가 완료되었다면 같은 파일을 다시 선택해 업로드를 눌러 주세요.",
        );
      }
    };

    void finishPostPayment();
  }, [authStatus, queueAutoUpload, restorePendingUploadState, showStepError]);

  useEffect(() => {
    if (authStatus !== "authenticated" || selectedFiles.length > 0) return;
    if (window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) !== "1") return;
    void restorePendingUploadState().catch(() => undefined);
  }, [authStatus, restorePendingUploadState, selectedFiles.length]);

  useEffect(() => {
    const restored = restoredBillingEntriesRef.current;
    if (!restored.length || !uploadBillingEntries.length) return;
    const restoredMap = new Map(restored.map((entry) => [entry.key, entry]));
    const merged = uploadBillingEntries.map((entry) => {
      const saved = restoredMap.get(entry.key);
      if (!saved) return entry;
      return {
        ...entry,
        mode: saved.mode,
        segments: saved.segments,
        ...(saved.durationMs != null && entry.durationMs == null
          ? { durationMs: saved.durationMs, loading: false, error: "" }
          : {}),
      };
    });
    restoredBillingEntriesRef.current = [];
    setUploadBillingEntries(merged);
  }, [uploadBillingEntries]);

  const handleLogout = () => {
    clearMemberSession();
    setMemberName(null);
    setMemberProfile(null);
    setAuthStatus("unauthenticated");
    setProjects([]);
    setArchive([]);
    setSelectedUploadProjectId("");
    setNewProjectTitle("");
    setUploadProjectMode("new");
    setExpandedProjects({});
    setEditContext(null);
    setJob(null);
    setSegments([]);
    setSelectedFiles([]);
    setStep("idle");
    setUploadStatus("");
    setActionNotice(null);
    setActiveTab("upload");
    resetUploadUi();
  };

  const refreshPushPermission = useCallback(async () => {
    const permission = await getNotificationPermissionState();
    setPushPermission(permission);
    setPushRegistered(await hasRegisteredPushSubscription());
  }, []);

  const handleEnablePush = useCallback(async () => {
    if (!memberProfile) return;
    setEnablingPush(true);
    try {
      if (Notification.permission === "default") {
        showNotice("info", "브라우저 상단 또는 주소창 옆의 알림 허용 창을 확인해 주세요.");
      }
      const result = await enableWebPush(memberProfile);
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
  }, [memberProfile, showNotice]);

  useEffect(() => {
    checkHealth()
      .catch(() => undefined);
    void restoreSession();
    void refreshPushPermission();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkFrontendVersion = async () => {
      if (frontendReloadingRef.current || busy) return;
      if (window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) === "1") return;
      const nextVersion = await fetchClientFrontendVersion();
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
  }, [busy]);

  useEffect(() => {
    if (!memberProfile) return;
    void postActiveMemberToServiceWorker(memberProfile);
    void syncWebPushRegistration(memberProfile)
      .then((registered) => {
        if (registered) setPushRegistered(true);
      })
      .catch(() => {
        setPushRegistered(false);
      });
  }, [memberProfile]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "WEB_PUSH_NOTIFICATION_CLICK") return;
      const jobId = event.data?.payload?.jobId;
      if (typeof jobId === "string" && jobId.trim()) {
        void loadJobById(jobId, { switchToEdit: true });
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [projects]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    let alive = true;
    const eventSource = createAdminEventsSource();
    const handleAdminUpdate = () => {
      if (!alive) return;
      setInquiryRefresh((value) => value + 1);
      void refreshWorkspace(false, true);
    };

    eventSource.addEventListener("admin_update", handleAdminUpdate);
    eventSource.addEventListener("error", () => {
      console.error("client SSE connection error");
    });

    window.addEventListener("focus", refreshVisibleWorkspace);
    document.addEventListener("visibilitychange", refreshVisibleWorkspace);

    return () => {
      alive = false;
      eventSource.removeEventListener("admin_update", handleAdminUpdate);
      eventSource.close();
      window.removeEventListener("focus", refreshVisibleWorkspace);
      document.removeEventListener("visibilitychange", refreshVisibleWorkspace);
    };
  }, [authStatus, refreshVisibleWorkspace]);

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

  const resetUploadUi = (successMessage = "") => {
    setAutoUploadPending(false);
    autoUploadStartedRef.current = false;
    void clearPendingUploadSnapshot();
    setBillingRestoreByKey({});
    setSelectedFiles([]);
    setUploadPaid(false);
    setProgress(0);
    setStep("idle");
    setUploadStatus("");
    if (inputRef.current) inputRef.current.value = "";
    if (successMessage) {
      showNotice("success", successMessage);
    }
  };

  const removeSelectedFile = (file: File) => {
    setAutoUploadPending(false);
    void clearPendingUploadSnapshot();
    setSelectedFiles((prev) => prev.filter((item) => fileIdentity(item) !== fileIdentity(file)));
    setUploadPaid(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSelect = (files: FileList | null) => {
    if (!uploadProjectReady) {
      showNotice(
        "error",
        uploadProjectMode === "new"
          ? "프로젝트 이름을 먼저 입력한 뒤 파일을 선택해 주세요."
          : "업로드할 프로젝트를 먼저 선택해 주세요.",
      );
      return;
    }

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
    setAutoUploadPending(false);
    autoUploadStartedRef.current = false;
    setUploadPaid(false);
    setStep("idle");
    setProgress(0);
    setUploadStatus("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDropFiles = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    onSelect(event.dataTransfer.files);
  };

  const playSegment = (index: number, startMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;
    const endMs = resolveSegmentEndMs(segments, index);
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  const loadJobById = async (jobId: string, options?: { switchToEdit?: boolean }) => {
    if (!jobId.trim()) return;
    setLoadingJob(true);
    try {
      const data = await fetchJob(jobId.trim());
      setJob(data);
      const loadedSegments = buildEditableSegments(data.transcript_json);
      const loadedLabels = data.transcript_json?.speaker_labels ?? {};
      setSegments(loadedSegments);
      setSpeakerLabels(loadedLabels);
      setExtraSpeakerIds(deriveExtraSpeakerIds(loadedSegments, loadedLabels));
      setStep("ready");
      const workflowStatus = jobWorkflowStatus(data);
      const shouldOpenEdit = options?.switchToEdit ?? isEditableArchiveStatus(workflowStatus);
      if (shouldOpenEdit) {
        setActiveTab("edit");
      } else if (workflowStatus === "assigned" || workflowStatus === "working") {
        setActiveTab("archive");
        showNotice("info", "속기사가 작업 중입니다. 의뢰인 검토요청 후 편집 화면에서 확인할 수 있습니다.");
      } else if (workflowStatus === "transcriber_review") {
        setActiveTab("archive");
        showNotice("info", "속기사 검토 중입니다. 검토가 완료되면 PDF가 전달됩니다.");
      } else if (workflowStatus === "review_waiting") {
        setActiveTab("edit");
        showNotice("info", "녹취록 요청이 접수되었습니다. 속기사가 최종 확인 후 PDF를 전달합니다.");
      }
      const context = resolveEditContext(data.job_id, projects);
      setEditContext(context);
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
    } finally {
      setLoadingJob(false);
    }
  };

  const openArchiveJob = (item: JobArchiveItem, projectTitle?: string) => {
    const workflowStatus = item.workflow_status ?? item.status;
    if (workflowStatus === "transcriber_review") {
      showNotice("info", "속기사 검토 중입니다. 검토가 완료되면 PDF가 전달됩니다.");
      return;
    }
    if (workflowStatus === "assigned" || workflowStatus === "working") {
      showNotice("info", "속기사가 작업 중입니다. 의뢰인 검토 단계가 되면 편집 화면에서 확인할 수 있습니다.");
      return;
    }
    if (projectTitle) {
      const project = projects.find((entry) => entry.title === projectTitle && entry.files?.some((file) => file.job_id === item.job_id));
      setEditContext({
        projectId: project?.project_id,
        projectTitle,
        filename: item.filename,
        pdfDeliveryMode: project?.pdf_delivery_mode,
      });
    }
    const shouldOpenEdit =
      workflowStatus === "review_waiting" || isEditableArchiveStatus(workflowStatus);
    void loadJobById(item.job_id, { switchToEdit: shouldOpenEdit });
  };

  const performUpload = async (fileToUpload: File, projectId?: string, selectedSegments?: { start_ms: number; end_ms: number; selected?: boolean }[]) => {
    setStep("uploading");
    setProgress(0);
    try {
      const result = await uploadVoice(fileToUpload, setProgress, undefined, projectId, selectedSegments);
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      return result;
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : "업로드 실패";
      if (failureMessage.includes("이미 업로드된 파일입니다")) {
        openDuplicateDialog(failureMessage);
      } else {
        showNotice("error", formatStepError("upload_voice", failureMessage));
      }
      setStep("error");
      setUploadStatus("");
      throw err;
    }
  };

  const openDuplicateDialog = useCallback((nextMessage: string) => {
    resetUploadUi();
    setDuplicateDialogMessage(nextMessage);
  }, [resetUploadUi]);

  const closeDuplicateDialog = useCallback(() => {
    setDuplicateDialogMessage("");
  }, []);

  const onUpload = useCallback(async () => {
    if (!selectedFiles.length) return;
    if (readPortOnePaymentIdFromUrl() || window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) === "1") {
      finalizePaymentReturn();
    }
    const filesToUpload = [...selectedFiles];
    let uploadStarted = false;

    const duplicateFile = filesToUpload.find((file) => archivedFilenames.has(normalizeUploadFilename(file.name)));
    if (duplicateFile) {
      openDuplicateDialog(`이미 업로드된 파일입니다: ${duplicateFile.name}`);
      return;
    }

    try {
      let targetProjectId: string | undefined;
      let uploadedProjectTitle = uploadProjectLabel;
      const usedUploadMethods = new Set<string>();
      if (uploadProjectMode === "existing") {
        if (!selectedUploadProjectId) {
          showStepError("create_project", "업로드할 프로젝트를 선택해 주세요.");
          return;
        }
        targetProjectId = selectedUploadProjectId;
        uploadedProjectTitle = selectedUploadProject?.title || uploadProjectLabel || "프로젝트";
      } else {
        const title = newProjectTitle.trim();
        if (!title) {
          showStepError("create_project", "프로젝트 이름을 먼저 입력해 주세요.");
          return;
        }
        let created;
        try {
          created = await createProject(title);
        } catch (err) {
          const message = err instanceof Error ? err.message : "프로젝트 생성 실패";
          showStepError("create_project", message);
          return;
        }
        targetProjectId = created.project_id;
        uploadedProjectTitle = created.title;
        setSelectedUploadProjectId(created.project_id);
        setUploadProjectMode("existing");
        setNewProjectTitle("");
      }

      for (let index = 0; index < filesToUpload.length; index += 1) {
        uploadStarted = true;
        const file = filesToUpload[index];
        const billingEntry = uploadBillingEntries.find((entry) => entry.file === file || entry.key === fileIdentity(file));
        const selectedSegments =
          billingEntry?.mode === "segments"
            ? billingEntry.segments.filter((segment) => segment.selected).map((segment) => ({
                start_ms: segment.start_ms,
                end_ms: segment.end_ms,
                selected: segment.selected,
              }))
            : [];
        setStep("uploading");
        setUploadStatus(`"${uploadedProjectTitle}" 업로드 중 ${index + 1}/${filesToUpload.length}: ${file.name}`);
        let uploadResult;
        try {
          uploadResult = await performUpload(file, targetProjectId, selectedSegments);
        } catch {
          return;
        }
        if (uploadResult?.upload_method) {
          usedUploadMethods.add(uploadResult.upload_method);
        }
      }
      try {
        await refreshWorkspace();
      } catch (err) {
        const message = err instanceof Error ? err.message : "보관함 새로고침 실패";
        showNotice("info", formatStepError("refresh_workspace", `파일 업로드는 완료되었지만 보관함 새로고침은 잠시 후 다시 시도합니다.\n${message}`));
      }
      const uploadMethodLabel =
        usedUploadMethods.size === 0
          ? ""
          : usedUploadMethods.size === 1
            ? `\n업로드 방식: ${usedUploadMethods.has("direct") ? "직접 업로드" : "서버 경유 업로드"}`
            : "\n업로드 방식: 직접 업로드 + 서버 경유 업로드";
      resetUploadUi(
        `"${uploadedProjectTitle}" 프로젝트에 ${filesToUpload.length}개 파일이 추가되었습니다. 관리자 배정 후 속기사가 녹취록을 작성합니다.${uploadMethodLabel}`,
      );
      setActiveTab("archive");
    } catch (err) {
      if (!uploadStarted) {
        const failureMessage = err instanceof Error ? err.message : "업로드 준비 중 오류가 발생했습니다.";
        showNotice("error", failureMessage);
        setStep("error");
        setUploadStatus("");
      }
    }
  }, [
    archivedFilenames,
    createProject,
    fileIdentity,
    finalizePaymentReturn,
    newProjectTitle,
    openDuplicateDialog,
    performUpload,
    refreshWorkspace,
    resetUploadUi,
    selectedFiles,
    selectedUploadProject,
    selectedUploadProjectId,
    showNotice,
    showStepError,
    uploadBillingEntries,
    uploadProjectLabel,
    uploadProjectMode,
  ]);

  const handlePaymentConfirmed = useCallback(() => {
    if (autoUploadStartedRef.current) return;
    autoUploadStartedRef.current = true;
    setUploadPaid(true);
    void onUpload().finally(() => {
      setAutoUploadPending(false);
      autoUploadStartedRef.current = false;
    });
  }, [onUpload, setAutoUploadPending]);

  useEffect(() => {
    if (!uploadPaid || !selectedFiles.length || busy || autoUploadStartedRef.current) return;
    if (window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) !== "1") return;
    if (restoredBillingEntriesRef.current.length > 0 && uploadBillingEntries.length === 0) {
      return;
    }
    if (uploadProjectMode === "existing" && loadingWorkspace && !selectedUploadProjectId) {
      return;
    }
    autoUploadStartedRef.current = true;
    void onUpload().finally(() => {
      setAutoUploadPending(false);
      autoUploadStartedRef.current = false;
    });
  }, [
    busy,
    loadingWorkspace,
    onUpload,
    selectedFiles.length,
    selectedUploadProjectId,
    setAutoUploadPending,
    uploadBillingEntries.length,
    uploadPaid,
    uploadProjectMode,
  ]);

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setActionNotice(null);
    try {
      await saveTranscript(job.job_id, currentTranscript, "draft");
      await updateJobStatus(job.job_id, "client_editing", "의뢰인 수정본 저장");
      setJob({
        ...job,
        transcript_json: currentTranscript,
        status: "client_editing",
        workflow_status: "client_editing",
      });
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "의뢰인 수정본이 DB와 R2에 저장되었습니다.", "임시 저장 완료");
      await refreshWorkspace();
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "저장 실패", "임시 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSubmitTranscriptRequest = async () => {
    if (!job) return;
    setSubmittingTranscriptRequest(true);
    setSaving(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await saveTranscript(job.job_id, currentTranscript, "review_request");
      await updateJobStatus(job.job_id, "review_waiting", "의뢰인 녹취록 요청");
      setJob({
        ...job,
        transcript_json: currentTranscript,
        status: "review_waiting",
        workflow_status: "review_waiting",
      });
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "녹취록 요청이 접수되었습니다.");
      await refreshWorkspace();
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "녹취록 요청 실패");
    } finally {
      setSaving(false);
      setSubmittingTranscriptRequest(false);
    }
  };

  const onRequestTranscriberReview = async () => {
    if (!job) return;
    setSubmittingReview(true);
    setSaving(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await saveTranscript(job.job_id, currentTranscript, "review_request");
      await updateJobStatus(job.job_id, "transcriber_review", "의뢰인 검토요청");
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      setExtraSpeakerIds([]);
      setEditContext(null);
      setActiveTab("archive");
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "검토 요청이 접수되었습니다. 속기사가 확인 후 PDF를 전달합니다.");
      await refreshWorkspace();
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "검토 요청 실패");
    } finally {
      setSaving(false);
      setSubmittingReview(false);
    }
  };

  const onDownloadPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    try {
      if (job.final_pdf_ready) {
        if (editContext?.projectId && editContext?.pdfDeliveryMode === "bundle") {
          await downloadProjectFinalTranscriptPdf(editContext.projectId);
          showNotice("success", "저장된 프로젝트 통합 PDF를 다운로드했습니다.");
        } else {
          await downloadFinalTranscriptPdf(job.job_id);
          showNotice("success", "저장된 최종 PDF를 다운로드했습니다.");
        }
      } else {
        await downloadTranscriptPdf(job.job_id, currentTranscript);
        showNotice("success", "현재 문서 기준 PDF를 다운로드했습니다.");
      }
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const onCreateShareLink = async () => {
    if (!job) return;
    setCreatingShare(true);
    try {
      const shared = await createTranscriptShare(job.job_id);
      const copyText = `${shared.share_url}\n만료: ${formatKstDateTime(shared.expires_at)}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shared.share_url);
      }
      showNotice("success", `공유 링크를 복사했습니다.\n${copyText}`, "읽기 전용 공유 링크 생성");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "공유 링크 생성 실패", "공유 링크 생성 실패");
    } finally {
      setCreatingShare(false);
    }
  };

  const scrollToInquiryPanel = () => {
    inquiryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const tabs: { id: ClientTab; label: string }[] = [
    { id: "upload", label: "업로드" },
    { id: "archive", label: "보관함" },
    { id: "edit", label: "편집" },
  ];

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400">
        로그인 확인 중…
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return <MemberLogin signupUrl={INTRO_SIGNUP_URL} onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-6 pt-4 lg:max-w-4xl lg:px-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-300">의뢰인 녹취록</p>
            <h1 className="mt-1 text-2xl font-bold text-white">
              {memberName ? `${memberName}님` : GUEST_CLIENT_NAME}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(!pushRegistered || pushPermission !== "granted") ? (
              <button
                type="button"
                onClick={() => void handleEnablePush()}
                disabled={enablingPush}
                className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {enablingPush ? "알림 설정 중..." : "알림 받기"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              로그아웃
            </button>
          </div>
        </header>

        <nav className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="grid grid-cols-3 gap-1 py-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-800 text-white shadow-inner shadow-black/20"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="flex-1">
          {activeTab === "upload" ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
            <div className="mb-5">
              <p className="text-sm font-semibold text-blue-300">파일 업로드</p>
              <h2 className="mt-1 text-xl font-bold text-white">새 녹취 의뢰</h2>
              <p className="mt-2 text-sm text-slate-400">
                프로젝트를 정한 뒤 파일을 선택하고 파일별 업로드 구간을 설정할 수 있습니다.
              </p>
            </div>

            <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">업로드 프로젝트</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setUploadProjectMode("existing")}
                  disabled={!projects.length}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    uploadProjectMode === "existing"
                      ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/40"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200 disabled:opacity-40"
                  }`}
                >
                  기존 프로젝트
                </button>
                <button
                  type="button"
                  onClick={() => setUploadProjectMode("new")}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    uploadProjectMode === "new"
                      ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/40"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  새 프로젝트
                </button>
              </div>
              {uploadProjectMode === "existing" ? (
                loadingWorkspace && !projects.length ? (
                  <p className="mt-3 text-sm text-slate-400">프로젝트를 불러오는 중입니다.</p>
                ) : projects.length ? (
                  <select
                    value={selectedUploadProjectId}
                    onChange={(event) => setSelectedUploadProjectId(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                  >
                    {projects.map((project) => (
                      <option key={project.project_id} value={project.project_id}>
                        {project.title} ({project.file_count}개 파일)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">등록된 프로젝트가 없습니다. 새 프로젝트로 업로드하세요.</p>
                )
              ) : (
                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">
                    프로젝트 이름 <span className="text-rose-400">*</span>
                  </label>
                  <input
                    value={newProjectTitle}
                    onChange={(event) => setNewProjectTitle(event.target.value)}
                    placeholder="예: ○○사건 통화녹취"
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500/50"
                  />
                  {!newProjectTitle.trim() ? (
                    <p className="mt-2 text-xs text-amber-300/90">프로젝트 이름을 입력해야 파일을 선택할 수 있습니다.</p>
                  ) : null}
                </div>
              )}
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
                disabled={busy || !uploadProjectReady}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!uploadProjectReady) return;
                  setIsDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!uploadProjectReady) return;
                  setIsDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setIsDragActive(false);
                }}
                onDrop={onDropFiles}
                className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  !uploadProjectReady
                    ? "border-slate-800 bg-slate-950/40"
                    : isDragActive
                      ? "border-blue-400 bg-slate-900"
                      : "border-slate-700 bg-slate-950/80 hover:border-blue-400 hover:bg-slate-900"
                }`}
              >
                <span className="text-4xl">🎙️</span>
                <span className="mt-3 font-semibold text-slate-100">
                  {!uploadProjectReady
                    ? "프로젝트를 먼저 정해 주세요"
                    : selectedFiles.length > 0
                      ? `${selectedFiles.length}개 파일 선택됨`
                      : "음성/영상 파일 선택"}
                </span>
                <span className="mt-1 text-sm text-slate-400">
                  {!uploadProjectReady
                    ? uploadProjectMode === "new"
                      ? "위에 프로젝트 이름을 입력하면 파일 선택이 활성화됩니다."
                      : "위에서 기존 프로젝트를 선택하면 파일 선택이 활성화됩니다."
                    : selectedFiles.length > 0
                      ? `${selectedFiles[0].name}${selectedFiles.length > 1 ? ` 외 ${selectedFiles.length - 1}개` : ""} · 총 ${formatSize(
                          selectedFiles.reduce((sum, file) => sum + file.size, 0),
                        )}`
                      : `wav, mp3, m4a, mp4 등 지원 · 드래그 앤 드롭 가능${uploadProjectLabel ? ` · ${uploadProjectLabel}` : ""}`}
                </span>
              </button>

              {uploadStatus ? (
                <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                  {uploadStatus}
                </p>
              ) : null}

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

              {selectedFiles.length > 0 ? (
                <UploadBillingPanel
                  files={selectedFiles}
                  fileIdentity={fileIdentity}
                  formatSize={formatSize}
                  paid={uploadPaid}
                  uploading={step === "uploading"}
                  holdPaidState={autoUploadPending || uploadPaid}
                  billingRestoreByKey={billingRestoreByKey}
                  onPaidChange={setUploadPaid}
                  onPaymentConfirmed={handlePaymentConfirmed}
                  onRemoveFile={removeSelectedFile}
                  onEntriesChange={setUploadBillingEntries}
                  onPaymentPending={async (payload) => {
                    if (payload) {
                      try {
                        await persistPendingUpload();
                      } catch (err) {
                        const message = err instanceof Error ? err.message : "파일 저장 실패";
                        throw new Error(message);
                      }
                      storePendingPayment(payload);
                      return;
                    }
                    storePendingPayment(null);
                  }}
                />
              ) : null}
            </div>
          </section>
          ) : null}

          {activeTab === "archive" ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
            <div className="mb-5">
              <p className="text-sm font-semibold text-emerald-300">보관함</p>
              <h2 className="mt-1 text-xl font-bold text-white">프로젝트 보관함</h2>
              <p className="mt-1 text-sm text-slate-400">
                프로젝트(사건)별로 묶여 있습니다. 의뢰인 검토 파일을 누르면 편집 탭으로 이동합니다.
              </p>
            </div>

            <div className="space-y-3">
              {loadingWorkspace && !projects.length ? (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                  보관함을 불러오는 중입니다.
                </div>
              ) : projects.length ? (
                projects.map((project) => {
                  const expanded = isProjectExpanded(project.project_id);
                  const files = project.files ?? [];
                  return (
                    <div
                      key={project.project_id}
                      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60"
                    >
                      <button
                        type="button"
                        onClick={() => toggleProjectExpanded(project.project_id)}
                        className="flex w-full items-start justify-between gap-3 p-4 text-left transition hover:bg-slate-900"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-100">{project.title}</p>
                          <p className="mt-1 text-sm text-slate-400">
                            진행 {project.completed_count}/{project.file_count} · 마감{" "}
                            {formatKstDateTime(project.due_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${projectStatusStyle(project.status)}`}
                          >
                            {mapProjectStatus(project.status)}
                          </span>
                          <span className="text-slate-500">{expanded ? "▾" : "▸"}</span>
                        </div>
                      </button>
                      {expanded && files.length ? (
                        <div className="space-y-2 border-t border-slate-800 px-4 pb-4 pt-2">
                          {files.map((file) => {
                            const fileStatus = file.workflow_status ?? file.status;
                            const item = projectFileToArchiveItem(file, memberName || GUEST_CLIENT_NAME);
                            return (
                              <div
                                key={file.job_id}
                                className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 transition hover:border-blue-500/50"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openArchiveJob(item, project.title)}
                                    onDoubleClick={() => openArchiveJob(item, project.title)}
                                    disabled={loadingJob}
                                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <p className="truncate text-sm font-semibold text-slate-100">{file.filename}</p>
                                    <p className="mt-1 truncate text-xs text-slate-500">{file.title}</p>
                                  </button>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {renderClientInquiryBadge(file.client_inquiry_status)}
                                    <span
                                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${archiveStatusStyle(fileStatus)}`}
                                    >
                                      {mapClientJobStatus(fileStatus)}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                                  <span className="font-mono">{file.job_id}</span>
                                  <span>{formatKstDateTime(file.uploaded_at)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {expanded && !files.length ? (
                        <p className="border-t border-slate-800 px-4 py-3 text-sm text-slate-500">파일이 없습니다.</p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                  아직 프로젝트가 없습니다. 업로드 탭에서 파일을 올려 주세요.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void refreshWorkspace()}
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              보관함 새로고침
            </button>
          </section>
          ) : null}

          {activeTab === "edit" ? (
          <section className="relative rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
            {loadingJob ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/75 px-6 backdrop-blur-sm">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/95 px-6 py-5 text-center shadow-2xl shadow-black/30">
                  <p className="text-sm font-semibold text-white">작업을 불러오는 중입니다.</p>
                </div>
              </div>
            ) : null}
            {submittingTranscriptRequest ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/75 px-6 backdrop-blur-sm">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/95 px-6 py-5 text-center shadow-2xl shadow-black/30">
                  <p className="text-sm font-semibold text-white">녹취록 요청을 접수하는 중입니다.</p>
                </div>
              </div>
            ) : null}
            {submittingReview ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/75 px-6 backdrop-blur-sm">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/95 px-6 py-5 text-center shadow-2xl shadow-black/30">
                  <p className="text-sm font-semibold text-white">검토 요청을 접수하는 중입니다.</p>
                </div>
              </div>
            ) : null}
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-violet-300">편집</p>
                {editContext ? (
                  <p className="mt-1 text-sm text-cyan-300/90">
                    {editContext.projectTitle} &gt; {editContext.filename}
                  </p>
                ) : null}
                <h2 className="mt-1 text-xl font-bold text-white">{currentTitle}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  구간 텍스트를 누르면 해당 오디오가 재생되고, 같은 영역에서 바로 수정할 수 있습니다.
                </p>
              </div>
              {job && (
                <div className="flex flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={scrollToInquiryPanel}
                    className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                  >
                    문의하기
                  </button>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                    <div>작업 ID</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-100">{job.job_id}</div>
                  </div>
                </div>
              )}
            </div>

            {job && !isEditableArchiveStatus(currentWorkflowStatus) ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                {currentWorkflowStatus === "assigned" || currentWorkflowStatus === "working" ? (
                  <>
                    속기사가 초벌 작업 중입니다.
                    <br />
                    속기사가 의뢰인 검토요청을 보내면 이 화면에서 검토·수정할 수 있습니다.
                  </>
                ) : currentWorkflowStatus === "pdf_sent" ? (
                  <>
                    PDF가 전달된 문서입니다.
                    <br />
                    아래에서 내용을 확인하고 PDF를 다운로드할 수 있습니다.
                  </>
                ) : currentWorkflowStatus === "transcriber_review" ? (
                  <>
                    속기사 검토 중입니다.
                    <br />
                    검토가 완료되면 보관함에서 PDF 수령 상태로 확인할 수 있습니다.
                  </>
                ) : currentWorkflowStatus === "review_waiting" ? (
                  <>
                    녹취록 요청이 접수되었습니다.
                    <br />
                    속기사가 최종 확인 후 PDF를 전달합니다.
                  </>
                ) : (
                  <>현재 상태에서는 편집할 수 없습니다. 보관함에서 의뢰인 검토 파일을 선택해 주세요.</>
                )}
              </div>
            ) : job ? (
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
                    <label className="text-sm font-medium text-slate-300">
                      녹취 초안 / 의뢰인 수정본
                    </label>
                    <button
                      type="button"
                      onClick={() => setSpeakerSettingsOpen(true)}
                      disabled={busy || pdfReceived}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      화자 설정
                    </button>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    노란 글자는 업로드 시 선택한 구간 밖의 텍스트입니다. PDF에는 선택한 구간만 반영됩니다.
                  </p>
                  <div className="space-y-2">
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
                              ? "border-cyan-300/70 bg-cyan-400/10"
                              : "border-slate-700/80 bg-slate-950/80"
                          }`}
                        >
                          <div
                            role="button"
                            tabIndex={busy || pdfReceived || !speakerIds.length ? -1 : 0}
                            onClick={() => openAddSegmentAfter(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openAddSegmentAfter(index);
                              }
                            }}
                            title="클릭하여 이 대화 다음에 새 대화 추가"
                            className={`mb-1.5 flex w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 text-left transition ${
                              busy || pdfReceived || !speakerIds.length
                                ? "cursor-not-allowed opacity-50"
                                : "cursor-pointer hover:border-cyan-500/30 hover:bg-cyan-500/10"
                            }`}
                          >
                            <select
                              value={segment.speaker}
                              onClick={(event) => event.stopPropagation()}
                              onMouseDown={(event) => event.stopPropagation()}
                              onChange={(e) => updateSegment(index, { speaker: e.target.value })}
                              disabled={pdfReceived}
                              className="max-w-[9rem] shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 outline-none transition focus:border-blue-500"
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
                            <span className="ml-auto text-[10px] font-semibold text-cyan-400/80">+ 추가</span>
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
                            disabled={busy || pdfReceived}
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
                        수정할 대화 구간이 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                <TranscriptChangeHistory
                  jobId={job.job_id}
                  refreshKey={changeHistoryRefresh}
                  loadEntries={fetchTranscriptChanges}
                />

                <div ref={inquiryPanelRef}>
                  <ManagerInquiryPanel
                    jobId={job.job_id}
                    loadMessages={fetchClientJobInquiries}
                    sendMessage={createClientJobInquiry}
                    onError={(message) => showNotice("error", message)}
                    refreshKey={inquiryRefresh}
                  />
                </div>

                {(!pushRegistered || pushPermission !== "granted") ? (
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                    관리자 답변, PDF 전달, 상태 변경 알림을 받으려면 브라우저 알림을 허용해 주세요.
                  </div>
                ) : null}

                {pdfReceived ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    의뢰인에게 PDF가 전달된 상태입니다. 이 화면에서는 내용을 확인하고 PDF만 다운로드할 수 있습니다.
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={busy || pdfReceived}
                    className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={onSubmitTranscriptRequest}
                    disabled={busy || pdfReceived}
                    className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                  >
                    녹취록 요청
                  </button>
                  <button
                    type="button"
                    onClick={onRequestTranscriberReview}
                    disabled={busy || pdfReceived}
                    className="rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    검토요청
                  </button>
                  <button
                    type="button"
                    onClick={onCreateShareLink}
                    disabled={busy || creatingShare || pdfReceived}
                    className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    {creatingShare ? "링크 생성 중..." : "공유 링크 만들기"}
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
                보관함에서 의뢰인 검토 항목을 선택하거나 작업번호로 문서를 불러오세요.
              </div>
            )}
          </section>
          ) : null}
        </main>

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

        <ActionNoticeModal notice={actionNotice} onClose={() => setActionNotice(null)} />

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
      </div>
    </div>
  );
}
