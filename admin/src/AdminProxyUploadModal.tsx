import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminUploadScopePanel from "./AdminUploadScopePanel";
import {
  createMemberProjectForProxyUpload,
  fetchMemberProjectsForProxyUpload,
  uploadVoiceForMember,
  type ProxyUploadProject,
  type SelectedUploadSegment,
} from "./api";
import { fileBillableDurationMs, isUploadBillingReady, type UploadBillingFile } from "./uploadBilling";

const ACCEPT =
  ".wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4,.aac,.wma,audio/*,video/mp4,video/webm,video/quicktime";

export type ProxyUploadCandidate = {
  id: number;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  member: ProxyUploadCandidate | null;
  onUploaded?: (result: { jobId: string; projectId: string | null; filename: string }) => void;
};

type FileProgress = {
  name: string;
  percent: number;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
  jobId?: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIdentity(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function selectedSegmentsForEntry(entry: UploadBillingFile): SelectedUploadSegment[] {
  if (entry.mode !== "segments") return [];
  return entry.segments
    .filter((segment) => segment.selected)
    .map((segment) => ({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      selected: true,
    }));
}

export default function AdminProxyUploadModal({ open, onClose, member, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProxyUploadProject[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [projectId, setProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [billingEntries, setBillingEntries] = useState<UploadBillingFile[]>([]);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const projectReady = useMemo(() => {
    if (projectMode === "existing") return Boolean(projectId);
    return Boolean(newProjectTitle.trim());
  }, [projectMode, projectId, newProjectTitle]);

  const projectLabel = useMemo(() => {
    if (projectMode === "existing") {
      return projects.find((project) => project.project_id === projectId)?.title || "기존 의뢰";
    }
    return newProjectTitle.trim() || "새 의뢰";
  }, [projectMode, projects, projectId, newProjectTitle]);

  const billingReady = useMemo(() => isUploadBillingReady(billingEntries), [billingEntries]);

  const loadProjects = useCallback(async (memberId: number, memberName: string) => {
    setLoadingProjects(true);
    setError(null);
    try {
      const list = await fetchMemberProjectsForProxyUpload(memberId);
      setProjects(list);
      setNewProjectTitle(memberName.trim() ? `${memberName.trim()} 녹취` : "");
      if (list.length > 0) {
        setProjectMode("existing");
        setProjectId(list[0]?.project_id ?? "");
      } else {
        setProjectMode("new");
        setProjectId("");
      }
    } catch (err) {
      setProjects([]);
      setError(err instanceof Error ? err.message : "프로젝트 목록을 불러올 수 없습니다.");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !member) return;
    setSelectedFiles([]);
    setBillingEntries([]);
    setProgress([]);
    setUploading(false);
    setIsDragActive(false);
    setError(null);
    setDoneCount(0);
    setProjects([]);
    setProjectId("");
    setProjectMode("new");
    setNewProjectTitle(member.name.trim() ? `${member.name.trim()} 녹취` : "");
    void loadProjects(member.id, member.name);
  }, [open, member, loadProjects]);

  const appendFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setSelectedFiles((prev) => {
      const keys = new Set(prev.map(fileIdentity));
      const next = [...prev];
      for (const file of incoming) {
        const key = fileIdentity(file);
        if (keys.has(key)) continue;
        keys.add(key);
        next.push(file);
      }
      return next;
    });
    setProgress([]);
    setDoneCount(0);
    setError(null);
  };

  const removeFile = (file: File) => {
    const key = fileIdentity(file);
    setSelectedFiles((prev) => prev.filter((item) => fileIdentity(item) !== key));
    setProgress([]);
    setDoneCount(0);
  };

  const canSubmit = useMemo(() => {
    if (!member || !member.isActive || uploading || loadingProjects) return false;
    if (!projectReady || selectedFiles.length === 0) return false;
    return billingReady;
  }, [member, uploading, loadingProjects, projectReady, selectedFiles.length, billingReady]);

  const handleUpload = async () => {
    if (!member || !canSubmit) return;
    setUploading(true);
    setError(null);
    setDoneCount(0);

    let resolvedProjectId = projectMode === "existing" ? projectId : null;
    let projectTitle = projectMode === "new" ? newProjectTitle.trim() : null;

    try {
      if (projectMode === "new") {
        const created = await createMemberProjectForProxyUpload(member.id, newProjectTitle.trim());
        resolvedProjectId = created.project_id;
        projectTitle = null;
        setProjects((prev) => [created, ...prev]);
        setProjectMode("existing");
        setProjectId(created.project_id);
      }

      const entriesByKey = new Map(billingEntries.map((entry) => [entry.key, entry]));
      setProgress(
        selectedFiles.map((file) => ({
          name: file.name,
          percent: 0,
          status: "pending",
        })),
      );

      let success = 0;
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index]!;
        const entry = entriesByKey.get(fileIdentity(file));
        const selectedSegments = entry ? selectedSegmentsForEntry(entry) : [];
        const billableDurationMs = entry ? fileBillableDurationMs(entry) : undefined;

        setProgress((prev) =>
          prev.map((item, i) =>
            i === index ? { ...item, status: "uploading", percent: 0, message: undefined } : item,
          ),
        );
        try {
          const result = await uploadVoiceForMember(member.id, file, {
            projectId: resolvedProjectId,
            projectTitle,
            selectedSegments,
            billableDurationMs,
            onProgress: (percent) => {
              setProgress((prev) =>
                prev.map((item, i) => (i === index ? { ...item, percent } : item)),
              );
            },
          });
          success += 1;
          setDoneCount(success);
          setProgress((prev) =>
            prev.map((item, i) =>
              i === index
                ? { ...item, status: "done", percent: 100, jobId: result.job_id, message: result.job_id }
                : item,
            ),
          );
          onUploaded?.({
            jobId: result.job_id,
            projectId: result.project_id ?? resolvedProjectId,
            filename: file.name,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "업로드 실패";
          setProgress((prev) =>
            prev.map((item, i) => (i === index ? { ...item, status: "error", message } : item)),
          );
        }
      }

      if (success === 0) {
        setError("업로드에 실패했습니다. 파일명 중복 여부를 확인해 주세요.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 준비에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  if (!open || !member) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">파일 업로드</p>
            <h3 className="mt-1 text-lg font-semibold text-white">대신 업로드 · 녹취의뢰</h3>
            <p className="mt-1 text-sm text-slate-400">
              의뢰인 PWA와 같이 파일을 선택하고 업로드 구간을 설정합니다. (결제 없음)
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            onClick={onClose}
            disabled={uploading}
          >
            닫기
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm text-slate-200">
          <p className="font-medium text-white">{member.name || "회원"}</p>
          <p className="mt-1 text-slate-400">
            {member.phone || member.email || "—"} · ID {member.id}
            {!member.isActive ? " · 비활성" : ""}
          </p>
        </div>

        {!member.isActive ? (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            비활성 회원에는 파일을 업로드할 수 없습니다.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">업로드 녹취</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!projects.length || uploading || !member.isActive}
                onClick={() => setProjectMode("existing")}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  projectMode === "existing"
                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                기존의뢰 파일 추가
              </button>
              <button
                type="button"
                disabled={uploading || !member.isActive}
                onClick={() => setProjectMode("new")}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  projectMode === "new"
                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                새 의뢰
              </button>
            </div>
            {loadingProjects ? (
              <p className="mt-2 text-sm text-slate-400">프로젝트를 불러오는 중입니다.</p>
            ) : projectMode === "existing" ? (
              projects.length ? (
                <select
                  value={projectId}
                  disabled={uploading}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="mt-3 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
                >
                  {projects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.title}
                      {typeof project.file_count === "number" ? ` (${project.file_count}개 파일)` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 text-sm text-slate-400">등록된 의뢰가 없습니다. 새 의뢰로 업로드하세요.</p>
              )
            ) : (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-slate-400">
                  의뢰제목 <span className="text-cyan-300">*</span>
                </label>
                <input
                  value={newProjectTitle}
                  disabled={uploading}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  placeholder="예: ○○사건 통화녹취"
                  className="min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
                />
                {!newProjectTitle.trim() ? (
                  <p className="mt-1 text-xs text-amber-300">의뢰 제목을 입력해야 파일을 선택할 수 있습니다.</p>
                ) : null}
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              appendFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <button
            type="button"
            disabled={uploading || !member.isActive || !projectReady}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!projectReady || !member.isActive) return;
              setIsDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!projectReady || !member.isActive) return;
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setIsDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              if (!projectReady || !member.isActive || uploading) return;
              appendFiles(event.dataTransfer.files);
            }}
            className={`w-full rounded-2xl border border-dashed px-4 py-8 text-center transition ${
              isDragActive
                ? "border-cyan-400 bg-cyan-500/10"
                : "border-slate-600 bg-slate-950/40 hover:border-slate-500"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <p className="text-sm font-semibold text-slate-100">
              {!projectReady
                ? "의뢰를 먼저 선택하거나 제목을 입력하세요"
                : selectedFiles.length > 0
                  ? `${selectedFiles.length}개 파일 선택됨`
                  : "파일을 선택하거나 여기에 놓으세요"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {!projectReady
                ? projectMode === "new"
                  ? "의뢰 제목 입력 후 파일을 선택할 수 있습니다."
                  : "기존 의뢰를 선택해 주세요."
                : selectedFiles.length > 0
                  ? `${selectedFiles[0]?.name}${selectedFiles.length > 1 ? ` 외 ${selectedFiles.length - 1}개` : ""} · 총 ${formatSize(
                      selectedFiles.reduce((sum, file) => sum + file.size, 0),
                    )} · ${projectLabel}`
                  : `wav, mp3, m4a, mp4 등 지원 · 드래그 앤 드롭 가능 · ${projectLabel}`}
            </p>
          </button>

          {selectedFiles.length > 0 ? (
            <AdminUploadScopePanel
              files={selectedFiles}
              fileIdentity={fileIdentity}
              formatSize={formatSize}
              uploading={uploading}
              onRemoveFile={removeFile}
              onEntriesChange={setBillingEntries}
            />
          ) : null}

          {progress.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              {progress.map((item) => (
                <div key={`${item.name}-${item.jobId ?? item.status}`} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-200">{item.name}</span>
                    <span
                      className={
                        item.status === "done"
                          ? "text-emerald-300"
                          : item.status === "error"
                            ? "text-rose-300"
                            : "text-slate-400"
                      }
                    >
                      {item.status === "done"
                        ? "완료"
                        : item.status === "error"
                          ? "실패"
                          : item.status === "uploading"
                            ? `${item.percent}%`
                            : "대기"}
                    </span>
                  </div>
                  {item.status === "uploading" || item.status === "done" ? (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all"
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  ) : null}
                  {item.message && item.status === "error" ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-rose-300">{item.message}</p>
                  ) : null}
                </div>
              ))}
              {doneCount > 0 ? (
                <p className="pt-1 text-xs text-emerald-300">{doneCount}건 업로드 완료 · 의뢰 현황에서 확인하세요.</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={onClose}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              {doneCount > 0 ? "닫기" : "취소"}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleUpload()}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? "업로드 중…" : "업로드"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
