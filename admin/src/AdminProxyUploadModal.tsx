import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createMemberProjectForProxyUpload,
  fetchMemberProjectsForProxyUpload,
  uploadVoiceForMember,
  type ProxyUploadProject,
} from "./api";

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
  members: ProxyUploadCandidate[];
  initialMemberId?: number | null;
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
  members,
  initialMemberId = null,
  onUploaded,
}: Props) {
  const activeMembers = useMemo(() => members.filter((member) => member.isActive), [members]);
  const [selectedMemberId, setSelectedMemberId] = useState<number | "">("");
  const [projects, setProjects] = useState<ProxyUploadProject[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [projectId, setProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const selectedMember = useMemo(
    () => activeMembers.find((member) => member.id === selectedMemberId) ?? null,
    [activeMembers, selectedMemberId],
  );

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
    if (!open) return;
    setFiles([]);
    setProgress([]);
    setUploading(false);
    setError(null);
    setDoneCount(0);
    setProjects([]);
    setProjectId("");
    setProjectMode("new");

    const preferred =
      (initialMemberId && activeMembers.find((member) => member.id === initialMemberId)) ||
      (activeMembers.length === 1 ? activeMembers[0] : null);

    if (preferred) {
      setSelectedMemberId(preferred.id);
      setNewProjectTitle(preferred.name.trim() ? `${preferred.name.trim()} 녹취` : "");
      void loadProjects(preferred.id, preferred.name);
    } else {
      setSelectedMemberId("");
      setNewProjectTitle("");
    }
    // Only re-init when the modal opens or the preferred member changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMemberId, loadProjects]);

  const handleSelectMember = (memberIdRaw: string) => {
    if (!memberIdRaw) {
      setSelectedMemberId("");
      setProjects([]);
      setProjectId("");
      setNewProjectTitle("");
      return;
    }
    const memberId = Number(memberIdRaw);
    const member = activeMembers.find((item) => item.id === memberId);
    if (!member) return;
    setSelectedMemberId(memberId);
    setFiles([]);
    setProgress([]);
    setDoneCount(0);
    void loadProjects(memberId, member.name);
  };

  const canSubmit = useMemo(() => {
    if (!selectedMember || uploading || loadingProjects || files.length === 0) return false;
    if (projectMode === "existing") return Boolean(projectId);
    return Boolean(newProjectTitle.trim());
  }, [selectedMember, uploading, loadingProjects, files.length, projectMode, projectId, newProjectTitle]);

  const handleFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles(Array.from(list));
    setProgress([]);
    setDoneCount(0);
    setError(null);
  };

  const handleUpload = async () => {
    if (!selectedMember || !canSubmit) return;
    setUploading(true);
    setError(null);
    setDoneCount(0);

    let resolvedProjectId = projectMode === "existing" ? projectId : null;
    let projectTitle = projectMode === "new" ? newProjectTitle.trim() : null;

    try {
      if (projectMode === "new") {
        const created = await createMemberProjectForProxyUpload(selectedMember.id, newProjectTitle.trim());
        resolvedProjectId = created.project_id;
        projectTitle = null;
        setProjects((prev) => [created, ...prev]);
        setProjectMode("existing");
        setProjectId(created.project_id);
      }

      setProgress(
        files.map((file) => ({
          name: file.name,
          percent: 0,
          status: "pending",
        })),
      );

      let success = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        setProgress((prev) =>
          prev.map((item, i) =>
            i === index ? { ...item, status: "uploading", percent: 0, message: undefined } : item,
          ),
        );
        try {
          const result = await uploadVoiceForMember(selectedMember.id, file, {
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">대신 업로드</h3>
            <p className="mt-1 text-sm text-slate-400">
              회원을 선택한 뒤 녹취 파일을 대신 등록합니다.
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

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">회원</p>
            <select
              value={selectedMemberId === "" ? "" : String(selectedMemberId)}
              disabled={uploading || activeMembers.length === 0}
              onChange={(event) => handleSelectMember(event.target.value)}
              className="min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none"
            >
              <option value="">회원을 선택하세요</option>
              {activeMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || "이름 없음"} · {member.phone || member.email || `ID ${member.id}`}
                </option>
              ))}
            </select>
            {activeMembers.length === 0 ? (
              <p className="mt-2 text-xs text-amber-300">활성 회원이 없습니다. 검색 조건을 확인해 주세요.</p>
            ) : null}
            {selectedMember ? (
              <p className="mt-2 text-xs text-slate-400">
                {selectedMember.email || "이메일 없음"} · ID {selectedMember.id}
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">프로젝트</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!projects.length || uploading || !selectedMember}
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
                disabled={uploading || !selectedMember}
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
            {loadingProjects ? (
              <p className="mt-2 text-sm text-slate-400">프로젝트 불러오는 중…</p>
            ) : projectMode === "existing" ? (
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
                disabled={uploading || !selectedMember}
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
              disabled={uploading || !selectedMember}
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
