import { useEffect, useMemo, useRef, useState } from "react";

import { fetchSharedTranscript, resolveUrl, speakerLabel, type SharedJobResponse, type TranscriptSegment } from "./api";
import SegmentPlaybackText from "./SegmentPlaybackText";
import { buildSegmentTimedWords, segmentContainsActiveWord } from "./playbackHighlight";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";

type EditableSegment = TranscriptSegment & { id: string };

function buildEditableSegments(transcript?: SharedJobResponse["job"]["transcript_json"] | null): EditableSegment[] {
  const segments = transcript?.segments ?? [];
  return segments.map((segment, index) => ({
    ...segment,
    id: `${segment.speaker}-${segment.start_ms ?? "na"}-${index}`,
  }));
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

function formatSegmentTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export default function SharedTranscriptPage({ token }: { token: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [data, setData] = useState<SharedJobResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchSharedTranscript(token)
      .then(setData)
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

  const segments = useMemo(() => buildEditableSegments(data?.job.transcript_json ?? null), [data]);
  const tokens = useMemo(() => data?.job.transcript_json?.tokens ?? [], [data]);
  const labels = useMemo(() => data?.job.transcript_json?.speaker_labels ?? {}, [data]);

  const playSegment = (index: number, startMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;
    const endMs = resolveSegmentEndMs(segments, index);
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400">링크 확인 중…</div>;
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-6 text-center">
          <h1 className="text-xl font-bold text-white">공유 링크</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{error || "링크를 확인할 수 없습니다."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-6 pt-4 lg:px-6">
        <header className="mb-4 rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-cyan-300">읽기 전용 공유 링크</p>
          <h1 className="mt-1 text-2xl font-bold text-white">{data.job.title || "공유된 녹취록"}</h1>
          <p className="mt-2 text-sm text-slate-400">
            만료 시각: {formatDateTime(data.share.expires_at)} · 수정 없이 열람만 가능합니다.
          </p>
          {data.share.allow_pdf_download && data.share.final_pdf_url ? (
            <div className="mt-4">
              <a
                href={resolveUrl(data.share.final_pdf_url)}
                className="inline-flex rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
              >
                최종 PDF 다운로드
              </a>
            </div>
          ) : null}
        </header>

        <main className="flex-1 rounded-3xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl shadow-black/20">
          {data.share.allow_audio && data.job.audio_url ? (
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-slate-300">원본 음성</label>
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={resolveUrl(data.job.audio_url)}
                className="w-full rounded-xl"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            {segments.length ? (
              segments.map((segment, index) => {
                const segmentWords = buildSegmentTimedWords(segment.text, segment, index, segments, tokens);
                const hasActiveWord = isAudioPlaying && segmentContainsActiveWord(segmentWords, playbackMs);
                return (
                  <div
                    key={segment.id}
                    className={`rounded-xl border px-3 py-2.5 transition-colors ${
                      hasActiveWord ? "border-cyan-300/70 bg-cyan-400/10" : "border-slate-700/80 bg-slate-950/80"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2 px-1 py-0.5 text-left">
                      <span className="max-w-[9rem] shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100">
                        {speakerLabel(segment.speaker, labels)}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                      </span>
                    </div>
                    <SegmentPlaybackText
                      value={segment.text}
                      segment={segment}
                      segmentIndex={index}
                      segments={segments}
                      tokens={tokens}
                      playbackMs={playbackMs}
                      isAudioPlaying={isAudioPlaying}
                      readOnly
                      disabled={!data.share.allow_audio}
                      onChange={() => undefined}
                      onPlayRequest={() => playSegment(index, segment.start_ms)}
                    />
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-6 py-14 text-center text-sm text-slate-400">
                표시할 녹취 구간이 없습니다.
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
