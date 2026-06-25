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
  submitTranscriberReviewRequest,
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
import UnsavedChangesModal from "./UnsavedChangesModal";
import MemberLogin from "./MemberLogin";
import AddSegmentModal, { type AddSegmentDraft } from "./AddSegmentModal";
import ManagerInquiryPanel from "./ManagerInquiryPanel";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";
import { formatKstDateTime } from "./formatKstDateTime";
import {
  createManualSegmentId,
  deriveExtraSpeakerIds,
  formatSegmentTime,
  insertSegmentAfter,
  mergeSpeakerIds,
  nextSpeakerId,
  OMITTED_MARKER,
  segmentsToTranscript,
  serializeTranscriptSnapshot,
  toggleSegmentOmitted,
} from "./transcriptEditor";
import UploadBillingPanel, { type BillingRestoreHint } from "./UploadBillingPanel";
import type { UploadBillingFile } from "./uploadBilling";
import { fileBillableDurationMs } from "./uploadBilling";
import {
  clearPendingUploadSnapshot,
  restorePendingUploadSnapshot,
  savePendingUploadSnapshot,
} from "./pendingUploadStore";
import {
  clearStashedPaymentReturnFlags,
  formatStepError,
  resolvePaymentReturnFlags,
  shouldResumePostPaymentUpload,
  stashPaymentReturnFlags,
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
import { isMobileLikeClient } from "./uploadEnvironment";
import ClientBottomTabBar from "./ClientBottomTabBar";
import ClientShellHeader from "./ClientShellHeader";
import ClientTopTabNav, { type ClientTab } from "./ClientTopTabNav";

type Step = "idle" | "uploading" | "ready" | "error";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type UploadProjectMode = "existing" | "new";
type EditableSegment = TranscriptSegment & { id: string };
type PushPermissionState = NotificationPermission | "unsupported";
type PendingLeaveAction =
  | { type: "tab"; tab: ClientTab }
  | { type: "openJob"; item: JobArchiveItem; projectTitle?: string };
const FRONTEND_VERSION_POLL_MS = 60_000;

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const GUEST_CLIENT_NAME = "의뢰인";
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

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
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

function mapClientJobStatus(status: string): string {
  switch (normalizeWorkflowStatus(status)) {
    case "waiting_assignment":
      return "작업 중";
    case "working":
      return "작업 중";
    case "client_review":
      return "의뢰인 검토";
    case "transcriber_review":
      return "속기사검토";
    case "transcript_request":
      return "녹취록 요청";
    case "pdf_sent":
      return "제출문서 PDF 수령";
    default:
      return status;
  }
}

function archiveStatusStyle(status: string): string {
  switch (normalizeWorkflowStatus(status)) {
    case "client_review":
    case "transcriber_review":
    case "transcript_request":
      return "client-archive__status client-archive__status--review";
    case "pdf_sent":
      return "client-archive__status client-archive__status--done";
    case "working":
    case "waiting_assignment":
      return "client-archive__status client-archive__status--working";
    case "cancelled":
      return "client-archive__status client-archive__status--cancelled";
    default:
      return "client-archive__status client-archive__status--waiting";
  }
}

function isEditableArchiveStatus(status: string): boolean {
  const canonical = normalizeWorkflowStatus(status);
  return canonical === "client_review" || canonical === "pdf_sent";
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
      return "작업 중";
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
      return "client-archive__status client-archive__status--done";
    case "client_review":
      return "client-archive__status client-archive__status--review";
    case "working":
      return "client-archive__status client-archive__status--working";
    default:
      return "client-archive__status client-archive__status--waiting";
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

function projectFileWorkflowStatus(file: ProjectFile): string {
  return normalizeWorkflowStatus(file.workflow_status ?? file.status);
}

function filterProjectsForScope(projects: ProjectSummary[], scope: "active" | "completed"): ProjectSummary[] {
  return projects.flatMap((project) => {
    const files = (project.files ?? []).filter((file) => {
      const completed = isPdfReceivedStatus(projectFileWorkflowStatus(file));
      return scope === "completed" ? completed : !completed;
    });
    if (files.length === 0) return [];
    const completedCount = files.filter((file) => isPdfReceivedStatus(projectFileWorkflowStatus(file))).length;
    return [
      {
        ...project,
        files,
        file_count: files.length,
        completed_count: completedCount,
        status: completedCount === files.length ? "completed" : project.status,
      },
    ];
  });
}

function renderClientInquiryBadge(status?: "reply_pending" | "reply_arrived" | null) {
  if (status === "reply_pending") {
    return (
      <span className="client-archive__inquiry client-archive__inquiry--pending">
        답변 필요
      </span>
    );
  }
  if (status === "reply_arrived") {
    return (
      <span className="client-archive__inquiry client-archive__inquiry--arrived">
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
  const [savedTranscriptSnapshot, setSavedTranscriptSnapshot] = useState("");
  const [unsavedLeavePromptOpen, setUnsavedLeavePromptOpen] = useState(false);
  const [savingUnsavedLeave, setSavingUnsavedLeave] = useState(false);
  const pendingLeaveActionRef = useRef<PendingLeaveAction | null>(null);
  const [uploadPaid, setUploadPaid] = useState(false);
  const [activeTab, setActiveTab] = useState<ClientTab>("upload");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [memberName, setMemberName] = useState<string | null>(null);
  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [pushPermission, setPushPermission] = useState<PushPermissionState>("default");
  const [pushRegistered, setPushRegistered] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const segmentEndRef = useRef<number | null>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const historyFocusTimerRef = useRef<number | null>(null);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [historyFocusedSegment, setHistoryFocusedSegment] = useState<number | null>(null);
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
  const isEditDirty = useMemo(() => {
    if (!job || pdfReceived || !isEditableArchiveStatus(currentWorkflowStatus)) return false;
    return serializeTranscriptSnapshot(currentTranscript) !== savedTranscriptSnapshot;
  }, [job, pdfReceived, currentWorkflowStatus, currentTranscript, savedTranscriptSnapshot]);
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

  const activeProjects = useMemo(() => filterProjectsForScope(projects, "active"), [projects]);
  const completedProjects = useMemo(() => filterProjectsForScope(projects, "completed"), [projects]);

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
    stashPaymentReturnFlags();
    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    const paymentReturn = resolvePaymentReturnFlags();
    if (paymentReturn.paymentError) {
      showNotice("error", paymentReturn.paymentError);
      clearUrlQuery();
    }
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
    clearStashedPaymentReturnFlags();
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
        showNotice(
          "info",
          isMobileLikeClient()
            ? "화면에 나타나는 알림 허용 요청을 눌러 주세요."
            : "브라우저 상단 또는 주소창 옆의 알림 허용 창을 확인해 주세요.",
        );
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
          ? "의뢰 제목을 먼저 입력한 뒤 파일을 선택해 주세요."
          : "업로드할 의뢰를 먼저 선택해 주세요.",
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
      setSavedTranscriptSnapshot(
        serializeTranscriptSnapshot(segmentsToTranscript(data.transcript_json, loadedSegments, loadedLabels)),
      );
      setStep("ready");
      const workflowStatus = jobWorkflowStatus(data);
      const shouldOpenEdit = options?.switchToEdit ?? isEditableArchiveStatus(workflowStatus);
      if (shouldOpenEdit) {
        setActiveTab("edit");
      } else if (normalizeWorkflowStatus(workflowStatus) === "working") {
        setActiveTab("archive");
        showNotice("info", "속기사가 작업 중입니다. 의뢰인 검토요청 후 편집 화면에서 확인할 수 있습니다.");
      } else if (normalizeWorkflowStatus(workflowStatus) === "transcriber_review") {
        setActiveTab("archive");
        showNotice("info", "속기사 검토 중입니다. 검토가 완료되면 PDF가 전달됩니다.");
      } else if (normalizeWorkflowStatus(workflowStatus) === "transcript_request") {
        setActiveTab("archive");
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "WEB_PUSH_NOTIFICATION_RECEIVED") {
        const kind = event.data?.payload?.kind;
        if (kind === "pdf_delivery" || kind === "job_status") {
          void refreshWorkspace(false, true);
        }
        return;
      }
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
  }, [refreshWorkspace]);

  const revertUnsavedEdits = useCallback(() => {
    if (!job?.transcript_json) return;
    const loadedSegments = buildEditableSegments(job.transcript_json);
    const loadedLabels = job.transcript_json.speaker_labels ?? {};
    setSegments(loadedSegments);
    setSpeakerLabels(loadedLabels);
    setExtraSpeakerIds(deriveExtraSpeakerIds(loadedSegments, loadedLabels));
    setSavedTranscriptSnapshot(
      serializeTranscriptSnapshot(segmentsToTranscript(job.transcript_json, loadedSegments, loadedLabels)),
    );
  }, [job]);

  const performOpenArchiveJob = useCallback(
    (item: JobArchiveItem, projectTitle?: string) => {
      const workflowStatus = normalizeWorkflowStatus(item.workflow_status ?? item.status);
      if (workflowStatus === "transcriber_review") {
        showNotice("info", "속기사 검토 중입니다. 검토가 완료되면 PDF가 전달됩니다.");
        return;
      }
      if (workflowStatus === "transcript_request") {
        showNotice("info", "녹취록 요청이 접수되었습니다. 속기사가 최종 확인 후 PDF를 전달합니다.");
        return;
      }
      if (workflowStatus === "working") {
        showNotice("info", "속기사가 작업 중입니다. 의뢰인 검토 단계가 되면 편집 화면에서 확인할 수 있습니다.");
        return;
      }
      if (projectTitle) {
        const project = projects.find(
          (entry) => entry.title === projectTitle && entry.files?.some((file) => file.job_id === item.job_id),
        );
        setEditContext({
          projectId: project?.project_id,
          projectTitle,
          filename: item.filename,
          pdfDeliveryMode: project?.pdf_delivery_mode,
        });
      }
      const shouldOpenEdit = isEditableArchiveStatus(workflowStatus);
      void loadJobById(item.job_id, { switchToEdit: shouldOpenEdit });
    },
    [loadJobById, projects, showNotice],
  );

  const executePendingLeave = useCallback(
    (action: PendingLeaveAction) => {
      switch (action.type) {
        case "tab":
          setActiveTab(action.tab);
          break;
        case "openJob":
          performOpenArchiveJob(action.item, action.projectTitle);
          break;
        default:
          break;
      }
    },
    [performOpenArchiveJob],
  );

  const requestLeaveEdit = useCallback(
    (action: PendingLeaveAction) => {
      if (!isEditDirty) {
        executePendingLeave(action);
        return;
      }
      pendingLeaveActionRef.current = action;
      setUnsavedLeavePromptOpen(true);
    },
    [executePendingLeave, isEditDirty],
  );

  const handleTabChange = useCallback(
    (tab: ClientTab) => {
      if (tab === activeTab) return;
      if (activeTab === "edit" && isEditDirty) {
        requestLeaveEdit({ type: "tab", tab });
        return;
      }
      setActiveTab(tab);
    },
    [activeTab, isEditDirty, requestLeaveEdit],
  );

  const handleUnsavedLeaveCancel = useCallback(() => {
    pendingLeaveActionRef.current = null;
    setUnsavedLeavePromptOpen(false);
  }, []);

  const handleUnsavedLeaveDiscard = useCallback(() => {
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    setUnsavedLeavePromptOpen(false);
    revertUnsavedEdits();
    if (action) executePendingLeave(action);
  }, [executePendingLeave, revertUnsavedEdits]);

  const handleUnsavedLeaveSave = useCallback(async () => {
    if (!job) return;
    setSavingUnsavedLeave(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "draft");
      const nextTranscript = currentTranscript;
      setJob({
        ...job,
        transcript_json: nextTranscript,
        status: "client_review",
        workflow_status: "client_review",
      });
      setSavedTranscriptSnapshot(serializeTranscriptSnapshot(nextTranscript));
      setChangeHistoryRefresh((value) => value + 1);
      await refreshWorkspace();
      const action = pendingLeaveActionRef.current;
      pendingLeaveActionRef.current = null;
      setUnsavedLeavePromptOpen(false);
      if (action) executePendingLeave(action);
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "저장 실패", "임시 저장 실패");
    } finally {
      setSavingUnsavedLeave(false);
    }
  }, [job, currentTranscript, executePendingLeave, refreshWorkspace, showNotice]);

  useEffect(() => {
    if (!isEditDirty || activeTab !== "edit") return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeTab, isEditDirty]);

  const openArchiveJob = useCallback(
    (item: JobArchiveItem, projectTitle?: string) => {
      if (job && isEditDirty && item.job_id !== job.job_id) {
        requestLeaveEdit({ type: "openJob", item, projectTitle });
        return;
      }
      performOpenArchiveJob(item, projectTitle);
    },
    [isEditDirty, job, performOpenArchiveJob, requestLeaveEdit],
  );

  const performUpload = async (
    fileToUpload: File,
    projectId?: string,
    selectedSegments?: { start_ms: number; end_ms: number; selected?: boolean }[],
    billableDurationMs?: number,
  ) => {
    setStep("uploading");
    setProgress(0);
    try {
      const result = await uploadVoice(
        fileToUpload,
        setProgress,
        undefined,
        projectId,
        selectedSegments,
        billableDurationMs,
      );
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

  const uploadSelectedFilesToProject = useCallback(async () => {
    if (!selectedFiles.length) {
      throw new Error("업로드할 파일이 없습니다.");
    }

    const filesToUpload = [...selectedFiles];
    const duplicateFile = filesToUpload.find((file) => archivedFilenames.has(normalizeUploadFilename(file.name)));
    if (duplicateFile) {
      throw new Error(`이미 업로드된 파일입니다: ${duplicateFile.name}`);
    }

    let targetProjectId: string | undefined;
    let uploadedProjectTitle = uploadProjectLabel;

    if (uploadProjectMode === "existing") {
      if (!selectedUploadProjectId) {
        throw new Error("업로드할 프로젝트를 선택해 주세요.");
      }
      targetProjectId = selectedUploadProjectId;
      uploadedProjectTitle = selectedUploadProject?.title || uploadProjectLabel || "프로젝트";
    } else {
      const title = newProjectTitle.trim();
      if (!title) {
        throw new Error("프로젝트 이름을 먼저 입력해 주세요.");
      }
      const created = await createProject(title);
      targetProjectId = created.project_id;
      uploadedProjectTitle = created.title;
      setSelectedUploadProjectId(created.project_id);
      setUploadProjectMode("existing");
      setNewProjectTitle("");
    }

    for (let index = 0; index < filesToUpload.length; index += 1) {
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
      const billableDurationMs = billingEntry ? fileBillableDurationMs(billingEntry) : undefined;
      setStep("uploading");
      setUploadStatus(`"${uploadedProjectTitle}" 업로드 중 ${index + 1}/${filesToUpload.length}: ${file.name}`);
      await performUpload(file, targetProjectId, selectedSegments, billableDurationMs);
    }

    return {
      projectTitle: uploadedProjectTitle,
      fileCount: filesToUpload.length,
    };
  }, [
    archivedFilenames,
    createProject,
    fileIdentity,
    newProjectTitle,
    performUpload,
    selectedFiles,
    selectedUploadProject,
    selectedUploadProjectId,
    uploadBillingEntries,
    uploadProjectLabel,
    uploadProjectMode,
  ]);

  const completeSuccessfulUpload = useCallback(
    async (result: { projectTitle: string; fileCount: number }) => {
      try {
        await refreshWorkspace();
      } catch (err) {
        const message = err instanceof Error ? err.message : "보관함 새로고침 실패";
        showNotice(
          "info",
          formatStepError(
            "refresh_workspace",
            `파일 업로드는 완료되었지만 보관함 새로고침은 잠시 후 다시 시도합니다.\n${message}`,
          ),
        );
      }
      resetUploadUi(
        `"${result.projectTitle}" 프로젝트에 ${result.fileCount}개 파일이 추가되었습니다. 파일 확인 후 문의 사항 있으면 연락드리겠습니다.`,
      );
      setActiveTab("archive");
    },
    [refreshWorkspace, resetUploadUi, showNotice],
  );

  const onUpload = useCallback(async () => {
    if (!selectedFiles.length) return;
    const shouldFinalizePaymentReturn =
      readPortOnePaymentIdFromUrl() != null ||
      window.localStorage.getItem(AUTO_UPLOAD_TRIGGER_KEY) === "1";

    try {
      const result = await uploadSelectedFilesToProject();
      if (shouldFinalizePaymentReturn) {
        finalizePaymentReturn();
      }
      await completeSuccessfulUpload(result);
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : "업로드 준비 중 오류가 발생했습니다.";
      if (failureMessage.includes("이미 업로드된 파일입니다")) {
        openDuplicateDialog(failureMessage);
        return;
      }
      showStepError("upload_voice", failureMessage);
      setStep("error");
      setUploadStatus("");
    }
  }, [
    completeSuccessfulUpload,
    finalizePaymentReturn,
    openDuplicateDialog,
    selectedFiles.length,
    showStepError,
    uploadSelectedFilesToProject,
  ]);

  useEffect(() => {
    const paymentReturn = resolvePaymentReturnFlags();
    const paymentId = paymentReturn.paymentId;
    if (!paymentId) return;
    if (paymentReturn.paymentError) {
      finalizePaymentReturn();
      return;
    }
    if (!shouldResumePostPaymentUpload(paymentReturn)) return;
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated" && !hasMemberSession()) return;
    if (paymentFlowHandledRef.current === paymentId) return;
    paymentFlowHandledRef.current = paymentId;

    const finishPostPayment = async () => {
      queueAutoUpload();
      const retryDelaysMs = [0, 400, 1000, 2000];
      let restoredCount = 0;
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
        restoredCount = await restorePendingUploadState();
        if (restoredCount > 0) break;
      }
      if (!restoredCount) {
        const standalone =
          typeof window !== "undefined" &&
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
        const hint = isMobileLikeClient() && !standalone
          ? "\n홈 화면에 추가한 불판녹취 앱으로 다시 열어 주세요."
          : "";
        showStepError(
          "restore_files",
          `업로드할 파일 정보를 불러오지 못했습니다. 결제가 완료되었다면 같은 파일을 다시 선택해 업로드를 눌러 주세요.${hint}`,
        );
        setAutoUploadPending(false);
        paymentFlowHandledRef.current = null;
      }
    };

    void finishPostPayment();
  }, [
    authStatus,
    finalizePaymentReturn,
    queueAutoUpload,
    restorePendingUploadState,
    setAutoUploadPending,
    showStepError,
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
    uploadPaid,
    uploadProjectMode,
  ]);

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setActionNotice(null);
    try {
      await saveTranscript(job.job_id, currentTranscript, "draft");
      const nextTranscript = currentTranscript;
      setJob({
        ...job,
        transcript_json: nextTranscript,
        status: "client_review",
        workflow_status: "client_review",
      });
      setSavedTranscriptSnapshot(serializeTranscriptSnapshot(nextTranscript));
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "", "저장완료");
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
      await saveTranscript(job.job_id, currentTranscript, "draft");
      await updateJobStatus(job.job_id, "transcript_request", "의뢰인 녹취록 요청");
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      setExtraSpeakerIds([]);
      setEditContext(null);
      setActiveTab("archive");
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
    try {
      await submitTranscriberReviewRequest(job.job_id);
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      setExtraSpeakerIds([]);
      setEditContext(null);
      setActiveTab("archive");
      showNotice("success", "검토 요청이 접수되었습니다. 속기사가 확인 후 PDF를 전달합니다.");
      await refreshWorkspace();
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "검토 요청 실패");
    } finally {
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

  const focusSegmentFromHistory = useCallback(
    (index: number) => {
      if (index < 0 || index >= segments.length) {
        showNotice(
          "info",
          `구간 ${index + 1}은(는) 현재 문서에서 찾을 수 없습니다. 구간이 추가·삭제되었을 수 있습니다.`,
        );
        return;
      }
      setHistoryFocusedSegment(index);
      segmentRefs.current.get(index)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (historyFocusTimerRef.current != null) {
        window.clearTimeout(historyFocusTimerRef.current);
      }
      historyFocusTimerRef.current = window.setTimeout(() => {
        setHistoryFocusedSegment(null);
        historyFocusTimerRef.current = null;
      }, 4000);
    },
    [segments.length, showNotice],
  );

  useEffect(() => {
    return () => {
      if (historyFocusTimerRef.current != null) {
        window.clearTimeout(historyFocusTimerRef.current);
      }
    };
  }, []);

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

  const toggleSegmentOmit = (index: number) => {
    setSegments((prev) => toggleSegmentOmitted(prev, index));
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
    { id: "archive", label: "진행중인 의뢰" },
    { id: "edit", label: "녹취수정" },
    { id: "completed", label: "완료된 의뢰" },
  ];

  const renderProjectWorkspace = (
    list: ProjectSummary[],
    meta: {
      eyebrow?: string;
      title: string;
      desc: string;
      emptyMessage: string;
    },
  ) => (
    <section className="bp-card client-archive__page-card">
      <div className="client-archive__heading">
        {meta.eyebrow ? <p className="client-archive__eyebrow">{meta.eyebrow}</p> : null}
        <h2 className="client-archive__title">{meta.title}</h2>
        <p className="client-archive__desc">{meta.desc}</p>
      </div>

      <div className="space-y-3">
        {loadingWorkspace && !projects.length ? (
          <div className="client-archive__empty">목록을 불러오는 중입니다.</div>
        ) : list.length ? (
          list.map((project) => {
            const expanded = isProjectExpanded(project.project_id);
            const files = project.files ?? [];
            return (
              <div key={project.project_id} className="client-archive__project">
                <button
                  type="button"
                  onClick={() => toggleProjectExpanded(project.project_id)}
                  className="client-archive__project-toggle"
                >
                  <div className="min-w-0">
                    <p className="client-archive__project-title">{project.title}</p>
                    <p className="client-archive__project-meta">
                      진행 {project.completed_count}/{project.file_count} · 마감{" "}
                      {formatKstDateTime(project.due_at)}
                    </p>
                  </div>
                  <div className="client-archive__project-actions">
                    <span className={projectStatusStyle(project.status)}>
                      {mapProjectStatus(project.status)}
                    </span>
                    <span className="client-archive__chevron" aria-hidden="true">
                      {expanded ? "▾" : "▸"}
                    </span>
                  </div>
                </button>
                {expanded && files.length ? (
                  <div className="client-archive__files">
                    {files.map((file) => {
                      const fileStatus = file.workflow_status ?? file.status;
                      const item = projectFileToArchiveItem(file, memberName || GUEST_CLIENT_NAME);
                      return (
                        <div key={file.job_id} className="client-archive__file">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => openArchiveJob(item, project.title)}
                              onDoubleClick={() => openArchiveJob(item, project.title)}
                              disabled={loadingJob}
                              className="client-archive__file-open"
                            >
                              <p className="client-archive__file-name">{file.filename}</p>
                              <p className="client-archive__file-title">{file.title}</p>
                            </button>
                            <div className="client-archive__file-badges">
                              {renderClientInquiryBadge(file.client_inquiry_status)}
                              <span className={archiveStatusStyle(fileStatus)}>
                                {mapClientJobStatus(fileStatus)}
                              </span>
                            </div>
                          </div>
                          <div className="client-archive__file-footer">
                            <span className="client-archive__file-id">{file.job_id}</span>
                            <span>{formatKstDateTime(file.uploaded_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {expanded && !files.length ? (
                  <p className="client-archive__no-files">파일이 없습니다.</p>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="client-archive__empty">{meta.emptyMessage}</div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void refreshWorkspace()}
        className="bp-button bp-button-outline client-archive__refresh"
      >
        목록 새로고침
      </button>
    </section>
  );

  if (authStatus === "loading") {
    return <div className="client-loading">로그인 확인 중…</div>;
  }

  if (authStatus === "unauthenticated") {
    return <MemberLogin onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="client-app client-shell min-h-dvh">
      <div className="client-shell__inner mx-auto flex min-h-dvh w-full flex-col px-4 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] pt-4 lg:px-6 lg:pb-6">
        <ClientShellHeader
          memberName={memberName}
          guestLabel={GUEST_CLIENT_NAME}
          enablingPush={enablingPush}
          showPushButton={!pushRegistered || pushPermission !== "granted"}
          onEnablePush={() => void handleEnablePush()}
          onLogout={handleLogout}
        />

        <ClientTopTabNav tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

        <main className="flex-1">
          {activeTab === "upload" ? (
          <section className="bp-card client-upload__page-card">
            <div className="client-upload__heading">
              <p className="client-upload__eyebrow">파일 업로드</p>
              <h2 className="client-upload__title">녹취의뢰</h2>
              <p className="client-upload__desc">
                파일을 선택하고 파일별 업로드 구간을 설정할 수 있습니다.
              </p>
            </div>

            <div className="bp-section-box client-upload__project-box">
              <p className="client-upload__section-label">업로드 녹취</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setUploadProjectMode("existing")}
                  disabled={!projects.length}
                  className={`client-upload__project-toggle ${
                    uploadProjectMode === "existing" ? "is-active" : ""
                  }`}
                >
                  기존의뢰 파일 추가
                </button>
                <button
                  type="button"
                  onClick={() => setUploadProjectMode("new")}
                  className={`client-upload__project-toggle ${
                    uploadProjectMode === "new" ? "is-active" : ""
                  }`}
                >
                  새 의뢰
                </button>
              </div>
              {uploadProjectMode === "existing" ? (
                loadingWorkspace && !projects.length ? (
                  <p className="client-upload__field-hint">프로젝트를 불러오는 중입니다.</p>
                ) : projects.length ? (
                  <select
                    value={selectedUploadProjectId}
                    onChange={(event) => setSelectedUploadProjectId(event.target.value)}
                    className="bp-control-input mt-3"
                  >
                    {projects.map((project) => (
                      <option key={project.project_id} value={project.project_id}>
                        {project.title} ({project.file_count}개 파일)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="client-upload__field-hint">등록된 의뢰가 없습니다. 새 의뢰로 업로드하세요.</p>
                )
              ) : (
                <div className="mt-3">
                  <label className="client-upload__field-label">
                    의뢰제목 <span className="text-[var(--bp-save-text)]">*</span>
                  </label>
                  <input
                    value={newProjectTitle}
                    onChange={(event) => setNewProjectTitle(event.target.value)}
                    placeholder="예: ○○사건 통화녹취"
                    required
                    className="bp-control-input"
                  />
                  {!newProjectTitle.trim() ? (
                    <p className="client-upload__field-hint text-amber-700">의뢰 제목을 입력해야 파일을 선택할 수 있습니다.</p>
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
                className={`client-upload__dropzone ${isDragActive ? "is-drag-active" : ""}`}
              >
                <span className="text-4xl" aria-hidden="true">
                  🎙️
                </span>
                <span className="client-upload__dropzone-title">
                  {!uploadProjectReady
                    ? "파일을 먼저 선택해주세요"
                    : selectedFiles.length > 0
                      ? `${selectedFiles.length}개 파일 선택됨`
                      : "음성/영상 파일 선택"}
                </span>
                <span className="client-upload__dropzone-desc">
                  {!uploadProjectReady
                    ? uploadProjectMode === "new"
                      ? "위에 의뢰 제목을 입력하면 파일 선택이 활성화됩니다."
                      : "위에서 기존 의뢰를 선택하면 파일 선택이 활성화됩니다."
                    : selectedFiles.length > 0
                      ? `${selectedFiles[0].name}${selectedFiles.length > 1 ? ` 외 ${selectedFiles.length - 1}개` : ""} · 총 ${formatSize(
                          selectedFiles.reduce((sum, file) => sum + file.size, 0),
                        )}`
                      : `wav, mp3, m4a, mp4 등 지원 · 드래그 앤 드롭 가능${uploadProjectLabel ? ` · ${uploadProjectLabel}` : ""}`}
                </span>
              </button>

              {uploadStatus ? <p className="client-upload__status">{uploadStatus}</p> : null}

              {step === "uploading" && (
                <div>
                  <div className="mb-1 flex justify-between text-sm text-[var(--bp-body)]">
                    <span>업로드 중...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="client-upload__progress-track">
                    <div className="client-upload__progress-bar" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {selectedFiles.length > 0 ? (
                <UploadBillingPanel
                  files={selectedFiles}
                  fileIdentity={fileIdentity}
                  formatSize={formatSize}
                  projectTitle={uploadProjectLabel}
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

          {activeTab === "archive"
            ? renderProjectWorkspace(activeProjects, {
                eyebrow: "진행중인 의뢰",
                title: "진행 중인 프로젝트",
                desc: "프로젝트(사건)별로 묶여 있습니다. 의뢰인 검토 파일을 누르면 녹취수정 탭으로 이동합니다.",
                emptyMessage: "진행 중인 의뢰가 없습니다. 업로드 탭에서 파일을 올려 주세요.",
              })
            : null}

          {activeTab === "completed"
            ? renderProjectWorkspace(completedProjects, {
                title: "완료된 의뢰",
                desc: "PDF 수령이 완료된 의뢰입니다. 파일을 누르면 내용을 확인하고 PDF를 다운로드할 수 있습니다.",
                emptyMessage: "완료된 의뢰가 없습니다.",
              })
            : null}

          {activeTab === "edit" ? (
          <section className="bp-card client-edit__page-card">
            {loadingJob ? (
              <div className="client-edit__overlay">
                <div className="client-edit__overlay-card">
                  <p className="client-edit__overlay-text">작업을 불러오는 중입니다.</p>
                </div>
              </div>
            ) : null}
            {submittingTranscriptRequest ? (
              <div className="client-edit__overlay">
                <div className="client-edit__overlay-card">
                  <p className="client-edit__overlay-text">녹취록 요청을 접수하는 중입니다.</p>
                </div>
              </div>
            ) : null}
            {submittingReview ? (
              <div className="client-edit__overlay">
                <div className="client-edit__overlay-card">
                  <p className="client-edit__overlay-text">검토 요청을 접수하는 중입니다.</p>
                </div>
              </div>
            ) : null}
            <div className="client-edit__heading">
              <div>
                <p className="client-edit__eyebrow">편집</p>
                {editContext ? (
                  <p className="client-edit__breadcrumb">
                    {editContext.projectTitle} &gt; {editContext.filename}
                  </p>
                ) : null}
                <h2 className="client-edit__title">{currentTitle}</h2>
                <p className="client-edit__desc">
                  구간 텍스트를 누르면 해당 오디오가 재생되고, 같은 영역에서 바로 수정할 수 있습니다.
                </p>
              </div>
              {job && (
                <div className="client-edit__aside">
                  <button
                    type="button"
                    onClick={scrollToInquiryPanel}
                    className="bp-button bp-button-soft"
                  >
                    문의하기
                  </button>
                  <div className="client-edit__job-id">
                    <div>작업 ID</div>
                    <div className="client-edit__job-id-value">{job.job_id}</div>
                  </div>
                </div>
              )}
            </div>

            {job && !isEditableArchiveStatus(currentWorkflowStatus) ? (
              <div className="client-edit__empty">
                {normalizeWorkflowStatus(currentWorkflowStatus) === "working" ? (
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
                ) : currentWorkflowStatus === "transcriber_review" || normalizeWorkflowStatus(currentWorkflowStatus) === "transcriber_review" ? (
                  <>
                    속기사 검토 중입니다.
                    <br />
                    검토가 완료되면 보관함에서 PDF 수령 상태로 확인할 수 있습니다.
                  </>
                ) : normalizeWorkflowStatus(currentWorkflowStatus) === "transcript_request" ? (
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
                <div className="client-edit__guide-box">
                  <div className="client-edit__guide-col">
                    <h4 className="client-edit__guide-title">
                      <span className="client-edit__guide-icon" aria-hidden="true">
                        ⓘ
                      </span>
                      검토 안내
                    </h4>
                    <ul className="client-edit__guide-list">
                      <li>한 번 클릭하면 해당 구간의 음성을 바로 들을 수 있습니다.</li>
                      <li>두 번 클릭하면 내용을 수정할 수 있습니다.</li>
                    </ul>
                  </div>
                  <div className="client-edit__guide-col">
                    <h4 className="client-edit__guide-title">
                      <span className="client-edit__guide-icon" aria-hidden="true">
                        🎧
                      </span>
                      문의 사항 안내
                    </h4>
                    <ul className="client-edit__guide-list">
                      <li>하단 페이지 해당 녹취록 관련 문의에 남겨주시면 확인 후 답변드립니다</li>
                      <li>해당 녹취록과 관련된 음성 파일에 대해서만 남겨주세요</li>
                    </ul>
                  </div>
                </div>

                <div>
                  <label className="client-edit__section-label">원본 음성</label>
                  <audio
                    ref={audioRef}
                    controls
                    preload="metadata"
                    src={resolveUrl(job.audio_url)}
                    className="w-full rounded-xl"
                  />
                </div>

                <div>
                  <div className="client-edit__section-head">
                    <label className="client-edit__section-label">녹취 초안 / 의뢰인 수정본</label>
                    <button
                      type="button"
                      onClick={() => setSpeakerSettingsOpen(true)}
                      disabled={busy || pdfReceived}
                      className="bp-button bp-button-outline bp-button-compact"
                    >
                      화자 설정
                    </button>
                  </div>
                  <p className="client-edit__hint">
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
                        const toolbarDisabled = busy || pdfReceived || !speakerIds.length;

                        return (
                        <div
                          key={segment.id}
                          ref={(element) => {
                            if (element) segmentRefs.current.set(index, element);
                            else segmentRefs.current.delete(index);
                          }}
                          className={`client-edit__segment ${
                            segment.omitted
                              ? "is-omitted"
                              : hasActiveWord
                              ? "is-active"
                              : ""
                          }${historyFocusedSegment === index ? " is-history-focus" : ""}`}
                        >
                          <div
                            role="button"
                            tabIndex={toolbarDisabled ? -1 : 0}
                            onClick={() => openAddSegmentAfter(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openAddSegmentAfter(index);
                              }
                            }}
                            title="클릭하여 이 대화 다음에 새 대화 추가"
                            className={`client-edit__segment-toolbar ${
                              toolbarDisabled ? "is-disabled" : "is-clickable"
                            }`}
                          >
                            <select
                              value={segment.speaker}
                              onClick={(event) => event.stopPropagation()}
                              onMouseDown={(event) => event.stopPropagation()}
                              onChange={(e) => updateSegment(index, { speaker: e.target.value })}
                              disabled={pdfReceived || Boolean(segment.omitted)}
                              className="client-edit__speaker-select disabled:opacity-60"
                            >
                              {speakerIds.map((id) => (
                                <option key={id} value={id}>
                                  {speakerLabel(id, speakerLabels)}
                                </option>
                              ))}
                            </select>
                            <span className="client-edit__segment-time">
                              {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSegmentOmit(index);
                              }}
                              disabled={busy || pdfReceived}
                              className="bp-btn-inline bp-btn-inline--outline client-edit__segment-omit disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {segment.omitted ? "복구" : "구간삭제"}
                            </button>
                            {!segment.omitted ? (
                              <span className="client-edit__segment-add">+ 추가</span>
                            ) : null}
                          </div>
                          {segment.omitted ? (
                            <p className="client-edit__segment-omitted-text">
                              {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}{" "}
                              {OMITTED_MARKER}
                            </p>
                          ) : (
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
                          )}
                        </div>
                        );
                      })
                    ) : (
                      <div className="client-edit__empty">수정할 대화 구간이 없습니다.</div>
                    )}
                  </div>
                </div>

                <TranscriptChangeHistory
                  jobId={job.job_id}
                  refreshKey={changeHistoryRefresh}
                  loadEntries={fetchTranscriptChanges}
                  onSegmentFocus={focusSegmentFromHistory}
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
                  <div className="client-edit__notice client-edit__notice--accent">
                    관리자 답변, PDF 전달, 상태 변경 알림을 받으려면 브라우저 알림을 허용해 주세요.
                  </div>
                ) : null}

                {pdfReceived ? (
                  <div className="client-edit__notice client-edit__notice--success">
                    의뢰인에게 PDF가 전달된 상태입니다. 이 화면에서는 내용을 확인하고 PDF만 다운로드할 수 있습니다.
                  </div>
                ) : null}

                <div className="client-edit__actions">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={busy || pdfReceived}
                    className="bp-button bp-button-save"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={onSubmitTranscriptRequest}
                    disabled={busy || pdfReceived}
                    className="bp-button bp-button-transcript"
                  >
                    녹취록 요청
                  </button>
                  <button
                    type="button"
                    onClick={onRequestTranscriberReview}
                    disabled={busy || pdfReceived}
                    className="bp-button bp-button-review"
                  >
                    검토요청
                  </button>
                  <button
                    type="button"
                    onClick={onCreateShareLink}
                    disabled={busy || creatingShare || pdfReceived}
                    className="bp-button bp-button-share"
                  >
                    {creatingShare ? "링크 생성 중..." : "공유 링크 만들기"}
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadPdf}
                    disabled={busy}
                    className="bp-button bp-button-pdf"
                  >
                    PDF 다운로드
                  </button>
                </div>
              </div>
            ) : (
              <div className="client-edit__empty">
                보관함에서 의뢰인 검토 항목을 선택하거나 작업번호로 문서를 불러오세요.
              </div>
            )}
          </section>
          ) : null}
        </main>

        {duplicateDialogMessage ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-page/75 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-shell border border-line bg-white p-5 shadow-strong">
              <h3 className="text-lg font-semibold text-brand-navy">중복 업로드 안내</h3>
              <p className="mt-3 text-sm leading-6 text-brand-navy">{duplicateDialogMessage}</p>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeDuplicateDialog}
                  className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-orange-dark"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <UnsavedChangesModal
          open={unsavedLeavePromptOpen}
          saving={savingUnsavedLeave}
          onSave={() => void handleUnsavedLeaveSave()}
          onDiscard={handleUnsavedLeaveDiscard}
          onCancel={handleUnsavedLeaveCancel}
        />

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

      <ClientBottomTabBar activeTab={activeTab} onChange={handleTabChange} />
    </div>
  );
}
