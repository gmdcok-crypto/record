import { resolveSegmentEndMs, type SegmentTiming } from "./segmentAudio";
import type { TranscriptToken } from "./api";

export type TimedWord = {
  text: string;
  start_ms: number;
  end_ms: number;
};

function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function tokensForSegment(
  tokens: TranscriptToken[],
  segment: SegmentTiming,
  segmentIndex: number,
  segments: SegmentTiming[],
): TranscriptToken[] {
  if (segment.start_ms == null) return [];

  const endMs = resolveSegmentEndMs(segments, segmentIndex);
  return tokens.filter((token) => {
    if (token.start_ms == null) return false;
    if (token.start_ms < segment.start_ms! - 100) return false;
    if (endMs != null && token.start_ms > endMs + 100) return false;
    return true;
  });
}

function buildFallbackTimedWords(text: string, startMs: number | null, endMs: number | null): TimedWord[] {
  if (!text) return [];

  const start = startMs ?? 0;
  const end = endMs ?? start + Math.max(text.length * 90, 1200);
  const duration = Math.max(end - start, 1);
  const units = [...text];
  const step = duration / units.length;

  return units.map((unit, index) => ({
    text: unit,
    start_ms: start + Math.floor(index * step),
    end_ms: start + Math.floor((index + 1) * step),
  }));
}

export function buildSegmentTimedWords(
  segmentText: string,
  segment: SegmentTiming,
  segmentIndex: number,
  segments: SegmentTiming[],
  tokens: TranscriptToken[],
): TimedWord[] {
  const endMs = resolveSegmentEndMs(segments, segmentIndex);
  const segmentTokens = tokensForSegment(tokens, segment, segmentIndex, segments);

  if (segmentTokens.length) {
    const joined = segmentTokens.map((token) => token.text).join("");
    if (normalizeTranscriptText(joined) === normalizeTranscriptText(segmentText)) {
      return segmentTokens.map((token, index) => {
        const start = token.start_ms ?? segment.start_ms ?? 0;
        const nextStart = segmentTokens[index + 1]?.start_ms;
        const end =
          token.end_ms ??
          (nextStart != null ? Math.max(nextStart - 1, start) : endMs ?? start + 250);

        return {
          text: token.text,
          start_ms: start,
          end_ms: Math.max(end, start + 1),
        };
      });
    }
  }

  return buildFallbackTimedWords(segmentText, segment.start_ms, endMs);
}

export function isWordActive(word: TimedWord, playbackMs: number): boolean {
  return playbackMs >= word.start_ms && playbackMs < word.end_ms;
}

export function segmentContainsActiveWord(words: TimedWord[], playbackMs: number): boolean {
  return words.some((word) => isWordActive(word, playbackMs));
}

export function activeWordClass(active: boolean, played: boolean): string {
  if (active) return "rounded-sm bg-white text-slate-950";
  if (played) return "text-slate-300";
  return "text-slate-100";
}
