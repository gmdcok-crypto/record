import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createMemberProjectForProxyUpload,
  fetchMemberProjectsForProxyUpload,
  resolveMemberForProxyUpload,
  uploadVoiceForMember,
  type ProxyUploadMember,
  type ProxyUploadProject,
} from "./api";

const ACCEPT =
  ".wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4,.aac,.wma,audio/*,video/mp4,video/webm,video/quicktime";

type Props = {
  open: boolean;
  onClose: () => void;
  memberId?: number | null;
  memberName?: string | null;
  memberPhone?: string | null;
  onUploaded?: (result: { jobId: string; projectId: string | null; filename: string }) => void;
};

type FileProgress = {
  name: string;
  percent: number;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
  jobId?: string;
};

export default function AdminProxyUploadModal({
  open,
  onClose,
  memberId: initialMemberId,
  memberName,
  memberPhone,
  onUploaded,
}: Props) {
  const [member, setMember] = useState<ProxyUploadMember | null>(null);
  const [projects, setProjects] = useState<ProxyUploadProject[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [projectId, setProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [loadingMember, setLoadingMember] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const resetForm = useCallback(() => {
    setProjects([]);
    setProjectMode("new");
    setProjectId("");
    setNewProjectTitle(memberName?.trim() ? `${memberName.trim()} 녹취` : "");
    setFiles([]);
    setProgress([]);
    setUploading(false);
    setError(null);
    setDoneCount(0);
  }, [memberName]);

  const loadProjects = useCallback(async (id: number) => {
    const list = await fetchMemberProjectsForProxyUpload(id);
    setProjects(list);
    if (list.length > 0) {
      setProjectMode("existing");
      setProjectId(list[0]?.project_id ?? "");
    } else {
      setProjectMode("new");
      setProjectId("");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    resetForm();
    setMember(null);
    setLoadingMember(true);
    setError(null);

    void (async () => {
      try {
        if (initialMemberId) {
          const list = await fetchMemberProjectsForProxyUpload(initialMemberId);
          if (cancelled) return;
          setMember({
            id: initialMemberId,
            email: "",
            name: memberName || "",
            phone: memberPhone || null,
            is_active: true,
          });
          setProjects(list);
          if (list.length > 0) {
            setProjectMode("existing");
            setProjectId(list[0]?.project_id ?? "");
          }
          setNewProjectTitle(memberName?.trim() ? `${memberName.trim()} 녹취` : "");
          return;
        }

        if (!memberPhone) {
          setError("회원 또는 전화번호가 필요합니다.");
          return;
        }

        const resolved = await resolveMemberForProxyUpload({
          phone: memberPhone,
          name: memberName || undefined,
          ensure: true,
        });
        if (cancelled) return;
        setMember(resolved.member);
        setNewProjectTitle(
          (resolved.member.name || memberName || "").trim()
            ? `${(resolved.member.name || memberName || "").trim()} 녹취`
            : "",
        );
        await loadProjects(resolved.member.id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "회원 정보를 확인할 수 없습니다.");
        }
      } finally {
        if (!cancelled) setLoadingMember(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialMemberId, memberName, memberPhone, resetForm, loadProjects]);

  const canSubmit = useMemo(() => {
    if (!member || uploading || loadingMember || files.length === 0) return false;
    if (projectMode === "existing") return Boolean(projectId);
    return Boolean(newProjectTitle.trim());
  }, [member, uploading, loadingMember, files.length, projectMode, projectId, newProjectTitle]);

  const handleFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles(Array.from(list));
    setProgress([]);
    setDoneCount(0);
    setError(null);
  };

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

      const nextProgress: FileProgress[] = files.map((file) => ({
        name: file.name,
        percent: 0,
        status: "pending",
      }));
      setProgress(nextProgress);

      let success = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        setProgress((prev) =>
          prev.map((item, i) =>
            i === index ? { ...item, status: "uploading", percent: 0, message: undefined } : item,
          ),
        );
        try {
          const result = await uploadVoiceForMember(member.id, file, {
            projectId: resolvedProjectId,
            projectTitle,
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
            prev.map((item, i) =>
              i === index ? { ...item, status: "error", message } : item,
            ),
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">회원 대신 파일 업로드</h3>
            <p className="mt-1 text-sm text-slate-400">
              PWA 이용이 어려운 고객 대신 관리자가 녹취 파일을 등록합니다.
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

        {loadingMember ? (
          <p className="mt-4 text-sm text-slate-400">회원 정보를 확인하는 중…</p>
        ) : member ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm text-slate-200">
            <p className="font-medium text-white">{member.name || memberName || "회원"}</p>
            <p className="mt-1 text-slate-400">
              {member.phone || memberPhone || "—"} · ID {member.id}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">프로젝트</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!projects.length || uploading}
                onClick={() => setProjectMode("existing")}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  projectMode === "existing"
                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                기존 프로젝트
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => setProjectMode("new")}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  projectMode === "new"
                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                새 프로젝트
              </button>
            </div>
            {projectMode === "existing" ? (
              <select
                value={projectId}
                disabled={uploading || !projects.length}
                onChange={(event) => setProjectId(event.target.value)}
                className="mt-2 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
              >
                {projects.length === 0 ? <option value="">등록된 프로젝트 없음</option> : null}
                {projects.map((project) => (
                  <option key={project.project_id} value={project.project_id}>
                    {project.title}
                    {typeof project.file_count === "number" ? ` · 파일 ${project.file_count}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={newProjectTitle}
                disabled={uploading}
                onChange={(event) => setNewProjectTitle(event.target.value)}
                placeholder="프로젝트 제목"
                className="mt-2 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
              />
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">파일</p>
            <input
              type="file"
              multiple
              accept={ACCEPT}
              disabled={uploading || !member}
              onChange={(event) => handleFiles(event.target.files)}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100"
            />
            {files.length > 0 ? (
              <p className="mt-2 text-xs text-slate-400">{files.length}개 파일 선택됨</p>
            ) : null}
          </div>

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
