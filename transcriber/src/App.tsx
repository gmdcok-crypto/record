import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadFinalTranscriptPdf,
  fetchJob,
  finalizeTranscriptPdf,
  resolveUrl,
  saveTranscript,
  speakerLabel,
  type JobResponse,
  type TranscriptJson,
  type TranscriptSegment,
} from "./api";

type WorkStatus =
  | "배정 완료"
  | "초벌 작성 중"
  | "의뢰인 수정 확인"
  | "최종본 확정"
  | "PDF 전달 완료";

type AssignedWork = {
  jobId: string;
  client: string;
  title: string;
  filename: string;
  dueAt: string;
  status: WorkStatus;
  priority: "일반" | "긴급";
};

const WORKS: AssignedWork[] = [
  {
    jobId: "REC-20260604-001",
    client: "세종법무법인",
    title: "형사사건 녹취 초안",
    filename: "meeting_0604_client01.m4a",
    dueAt: "2026-06-04 18:00",
    status: "초벌 작성 중",
    priority: "긴급",
  },
  {
    jobId: "REC-20260603-118",
    client: "케이메디컬",
    title: "의료 자문 회의록",
    filename: "medical_roundtable.mp3",
    dueAt: "2026-06-04 16:00",
    status: "의뢰인 수정 확인",
    priority: "일반",
  },
  {
    jobId: "REC-20260602-094",
    client: "블루컴 본사",
    title: "제품 전략 회의",
    filename: "strategy_room_0602.mp4",
    dueAt: "2026-06-03 17:00",
    status: "최종본 확정",
    priority: "일반",
  },
];

function formatDateTime(value: string): string {
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

function buildDraftFromTranscript(transcript?: TranscriptJson | null): string {
  if (!transcript) return "";
  if (transcript.segments?.length) {
    return transcript.segments
      .map((segment) => `${speakerLabel(segment.speaker, transcript.speaker_labels)}: ${segment.text}`)
      .join("\n\n");
  }
  return (transcript.text || transcript.plain_text || "").trim();
}

function draftToTranscript(base: TranscriptJson | null, draft: string): TranscriptJson {
  const normalizedDraft = draft.trim();
  const lines = normalizedDraft
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = lines.map((line, index) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    const speaker = match?.[1]?.trim() || `${index + 1}`;
    const text = match?.[2]?.trim() || line;
    return {
      speaker,
      text,
      start_ms: base?.segments?.[index]?.start_ms ?? null,
      end_ms: base?.segments?.[index]?.end_ms ?? null,
    };
  });

  return {
    ...base,
    text: normalizedDraft,
    plain_text: normalizedDraft,
    segments: segments.length ? segments : base?.segments ?? [],
    tokens: base?.tokens ?? [],
    speaker_labels: base?.speaker_labels ?? {},
  };
}

function formatTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function statusStyle(status: WorkStatus): string {
  switch (status) {
    case "PDF 전달 완료":
    case "최종본 확정":
      return "bg-emerald-500/15 text-emerald-300";
    case "의뢰인 수정 확인":
      return "bg-violet-500/15 text-violet-300";
    case "초벌 작성 중":
      return "bg-cyan-500/15 text-cyan-300";
    default:
      return "bg-amber-500/15 text-amber-300";
  }
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [works, setWorks] = useState<AssignedWork[]>(WORKS);
  const [selectedJobId, setSelectedJobId] = useState<string>(WORKS[0]?.jobId ?? "");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentWork = useMemo(
    () => works.find((item) => item.jobId === selectedJobId) ?? null,
    [works, selectedJobId],
  );

  const currentTranscript = useMemo(
    () => draftToTranscript(job?.transcript_json ?? null, draft),
    [job, draft],
  );

  useEffect(() => {
    if (!selectedJobId) return;
    setLoading(true);
    setMessage("");
    setError("");
    fetchJob(selectedJobId)
      .then((data) => {
        setJob(data);
        setDraft(buildDraftFromTranscript(data.transcript_json));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "작업을 불러오지 못했습니다.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedJobId]);

  const updateWorkStatus = (status: WorkStatus, nextMessage: string) => {
    setWorks((prev) =>
      prev.map((item) => (item.jobId === selectedJobId ? { ...item, status } : item)),
    );
    setMessage(nextMessage);
  };

  const onSaveDraft = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      updateWorkStatus("초벌 작성 중", "초벌 문서를 저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onSendToClient = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      updateWorkStatus("의뢰인 수정 확인", "의뢰인 검토용 초벌본을 저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송 실패");
    } finally {
      setSaving(false);
    }
  };

  const onFinalize = async () => {
    if (!job) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      setJob({ ...job, transcript_json: currentTranscript });
      updateWorkStatus("최종본 확정", "최종 문서를 확정했습니다. PDF 날인본 전달 단계로 이동할 수 있습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "최종 확정 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDownloadStampedPdf = async () => {
    if (!job) return;
    setDownloadingPdf(true);
    setError("");
    setMessage("");
    try {
      await saveTranscript(job.job_id, currentTranscript);
      await finalizeTranscriptPdf(job.job_id, currentTranscript);
      await downloadFinalTranscriptPdf(job.job_id);
      setJob({ ...job, transcript_json: currentTranscript, final_pdf_ready: true, status: "pdf_sent" });
      updateWorkStatus("PDF 전달 완료", "최종 PDF를 R2에 저장하고 다운로드했습니다. 의뢰인은 저장된 최종 PDF를 받을 수 있습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 다운로드 실패");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_22%),linear-gradient(to_bottom,rgba(15,23,42,0.84),rgba(2,6,23,0.98))]" />
        <div className="relative mx-auto grid min-h-screen max-w-[1680px] gap-6 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-6">
          <aside className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Bluecom Transcriber</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">속기사 작업함</h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                배정된 음성 파일을 들으면서 초벌을 직접 작성하고, 의뢰인 수정 확인 후 최종 PDF까지 처리합니다.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {works.map((item) => {
                const active = item.jobId === selectedJobId;
                return (
                  <button
                    key={item.jobId}
                    type="button"
                    onClick={() => setSelectedJobId(item.jobId)}
                    className={`block w-full rounded-3xl border px-4 py-4 text-left transition ${
                      active
                        ? "border-cyan-500/40 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{item.title}</p>
                        <p className="mt-1 truncate text-sm text-slate-400">{item.client}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          item.priority === "긴급" ? "bg-rose-500/15 text-rose-300" : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {item.priority}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{item.jobId}</span>
                      <span>{item.dueAt}</span>
                    </div>
                    <div className="mt-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="space-y-6">
            <header className="rounded-[28px] border border-white/10 bg-slate-950/60 px-5 py-5 backdrop-blur-xl">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-sm font-medium text-cyan-300">Assigned Transcript Workflow</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                    초벌 작성부터 최종 PDF 전달까지 한 화면에서 처리
                  </h2>
                  {currentWork ? (
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {currentWork.client} · {currentWork.filename} · 마감 {formatDateTime(currentWork.dueAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={!job || saving}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "초벌 임시 저장"}
                  </button>
                  <button
                    type="button"
                    onClick={onSendToClient}
                    disabled={!job || saving}
                    className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                  >
                    의뢰인에게 초벌 전달
                  </button>
                  <button
                    type="button"
                    onClick={onFinalize}
                    disabled={!job || saving}
                    className="rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
                  >
                    최종본 확정
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadStampedPdf}
                    disabled={!job || downloadingPdf}
                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {downloadingPdf ? "PDF 생성 중..." : "도장 날인 PDF"}
                  </button>
                </div>
              </div>
            </header>

            {(message || error) && (
              <div
                className={`rounded-3xl px-4 py-3 text-sm ${
                  error
                    ? "border border-red-500/30 bg-red-500/10 text-red-300"
                    : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {error || message}
              </div>
            )}

            {loading ? (
              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-12 text-center text-slate-400 backdrop-blur-xl">
                배정 작업을 불러오는 중입니다...
              </div>
            ) : job ? (
              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.85fr]">
                <section className="space-y-6">
                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-cyan-300">원본 음성</p>
                        <p className="mt-1 text-sm text-slate-400">
                          오디오를 들으면서 초벌/최종 문서를 작성하는 작업 영역
                        </p>
                      </div>
                      {currentWork ? (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(currentWork.status)}`}>
                          {currentWork.status}
                        </span>
                      ) : null}
                    </div>
                    <audio
                      ref={audioRef}
                      controls
                      preload="metadata"
                      src={resolveUrl(job.audio_url)}
                      className="w-full rounded-2xl"
                    />
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-500">작업번호</p>
                        <p className="mt-2 break-all text-sm font-medium text-white">{job.job_id}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-500">파일명</p>
                        <p className="mt-2 text-sm font-medium text-white">
                          {job.transcript_json.filename || currentWork?.filename || "원본 파일"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-500">구간 수</p>
                        <p className="mt-2 text-sm font-medium text-white">{job.transcript_json.segments?.length ?? 0}개</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-500">예상 최종 단계</p>
                        <p className="mt-2 text-sm font-medium text-white">PDF 날인본 전달</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <div className="mb-4">
                      <p className="text-sm font-semibold text-violet-300">문서 편집</p>
                      <h3 className="mt-1 text-xl font-bold text-white">초벌본 / 최종본 작성</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        속기사는 이 편집 화면에서 빈 초안부터 직접 작성하고, 의뢰인에게 전달한 뒤 수정 요청을 반영한 최종본을
                        다시 확정합니다. 최종 확인이 끝나면 날인본 PDF를 생성합니다.
                      </p>
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="오디오를 들으며 화자명: 발언 내용 형식으로 초벌 문서를 직접 작성하세요."
                      className="min-h-[520px] w-full rounded-3xl border border-slate-700 bg-slate-950 px-5 py-4 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                    />
                  </div>
                </section>

                <section className="space-y-6">
                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-emerald-300">업무 단계</p>
                    <div className="mt-4 space-y-3">
                      {[
                        "1. 배정된 음성 확인",
                        "2. 초벌 녹취록 작성",
                        "3. 의뢰인에게 초벌 전달",
                        "4. 의뢰인 수정 사항 반영",
                        "5. 최종 문서 확정",
                        "6. 도장 날인 PDF 생성",
                        "7. 의뢰인 다운로드용 최종본 전달",
                      ].map((step) => (
                        <div key={step} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-blue-300">문서 미리보기</p>
                    <div className="mt-4 max-h-[520px] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                      {currentTranscript.segments?.length ? (
                        <div className="space-y-4">
                          {currentTranscript.segments.map((segment, index) => (
                            <div key={`${segment.speaker}-${index}`} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-semibold text-cyan-300">
                                  {speakerLabel(segment.speaker, currentTranscript.speaker_labels)}
                                </p>
                                <span className="text-xs text-slate-500">
                                  {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)}
                                </span>
                              </div>
                              <p className="mt-3 text-sm leading-7 text-slate-200">{segment.text}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">미리볼 대화 구간이 없습니다.</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-12 text-center text-slate-400 backdrop-blur-xl">
                불러온 작업이 없습니다.
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
