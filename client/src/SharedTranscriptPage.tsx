import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchSharedTranscript,
  fetchSharedTranscriptChanges,
  resolveUrl,
  saveSharedTranscript,
  speakerLabel,
  submitSharedReviewRequest,
  type SharedJobResponse,
  type TranscriptSegment,
} from "./api";
import AddSegmentModal, { type AddSegmentDraft } from "./AddSegmentModal";
import ActionNoticeModal, { type ActionNotice, type ActionNoticeKind } from "./ActionNoticeModal";
import { formatKstDateTime } from "./formatKstDateTime";
import SegmentPlaybackText from "./SegmentPlaybackText";
import SpeakerSettingsModal from "./SpeakerSettingsModal";
import TranscriptChangeHistory from "./TranscriptChangeHistory";
import { buildSegmentTimedWords, segmentContainsActiveWord } from "./playbackHighlight";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";
import {
  createManualSegmentId,
  deriveExtraSpeakerIds,
  formatSegmentTime,
  insertSegmentAfter,
  mergeSpeakerIds,
  nextSpeakerId,
  OMITTED_MARKER,
  segmentsToTranscript,
  toggleSegmentOmitted,
} from "./transcriptEditor";

type EditableSegment = TranscriptSegment & { id: string };

function buildEditableSegments(transcript?: SharedJobResponse["job"]["transcript_json"] | null): EditableSegment[] {
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

export default function SharedTranscriptPage({ token }: { token: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [data, setData] = useState<SharedJobResponse | null>(null);
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({});
  const [extraSpeakerIds, setExtraSpeakerIds] = useState<string[]>([]);
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [addSegmentAfterIndex, setAddSegmentAfterIndex] = useState<number | null>(null);
  const [changeHistoryRefresh, setChangeHistoryRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const showNotice = useCallback((kind: ActionNoticeKind, message: string, title?: string) => {
    setActionNotice({ kind, message, title });
  }, []);

  useEffect(() => {
    document.title = "불판녹취";
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchSharedTranscript(token)
      .then((response) => {
        setData(response);
        const loadedSegments = buildEditableSegments(response.job.transcript_json);
        const loadedLabels = response.job.transcript_json?.speaker_labels ?? {};
        setSegments(loadedSegments);
        setSpeakerLabels(loadedLabels);
        setExtraSpeakerIds(deriveExtraSpeakerIds(loadedSegments, loadedLabels));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "공유 링크를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [token]);

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
  }, [data?.job.job_id]);

  const tokens = useMemo(() => data?.job.transcript_json?.tokens ?? [], [data]);
  const selectedUploadSegments = useMemo(() => data?.job.selected_segments ?? [], [data?.job.selected_segments]);
  const speakerIds = useMemo(() => mergeSpeakerIds(segments, extraSpeakerIds), [segments, extraSpeakerIds]);
  const currentTranscript = useMemo(
    () => segmentsToTranscript(data?.job.transcript_json ?? null, segments, speakerLabels),
    [data?.job.transcript_json, segments, speakerLabels],
  );

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

  const onSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await saveSharedTranscript(token, currentTranscript);
      setData((prev) =>
        prev
          ? {
              ...prev,
              job: {
                ...prev.job,
                status: "client_review",
                workflow_status: "client_review",
                transcript_json: currentTranscript,
              },
            }
          : prev,
      );
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "공유 링크 수정본이 저장되었습니다.", "저장 완료");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "저장 실패", "저장 실패");
    } finally {
      setSaving(false);
    }
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
    if (saving || !speakerIds.length) return;
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

  const onSubmitForReview = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await submitSharedReviewRequest(token, currentTranscript);
      setData((prev) =>
        prev
          ? {
              ...prev,
              job: {
                ...prev.job,
                status: "transcriber_review",
                workflow_status: "transcriber_review",
                transcript_json: currentTranscript,
              },
            }
          : prev,
      );
      setChangeHistoryRefresh((value) => value + 1);
      showNotice("success", "녹취록 요청이 접수되었습니다.");
    } catch (err) {
      showNotice("error", err instanceof Error ? err.message : "녹취록 요청 실패", "녹취록 요청 실패");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="client-loading">링크 확인 중…</div>;
  }

  if (error || !data) {
    return (
      <div className="client-app flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-shell border border-line bg-white p-6 text-center shadow-card">
          <h1 className="text-xl font-bold text-brand-navy">공유 링크</h1>
          <p className="mt-3 text-sm leading-6 text-brand-brown">{error || "링크를 확인할 수 없습니다."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="client-app min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-6 pt-4 lg:px-6">
        <header className="mb-4 rounded-shell border border-line bg-white p-5 shadow-card">
          <p className="text-sm font-semibold text-brand-orange">공유 편집 링크</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-navy">{data.job.title || "공유된 녹취록"}</h1>
          <p className="mt-2 text-sm text-brand-brown">
            만료 시각: {formatKstDateTime(data.share.expires_at)} · 링크 접속자도 바로 수정하고 저장할 수 있습니다.
          </p>
          {data.share.allow_pdf_download && data.share.final_pdf_url ? (
            <div className="mt-4">
              <a
                href={resolveUrl(data.share.final_pdf_url)}
                className="inline-flex rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-brand-navy transition hover:bg-soft"
              >
                최종 PDF 다운로드
              </a>
            </div>
          ) : null}
        </header>

        <main className="flex-1 rounded-shell border border-line bg-white p-5 shadow-card">
          {data.share.allow_audio && data.job.audio_url ? (
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-brand-navy">원본 음성</label>
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={resolveUrl(data.job.audio_url)}
                className="w-full rounded-xl"
              />
            </div>
          ) : null}

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-brand-navy">녹취 초안 / 공유 수정본</label>
              <button
                type="button"
                onClick={() => setSpeakerSettingsOpen(true)}
                disabled={saving}
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy transition hover:bg-soft disabled:opacity-50"
              >
                화자 설정
              </button>
            </div>
            <p className="mb-2 text-xs text-brand-brown">
              노란 글자는 업로드 시 선택한 구간 밖의 텍스트입니다. PDF에는 선택한 구간만 반영됩니다.
            </p>
            <div className="space-y-2">
            {segments.length ? (
              segments.map((segment, index) => {
                const segmentWords = buildSegmentTimedWords(segment.text, segment, index, segments, tokens, selectedUploadSegments);
                const hasActiveWord = isAudioPlaying && segmentContainsActiveWord(segmentWords, playbackMs);
                return (
                  <div
                    key={segment.id}
                    className={`rounded-xl border px-3 py-2.5 transition-colors ${
                      segment.omitted
                        ? "border-line-strong/80 bg-white/50"
                        : hasActiveWord
                        ? "border-brand-orange/40 bg-brand-orange/10"
                        : "border-line/80 bg-soft"
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={saving || !speakerIds.length ? -1 : 0}
                      onClick={() => openAddSegmentAfter(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openAddSegmentAfter(index);
                        }
                      }}
                      title="클릭하여 이 대화 다음에 새 대화 추가"
                      className={`mb-1.5 flex w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 text-left transition ${
                        saving || !speakerIds.length
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:border-brand-orange/30 hover:bg-brand-orange/10"
                      }`}
                    >
                      <select
                        value={segment.speaker}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => updateSegment(index, { speaker: event.target.value })}
                        disabled={Boolean(segment.omitted)}
                        className="max-w-[9rem] shrink-0 rounded-lg border border-line bg-white px-2 py-1 text-xs font-semibold text-brand-navy outline-none transition focus:border-brand-orange/55 disabled:opacity-60"
                      >
                        {speakerIds.map((id) => (
                          <option key={id} value={id}>
                            {speakerLabel(id, speakerLabels)}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-brand-brown">
                        {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSegmentOmit(index);
                        }}
                        disabled={saving}
                        className="ml-auto shrink-0 rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-semibold text-brand-navy transition hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {segment.omitted ? "복구" : "구간삭제"}
                      </button>
                      {!segment.omitted ? (
                        <span className="shrink-0 text-[10px] font-semibold text-brand-orange/80">+ 추가</span>
                      ) : null}
                    </div>
                    {segment.omitted ? (
                      <p className="px-1 text-sm font-medium text-brand-brown">
                        {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}{" "}
                        {OMITTED_MARKER}
                      </p>
                    ) : (
                    <SegmentPlaybackText
                      value={segment.text}
                      segment={segment}
                      segmentIndex={index}
                      segments={segments}
                      tokens={tokens}
                      selectedSegments={selectedUploadSegments}
                      playbackMs={playbackMs}
                      isAudioPlaying={isAudioPlaying}
                      disabled={saving}
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
              <div className="rounded-2xl border border-dashed border-line bg-soft px-6 py-14 text-center text-sm text-brand-brown">
                표시할 녹취 구간이 없습니다.
              </div>
            )}
            </div>
          </div>

          <TranscriptChangeHistory
            jobId={data.job.job_id}
            refreshKey={changeHistoryRefresh}
            loadEntries={() => fetchSharedTranscriptChanges(token)}
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-xl bg-brand-orange py-3 text-sm font-semibold text-white transition hover:bg-brand-orange-dark disabled:opacity-50"
            >
              {saving ? "저장 중..." : "공유 링크에서 저장"}
            </button>
            <button
              type="button"
              onClick={onSubmitForReview}
              disabled={saving}
              className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              녹취록 요청
            </button>
            {data.share.allow_pdf_download && data.share.final_pdf_url ? (
              <a
                href={resolveUrl(data.share.final_pdf_url)}
                className="inline-flex items-center justify-center rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold text-brand-navy transition hover:bg-soft"
              >
                최종 PDF 다운로드
              </a>
            ) : (
              <div className="hidden sm:block" />
            )}
            <div className="hidden sm:block" />
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
          addSegmentAfterIndex != null ? segments[addSegmentAfterIndex]?.speaker ?? speakerIds[0] : speakerIds[0]
        }
        onClose={() => setAddSegmentAfterIndex(null)}
        onAdd={handleAddSegment}
      />
      <ActionNoticeModal notice={actionNotice} onClose={() => setActionNotice(null)} />
    </div>
  );
}
