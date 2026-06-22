import { useEffect, useMemo, useRef, useState } from "react";

import AddSegmentModal, { type AddSegmentDraft } from "./AddSegmentModal";
import JobInquiryPanel from "./JobInquiryPanel";
import SegmentPlaybackText from "./SegmentPlaybackText";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";
import {
  createAdminJobInquiry,
  deliverDraftToClient,
  adminDeliverJobPdf,
  downloadFinalTranscriptPdf,
  fetchAdminJobInquiries,
  fetchTranscriptChanges,
  finalizeTranscriptPdf,
  resolveUrl,
  runAiDraft,
  saveTranscript,
  speakerLabel,
  type JobResponse,
  type Segment,
  type TranscriptJson,
} from "./api";
import { buildSegmentTimedWords, normalizeTranscriptTokens, segmentContainsActiveWord } from "./playbackHighlight";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";
import {
  createManualSegmentId,
  deriveExtraSpeakerIds,
  insertSegmentAfter,
  mergeSpeakerIds,
  nextSpeakerId,
  type EditableSegment,
} from "./transcriptEditor";

type Props = {
  job: JobResponse;
  formatDateTime: (value: string | null | undefined) => string;
  mapJobStatus: (status: string) => string;
  onJobChange: (job: JobResponse) => void;
  onReloadOverview?: () => Promise<void> | void;
  onNotice: (kind: "success" | "error" | "info", message: string, title?: string) => void;
};

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
  speakerLabels: Record<string, string>,
): TranscriptJson {
  const cleaned = segments.map(({ id: _id, ...segment }) => ({
    ...segment,
    speaker: segment.speaker.trim() || "1",
    text: segment.text.trim(),
  }));
  const body = cleaned
    .filter((segment) => segment.text.trim())
    .map((segment) => `${speakerLabel(segment.speaker, speakerLabels)}: ${segment.text.trim()}`)
    .join("\n\n");
  return {
    ...base,
    text: body,
    plain_text: body,
    segments: cleaned,
    tokens: base?.tokens ?? [],
    speaker_labels: speakerLabels,
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

function normalizeWorkflowStatus(status: string | undefined | null): string {
  switch (status ?? "") {
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
      return status ?? "";
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
      return "PDF 전달";
    default:
      return status;
  }
}

function fileStatusStyle(status: string): string {
  switch (normalizeWorkflowStatus(status)) {
    case "pdf_sent":
      return "bg-emerald-500/15 text-emerald-300";
    case "client_review":
    case "transcriber_review":
    case "transcript_request":
      return "bg-violet-500/15 text-violet-300";
    case "working":
      return "bg-cyan-500/15 text-cyan-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

function workflowStatus(job: { status?: string; workflow_status?: string } | null | undefined): string {
  return job?.workflow_status ?? job?.status ?? "";
}

export default function AdminTranscriptEditor({
  job,
  formatDateTime,
  mapJobStatus,
  onJobChange,
  onReloadOverview,
  onNotice,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [extraSpeakerIds, setExtraSpeakerIds] = useState<string[]>([]);
  const [addSegmentAfterIndex, setAddSegmentAfterIndex] = useState<number | null>(null);
  const [changeHistoryRefresh, setChangeHistoryRefresh] = useState(0);
  const [inquiryRefresh, setInquiryRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    const loadedSegments = buildEditableSegments(job.transcript_json);
    const loadedLabels = job.transcript_json?.speaker_labels ?? {};
    setSegments(loadedSegments);
    setSpeakerLabels(loadedLabels);
    setExtraSpeakerIds(deriveExtraSpeakerIds(loadedSegments, loadedLabels));
  }, [job.job_id, job.transcript_json]);

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
  }, [job.job_id]);

  const speakerIds = useMemo(
    () => mergeSpeakerIds(segments, extraSpeakerIds),
    [segments, extraSpeakerIds],
  );
  const currentTranscript = useMemo(
    () => segmentsToTranscript(job?.transcript_json ?? null, segments, speakerLabels),
    [job?.transcript_json, segments, speakerLabels],
  );
  const transcriptTokens = useMemo(
    () => normalizeTranscriptTokens(job?.transcript_json?.tokens),
    [job?.transcript_json?.tokens],
  );
  const selectedUploadSegments = useMemo(() => job.selected_segments ?? [], [job.selected_segments]);

  const updateSegment = (index: number, patch: Partial<Segment>) => {
    setSegments((prev) =>
      prev.map((segment, currentIndex) => (currentIndex === index ? { ...segment, ...patch } : segment)),
    );
  };

  const playSegment = (index: number, startMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;
    const endMs = resolveSegmentEndMs(segments, index);
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  const applySpeakerLabels = (labels: Record<string, string>) => {
    const cleaned: Record<string, string> = {};
    for (const [id, name] of Object.entries(labels)) {
      if (name.trim()) cleaned[id] = name.trim();
    }
    setSpeakerLabels(cleaned);
    setExtraSpeakerIds((prev) => prev.filter((id) => speakerIds.includes(id)));
    setSpeakerSettingsOpen(false);
    onNotice("info", "화자 이름이 적용되었습니다. 저장하면 서버에 반영됩니다.");
  };

  const handleAddSpeaker = () => {
    const id = nextSpeakerId(speakerIds);
    setExtraSpeakerIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    onNotice("info", `${speakerLabel(id)}이(가) 추가되었습니다. 이름을 입력한 뒤 적용하세요.`);
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
    onNotice("success", "대화 구간이 추가되었습니다.");
  };

  const onRunAiDraft = async () => {
    if (segments.some((segment) => segment.text.trim()) && !window.confirm("기존 편집 내용을 AI 초벌 결과로 덮어씁니다. 계속할까요?")) {
      return;
    }

    setAiRunning(true);
    try {
      const result = await runAiDraft(job.job_id);
      const transcript = result.transcript_json;
      const nextJob = {
        ...job,
        transcript_json: transcript,
        status: normalizeWorkflowStatus(job.status) === "working" ? "working" : job.status,
        workflow_status: result.workflow_status ?? job.workflow_status ?? job.status,
      };
      onJobChange(nextJob);
      setChangeHistoryRefresh((value) => value + 1);
      setInquiryRefresh((value) => value + 1);
      await onReloadOverview?.();
      onNotice("success", "AI 초벌 작업이 완료되었습니다. 검토 후 ‘의뢰인 검토요청’을 눌러 주세요.");
    } catch (err) {
      onNotice("error", err instanceof Error ? err.message : "AI 초벌 작업에 실패했습니다.");
    } finally {
      setAiRunning(false);
    }
  };

  const onSaveDraft = async () => {
    setSaving(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "draft");
      onJobChange({ ...job, transcript_json: currentTranscript });
      setChangeHistoryRefresh((value) => value + 1);
      onNotice("success", "저장이 완료되었습니다.", "저장 완료");
    } catch (err) {
      onNotice("error", err instanceof Error ? err.message : "저장 실패", "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSendToClient = async () => {
    if (!segments.some((segment) => segment.text.trim())) {
      onNotice("error", "전달할 초벌 내용이 없습니다. AI 초벌작업을 실행하거나 직접 작성해 주세요.");
      return;
    }

    setSendingToClient(true);
    setSaving(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const result = await deliverDraftToClient(job.job_id, currentTranscript);
      onJobChange({
        ...job,
        transcript_json: result.transcript_json,
        status: result.status,
        workflow_status: result.workflow_status ?? result.status,
      });
      await onReloadOverview?.();
      setChangeHistoryRefresh((value) => value + 1);
      setInquiryRefresh((value) => value + 1);
      onNotice("success", "의뢰인 검토요청을 보냈습니다. 의뢰인 화면에서 의뢰인 검토 상태로 확인할 수 있습니다.");
    } catch (err) {
      onNotice("error", err instanceof Error ? err.message : "전달 실패");
    } finally {
      setSaving(false);
      setSendingToClient(false);
    }
  };

  const onFinalize = async () => {
    setSaving(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "finalize");
      onJobChange({ ...job, transcript_json: currentTranscript });
      setChangeHistoryRefresh((value) => value + 1);
      onNotice("success", "최종본이 저장되었습니다.");
    } catch (err) {
      onNotice("error", err instanceof Error ? err.message : "확정 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDownloadStampedPdf = async () => {
    setDownloadingPdf(true);
    try {
      await saveTranscript(job.job_id, currentTranscript, "pdf_finalize");
      await finalizeTranscriptPdf(job.job_id, currentTranscript);
      await downloadFinalTranscriptPdf(job.job_id);
      const delivered = await adminDeliverJobPdf(job.job_id);
      onJobChange({
        ...job,
        transcript_json: currentTranscript,
        final_pdf_ready: true,
        status: delivered.status,
        workflow_status: delivered.status,
      });
      setChangeHistoryRefresh((value) => value + 1);
      await onReloadOverview?.();
      onNotice("success", "최종 PDF를 저장·전달했고 정산 데이터를 반영했습니다.");
    } catch (err) {
      onNotice("error", err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">작업번호</p>
          <p className="mt-1 font-mono text-xs text-white">{job.job_id}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">마감</p>
          <p className="mt-1 text-white">{formatDateTime(job.due_at)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">최종 PDF</p>
          <p className="mt-1 text-white">{job.final_pdf_ready ? "준비됨" : "미준비"}</p>
        </div>
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-5 shadow-2xl shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="mt-1 text-xl font-bold text-white">{job.title || job.transcript_json?.filename || "녹취 편집"}</h2>
            <p className="mt-1 text-sm text-slate-400">
              구간 텍스트를 누르면 해당 오디오가 재생되고, 같은 영역에서 바로 수정할 수 있습니다.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {job.client?.name || "-"}
              {job.transcriber?.name ? ` · 담당 ${job.transcriber.name}` : ""}
              {job.due_at ? ` · 마감 ${formatDateTime(job.due_at)}` : ""}
              {" · "}
              <span className={`rounded-full px-2 py-0.5 font-semibold ${fileStatusStyle(workflowStatus(job))}`}>
                {mapFileStatusLabel(workflowStatus(job))}
              </span>
              {job.status ? ` · 원상태 ${mapJobStatus(job.status)}` : ""}
            </p>
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
              <label className="text-sm font-medium text-slate-300">녹취 초벌 / 관리자 편집본</label>
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

          <div className="grid gap-4 xl:grid-cols-2">
            <JobInquiryPanel
              title="의뢰인 - 관리자 대화"
              accent="cyan"
              jobId={job.job_id}
              threadType="client_admin"
              loadMessages={fetchAdminJobInquiries}
              sendMessage={createAdminJobInquiry}
              onError={(message) => onNotice("error", message)}
              refreshKey={inquiryRefresh}
            />
            <JobInquiryPanel
              title="속기사 - 관리자 대화"
              accent="violet"
              jobId={job.job_id}
              threadType="transcriber_admin"
              loadMessages={fetchAdminJobInquiries}
              sendMessage={createAdminJobInquiry}
              onError={(message) => onNotice("error", message)}
              refreshKey={inquiryRefresh}
            />
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
        defaultSpeakerId={addSegmentAfterIndex != null ? segments[addSegmentAfterIndex]?.speaker : undefined}
        onClose={() => setAddSegmentAfterIndex(null)}
        onAdd={handleAddSegment}
      />

      {sendingToClient ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm">
          <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/95 px-6 py-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
            <p className="text-sm font-semibold text-cyan-100">의뢰인에게 전달중입니다.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
