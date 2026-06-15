import { resolveSegmentEndMs, type SegmentTiming } from "./segmentAudio";
import type { SelectedUploadSegment } from "./api";

export type TranscriptToken = {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker?: string | null;
  confidence?: number | null;
  uncertain?: boolean;
};

export type TimedWord = {
  text: string;
  start_ms: number;
  end_ms: number;
  uncertain?: boolean;
  confidence?: number | null;
  outsideSelection?: boolean;
};

function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function normalizeTranscriptTokens(tokens: unknown[] | undefined): TranscriptToken[] {
  if (!tokens?.length) return [];

  const parsed: TranscriptToken[] = [];
  for (const item of tokens) {
    if (!item || typeof item !== "object") continue;
    const token = item as Record<string, unknown>;
    const text = typeof token.text === "string" ? token.text : "";
    if (!text) continue;
    parsed.push({
      text,
      start_ms: typeof token.start_ms === "number" ? token.start_ms : null,
      end_ms: typeof token.end_ms === "number" ? token.end_ms : null,
      speaker: typeof token.speaker === "string" ? token.speaker : null,
      confidence: typeof token.confidence === "number" ? token.confidence : null,
      uncertain: Boolean(token.uncertain),
    });
  }
  return parsed;
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
  selectedSegments: SelectedUploadSegment[] = [],
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
          uncertain: Boolean(token.uncertain),
          confidence: typeof token.confidence === "number" ? token.confidence : null,
          outsideSelection: isOutsideSelection(start, Math.max(end, start + 1), selectedSegments),
        };
      });
    }
  }

  return buildFallbackTimedWords(segmentText, segment.start_ms, endMs).map((word) => ({
    ...word,
    outsideSelection: isOutsideSelection(word.start_ms, word.end_ms, selectedSegments),
  }));
}

export function isWordActive(word: TimedWord, playbackMs: number): boolean {
  return playbackMs >= word.start_ms && playbackMs < word.end_ms;
}

export function segmentContainsActiveWord(words: TimedWord[], playbackMs: number): boolean {
  return words.some((word) => isWordActive(word, playbackMs));
}

function isOutsideSelection(startMs: number, endMs: number, selectedSegments: SelectedUploadSegment[]): boolean {
  if (!selectedSegments.length) return false;
  return !selectedSegments.some((segment) => {
    if (segment.selected === false) return false;
    return startMs < segment.end_ms && endMs > segment.start_ms;
  });
}


export function activeWordClass(active: boolean, played: boolean, uncertain = false, outsideSelection = false): string {
  if (active) return "rounded-sm bg-white text-slate-950";
  if (outsideSelection) return played ? "text-amber-300" : "text-amber-400";
  if (uncertain) return played ? "text-red-300" : "text-red-400";
  if (played) return "text-slate-300";
  return "text-slate-100";
}
