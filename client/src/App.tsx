import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  cancelClientJob,
  checkHealth,
  createProject,
  downloadTranscriptPdf,
  downloadFinalTranscriptPdf,
  fetchJob,
  fetchMemberMe,
  fetchProjects,
  fetchTranscriptChanges,
  bootstrapMemberTokenFromUrl,
  clearMemberSession,
  resolveUrl,
  saveTranscript,
  collectSpeakerIds,
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
import MemberLogin from "./MemberLogin";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";

type Step = "idle" | "uploading" | "ready" | "error";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type ClientTab = "upload" | "archive" | "edit";
type UploadProjectMode = "existing" | "new";
type EditableSegment = TranscriptSegment & { id: string };

const EDITABLE_JOB_STATUSES = new Set(["first_done", "client_editing"]);

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const GUEST_CLIENT_NAME = "의뢰인";
const INTRO_SIGNUP_URL =
  import.meta.env.VITE_INTRO_URL?.replace(/\/$/, "") || "https://record-voi.netlify.app";

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
      return "검토요망";
    case "client_editing":
      return "수정 중";
    case "review_waiting":
      return "재검수 요청";
    case "final_done":
    case "pdf_sent":
      return "완료";
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
  return EDITABLE_JOB_STATUSES.has(status);
}

function jobWorkflowStatus(job: { status?: string; workflow_status?: string } | null | undefined): string {
  return job?.workflow_status ?? job?.status ?? "";
}

