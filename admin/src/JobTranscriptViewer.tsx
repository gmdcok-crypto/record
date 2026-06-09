import { useEffect, useMemo, useRef, useState } from "react";

import { resolveUrl, type JobResponse, type Segment, type TranscriptJson } from "./api";
import {
  buildSegmentTimedWords,
  normalizeTranscriptTokens,
  segmentContainsActiveWord,
} from "./playbackHighlight";
import SegmentPlaybackText from "./SegmentPlaybackText";
import {
  attachPlaybackTimeListener,
  attachSegmentStopListener,
  playSegmentAudio,
  resolveSegmentEndMs,
} from "./segmentAudio";

function formatSegmentTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function speakerLabel(speakerId: string, labels: Record<string, string>): string {
  return labels[speakerId]?.trim() || speakerId;
}

function buildViewerSegments(transcript: TranscriptJson | null | undefined): Segment[] {
  const segments = transcript?.segments ?? [];
  if (segments.length) return segments;

  const body = (transcript?.text || transcript?.plain_text || "").trim();
  if (!body) return [];

  return body
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      return {
        speaker: match?.[1]?.trim() || "1",
        text: match?.[2]?.trim() || line,
        start_ms: null,
        end_ms: null,
      };
    });
}

type JobTranscriptViewerProps = {
  job: JobResponse;
};

export default function JobTranscriptViewer({ job }: JobTranscriptViewerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const segments = useMemo(() => buildViewerSegments(job.transcript_json), [job.transcript_json]);
  const speakerLabels = job.transcript_json?.speaker_labels ?? {};
  const transcriptTokens = useMemo(
    () => normalizeTranscriptTokens(job.transcript_json?.tokens),
    [job.transcript_json?.tokens],
  );

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

  const playSegment = (index: number, startMs: number | null | undefined) => {
    const audio = audioRef.current;
    if (!audio || startMs == null) return;
    const endMs = resolveSegmentEndMs(segments, index);
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">음성 파일</p>
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={resolveUrl(job.audio_url)}
          className="w-full rounded-xl"
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">녹취록</p>
        {segments.length ? (
          <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {segments.map((segment, index) => {
              const segmentWords = buildSegmentTimedWords(
                segment.text,
                segment,
                index,
                segments,
                transcriptTokens,
              );
              const hasActiveWord = isAudioPlaying && segmentContainsActiveWord(segmentWords, playbackMs);

              return (
                <div
                  key={`${segment.speaker}-${segment.start_ms ?? "na"}-${index}`}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    hasActiveWord ? "border-cyan-300/70 bg-cyan-400/10" : "border-white/5 bg-slate-950/70"
                  }`}
                >
                  <div className="mb-1.5 flex min-w-0 items-center gap-2">
                    <span className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs font-semibold text-cyan-300">
                      {speakerLabel(segment.speaker, speakerLabels)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatSegmentTime(segment.start_ms)} - {formatSegmentTime(segment.end_ms)}
                    </span>
                  </div>
                  <SegmentPlaybackText
                    readOnly
                    value={segment.text}
                    segment={segment}
                    segmentIndex={index}
                    segments={segments}
                    tokens={transcriptTokens}
                    playbackMs={playbackMs}
                    isAudioPlaying={isAudioPlaying}
                    disabled={segment.start_ms == null}
                    onPlayRequest={() => playSegment(index, segment.start_ms)}
                    onChange={() => {}}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-400">
            표시할 녹취록이 없습니다.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          구간 텍스트를 누르면 해당 음성이 재생되며, 재생 중 글자가 순서대로 반전 표시됩니다.
        </p>
      </div>
    </div>
  );
}