function mapProjectStatus(status: string): string {
  switch (status) {
    case "waiting_assignment":
      return "배정 대기";
    case "working":
      return "작업 중";
    case "client_review":
      return "검토요망";
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
  };
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
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [changeHistoryRefresh, setChangeHistoryRefresh] = useState(0);
  const [jobIdInput, setJobIdInput] = useState("");
  const [archive, setArchive] = useState<JobArchiveItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [uploadProjectMode, setUploadProjectMode] = useState<UploadProjectMode>("new");
  const [selectedUploadProjectId, setSelectedUploadProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [editContext, setEditContext] = useState<{ projectTitle: string; filename: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<JobArchiveItem | null>(null);
  const [duplicateDialogMessage, setDuplicateDialogMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ClientTab>("archive");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [memberName, setMemberName] = useState<string | null>(null);
  const segmentEndRef = useRef<number | null>(null);

  const busy = step === "uploading" || loadingJob || saving || downloadingPdf;
  const pendingReviewCount = useMemo(() => {
    const fromProjects = projects.reduce(
      (count, project) =>
        count +
        (project.files?.filter((file) => (file.workflow_status ?? file.status) === "first_done").length ?? 0),
      0,
    );
    return fromProjects || archive.filter((item) => item.status === "first_done").length;
  }, [projects, archive]);
  const archivedFilenames = useMemo(
    () => new Set(archive.map((item) => normalizeUploadFilename(item.filename))),
    [archive],
  );
  const speakerIds = useMemo(() => collectSpeakerIds(segments), [segments]);
  const currentTranscript = useMemo(
    () => segmentsToTranscript(job?.transcript_json ?? null, segments, speakerLabels),
    [job, segments, speakerLabels],
  );
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

  const refreshWorkspace = async () => {
    try {
      const projectList = await fetchProjects(true);
      setProjects(projectList);
      const clientLabel = memberName || GUEST_CLIENT_NAME;
      const flatArchive = projectList.flatMap((project) =>
        (project.files ?? []).map((file) => projectFileToArchiveItem(file, clientLabel)),
      );
      setArchive(flatArchive);
      if (projectList.length > 0 && !selectedUploadProjectId) {
        setSelectedUploadProjectId(projectList[0].project_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "보관함을 불러오지 못했습니다.");
    }
  };

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? true;

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !(prev[projectId] ?? true) }));
  };

  const resolveEditContext = (jobId: string, projectList: ProjectSummary[]) => {
    for (const project of projectList) {
      const file = project.files?.find((item) => item.job_id === jobId);
      if (file) {
        return { projectTitle: project.title, filename: file.filename };
      }
    }
    return null;
  };

  const restoreSession = async () => {
    bootstrapMemberTokenFromUrl();
    const member = await fetchMemberMe();
    if (member) {
      setMemberName(member.name);
      setAuthStatus("authenticated");
      return member;
    }
    setMemberName(null);
    setAuthStatus("unauthenticated");
    return null;
  };

  const handleLoginSuccess = (member: MemberProfile) => {
    setMemberName(member.name);
    setAuthStatus("authenticated");
    setError("");
    void refreshWorkspace();
  };

  const handleLogout = () => {
    clearMemberSession();
    setMemberName(null);
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
    setMessage("");
    setError("");
    setActiveTab("archive");
    resetUploadUi();
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
    void restoreSession().then((member) => {
      if (member) void refreshWorkspace();
    });
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
    if (!uploadProjectReady) {
      setError(
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

  const loadJobById = async (jobId: string, options?: { switchToEdit?: boolean }) => {
    if (!jobId.trim()) return;
    setLoadingJob(true);
    setError("");
    setMessage("");
    try {
      const data = await fetchJob(jobId.trim());
      setJob(data);
      setJobIdInput(data.job_id);
      setSegments(buildEditableSegments(data.transcript_json));
      setSpeakerLabels(data.transcript_json?.speaker_labels ?? {});
      setStep("ready");
      const workflowStatus = jobWorkflowStatus(data);
      const shouldOpenEdit = options?.switchToEdit ?? isEditableArchiveStatus(workflowStatus);
      if (shouldOpenEdit) {
        setActiveTab("edit");
        setMessage(
          workflowStatus === "first_done"
            ? "검토요망 문서를 불러왔습니다. 내용을 검토하고 수정하세요."
            : "편집 문서를 불러왔습니다.",
        );
      } else if (workflowStatus === "assigned" || workflowStatus === "working") {
        setActiveTab("archive");
        setMessage("속기사가 초벌 작업 중입니다. 초벌 전달 후 편집 화면에서 확인할 수 있습니다.");
      } else {
        setMessage("작업을 불러왔습니다.");
      }
      const context = resolveEditContext(data.job_id, projects);
      setEditContext(context);
      await refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
    } finally {
      setLoadingJob(false);
    }
  };

  const openArchiveJob = (item: JobArchiveItem, projectTitle?: string) => {
    if (projectTitle) {
      setEditContext({ projectTitle, filename: item.filename });
    }
    void loadJobById(item.job_id, { switchToEdit: isEditableArchiveStatus(item.status) });
  };

  const performUpload = async (fileToUpload: File, projectId?: string) => {
    setStep("uploading");
    setProgress(0);
    setError("");
    try {
      await uploadVoice(fileToUpload, setProgress, undefined, projectId);
      setJob(null);
      setSegments([]);
      setSpeakerLabels({});
      await refreshWorkspace();
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
      let targetProjectId: string | undefined;
      let uploadedProjectTitle = uploadProjectLabel;
      if (uploadProjectMode === "existing") {
        if (!selectedUploadProjectId || !selectedUploadProject) {
          setError("업로드할 프로젝트를 선택해 주세요.");
          return;
        }
        targetProjectId = selectedUploadProjectId;
        uploadedProjectTitle = selectedUploadProject.title;
      } else {
        const title = newProjectTitle.trim();
        if (!title) {
          setError("프로젝트 이름을 먼저 입력해 주세요.");
          return;
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
        setMessage(`"${uploadedProjectTitle}" 업로드 중 ${index + 1}/${filesToUpload.length}: ${file.name}`);
        await performUpload(file, targetProjectId);
      }
      resetUploadUi(
        `"${uploadedProjectTitle}" 프로젝트에 ${filesToUpload.length}개 파일이 추가되었습니다. 관리자 배정 후 속기사가 녹취록을 작성합니다.`,
      );
      setActiveTab("archive");
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
      await saveTranscript(job.job_id, currentTranscript, "draft");
      await updateJobStatus(job.job_id, "client_editing", "의뢰인 수정본 저장");
      setJob({ ...job, transcript_json: currentTranscript, status: "client_editing" });
      setChangeHistoryRefresh((value) => value + 1);
      setMessage("의뢰인 수정본이 DB와 R2에 저장되었습니다.");
      await refreshWorkspace();
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
      await saveTranscript(job.job_id, currentTranscript, "review_request");
      await updateJobStatus(job.job_id, "review_waiting", "의뢰인 수정 후 속기사 재검수 요청");
      setJob({ ...job, transcript_json: currentTranscript, status: "review_waiting" });
      setChangeHistoryRefresh((value) => value + 1);
      setMessage("재검수 요청이 DB에 반영되었습니다.");
      await refreshWorkspace();
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
    setSpeakerLabels(job.transcript_json?.speaker_labels ?? {});
    setMessage("서버에 저장된 최신 문서로 되돌렸습니다.");
    setError("");
  };

  const applySpeakerLabels = (labels: Record<string, string>) => {
    const cleaned: Record<string, string> = {};
    for (const [id, name] of Object.entries(labels)) {
      if (name.trim()) cleaned[id] = name.trim();
    }
    setSpeakerLabels(cleaned);
    setSpeakerSettingsOpen(false);
    setMessage("화자 이름이 적용되었습니다. 저장하면 서버에 반영됩니다.");
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
        setSpeakerLabels({});
        setJobIdInput("");
        setStep("idle");
      }
      await refreshWorkspace();
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

  const tabs: { id: ClientTab; label: string; badge?: number }[] = [
    { id: "upload", label: "업로드" },
    { id: "archive", label: "보관함", badge: pendingReviewCount || undefined },
    { id: "edit", label: "편집", badge: pendingReviewCount || undefined },
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
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            로그아웃
          </button>
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
                  className={`relative rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-800 text-white shadow-inner shadow-black/20"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  {tab.label}
                  {tab.badge ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mb-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        ) : null}

        <main className="flex-1">
          {activeTab === "upload" ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
            <div className="mb-5">
              <p className="text-sm font-semibold text-blue-300">파일 업로드</p>
              <h2 className="mt-1 text-xl font-bold text-white">새 녹취 의뢰</h2>
              <p className="mt-2 text-sm text-slate-400">
                먼저 프로젝트(사건) 이름을 정하거나 기존 프로젝트를 선택한 뒤 파일을 올려 주세요.
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
                projects.length ? (
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
                    onChange={(event) => {
                      setNewProjectTitle(event.target.value);
                      if (error) setError("");
                    }}
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
                disabled={
                  !uploadProjectReady || !selectedFiles.length || busy || r2Ready === false || dbReady === false
                }
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {selectedFiles.length > 1 ? `${selectedFiles.length}개 파일 업로드` : "업로드"}
              </button>
            </div>
          </section>
          ) : null}

          {activeTab === "archive" ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
            <div className="mb-5">
              <p className="text-sm font-semibold text-emerald-300">보관함</p>
              <h2 className="mt-1 text-xl font-bold text-white">프로젝트 보관함</h2>
              <p className="mt-1 text-sm text-slate-400">
                프로젝트(사건)별로 묶여 있습니다. 검토요망 파일을 누르면 편집 탭으로 이동합니다.
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
              {projects.length ? (
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
                            {formatDateTime(project.due_at)}
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
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <p className="truncate text-sm font-semibold text-slate-100">{file.filename}</p>
                                    <p className="mt-1 truncate text-xs text-slate-500">{file.title}</p>
                                  </button>
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${archiveStatusStyle(fileStatus)}`}
                                  >
                                    {mapClientJobStatus(fileStatus)}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                                  <span className="font-mono">{file.job_id}</span>
                                  <div className="flex items-center gap-2">
                                    <span>{formatDateTime(file.uploaded_at)}</span>
                                    {file.status === "waiting_assignment" ? (
                                      <button
                                        type="button"
                                        onClick={() => setCancelTarget(item)}
                                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300"
                                      >
                                        취소
                                      </button>
                                    ) : null}
                                  </div>
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
          <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
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
                <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                  <div>작업 ID</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-100">{job.job_id}</div>
                </div>
              )}
            </div>

            {job && !isEditableArchiveStatus(jobWorkflowStatus(job)) ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-5 py-10 text-center text-sm text-slate-400">
                {jobWorkflowStatus(job) === "assigned" || jobWorkflowStatus(job) === "working" ? (
                  <>
                    속기사가 초벌 작업 중입니다.
                    <br />
                    초벌 전달 후 검토요망 상태가 되면 이 화면에서 검토·수정할 수 있습니다.
                  </>
                ) : (
                  <>현재 상태에서는 편집할 수 없습니다. 보관함에서 검토요망 파일을 선택해 주세요.</>
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
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-slate-300">
                      녹취 초안 / 의뢰인 수정본
                    </label>
                    <button
                      type="button"
                      onClick={() => setSpeakerSettingsOpen(true)}
                      disabled={!speakerIds.length || busy}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      화자 설정
                    </button>
                  </div>
                  <div className="space-y-2">
                    {segments.length ? (
                      segments.map((segment, index) => (
                        <div key={segment.id} className="rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2.5">
                          <div className="mb-1.5 flex min-w-0 items-center gap-2">
                            <select
                              value={segment.speaker}
                              onChange={(e) => updateSegment(index, { speaker: e.target.value })}
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
                          </div>
                          <textarea
                            value={segment.text}
                            rows={1}
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
                            className="w-full resize-none overflow-hidden rounded-lg border border-transparent bg-slate-900/60 px-3 py-2 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-slate-700 focus:border-blue-500 focus:bg-slate-900"
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

                <TranscriptChangeHistory
                  jobId={job.job_id}
                  refreshKey={changeHistoryRefresh}
                  loadEntries={fetchTranscriptChanges}
                />

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
                보관함에서 검토요망 항목을 선택하거나 작업번호로 문서를 불러오세요.
              </div>
            )}
          </section>
          ) : null}
        </main>

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

        <SpeakerSettingsModal
          open={speakerSettingsOpen}
          speakerIds={speakerIds}
          labels={speakerLabels}
          onClose={() => setSpeakerSettingsOpen(false)}
          onApply={applySpeakerLabels}
        />
      </div>
    </div>
  );
}
