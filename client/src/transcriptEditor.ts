import type { TranscriptJson, TranscriptSegment } from "./api";
import { collectSpeakerIds, speakerLabel } from "./api";

export type EditableSegment = TranscriptSegment & { id: string };

export const OMITTED_MARKER = "(생략)";

export function formatSegmentTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function formatSegmentTimeRange(
  startMs: number | null | undefined,
  endMs: number | null | undefined,
): string {
  return `${formatSegmentTime(startMs)} - ${formatSegmentTime(endMs)}`;
}

export function formatOmittedDocumentText(
  startMs: number | null | undefined,
  endMs: number | null | undefined,
): string {
  return `${formatSegmentTimeRange(startMs, endMs)} ${OMITTED_MARKER}`;
}

export function isSegmentOmitted(segment: TranscriptSegment): boolean {
  return Boolean(segment.omitted);
}

export function segmentDocumentLine(
  segment: TranscriptSegment,
  speakerLabels: Record<string, string>,
): string {
  const label = speakerLabel(segment.speaker, speakerLabels);
  if (isSegmentOmitted(segment)) {
    return `${label}: ${formatOmittedDocumentText(segment.start_ms, segment.end_ms)}`;
  }
  return `${label}: ${segment.text.trim()}`;
}

export function segmentsToTranscript(
  base: TranscriptJson | null,
  segments: EditableSegment[],
  speaker_labels: Record<string, string>,
): TranscriptJson {
  const cleaned = segments.map(({ id: _id, ...segment }) => {
    const normalized: TranscriptSegment = {
      speaker: segment.speaker.trim() || "1",
      text: segment.text.trim(),
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
    };
    if (segment.omitted) {
      normalized.omitted = true;
    }
    return normalized;
  });
  const body = cleaned
    .filter((segment) => isSegmentOmitted(segment) || segment.text.trim())
    .map((segment) => segmentDocumentLine(segment, speaker_labels))
    .join("\n\n");

  return {
    ...base,
    text: body,
    plain_text: body,
    segments: cleaned,
    tokens: base?.tokens ?? [],
    speaker_labels,
  };
}

export function sortSpeakerIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

export function mergeSpeakerIds(segments: TranscriptSegment[], extraSpeakerIds: string[]): string[] {
  const ids = new Set(collectSpeakerIds(segments));
  for (const id of extraSpeakerIds) {
    if (id.trim()) ids.add(id.trim());
  }
  return sortSpeakerIds(Array.from(ids));
}

export function nextSpeakerId(existingIds: string[]): string {
  const numeric = existingIds
    .map((id) => Number(id))
    .filter((value) => Number.isFinite(value) && value > 0);
  return String(numeric.length ? Math.max(...numeric) + 1 : 1);
}

export function deriveExtraSpeakerIds(
  segments: TranscriptSegment[],
  speakerLabels: Record<string, string>,
): string[] {
  const used = new Set(collectSpeakerIds(segments));
  return sortSpeakerIds(Object.keys(speakerLabels).filter((id) => !used.has(id)));
}

export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((part) => part.trim());
    if (parts.length === 2) {
      const minute = Number(parts[0]);
      const second = Number(parts[1]);
      if (!Number.isFinite(minute) || !Number.isFinite(second) || minute < 0 || second < 0) return null;
      return Math.floor((minute * 60 + second) * 1000);
    }
    if (parts.length === 3) {
      const hour = Number(parts[0]);
      const minute = Number(parts[1]);
      const second = Number(parts[2]);
      if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
      return Math.floor((hour * 3600 + minute * 60 + second) * 1000);
    }
    return null;
  }

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.floor(seconds * 1000);
}

export function formatDurationInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  const total = Math.floor(ms / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function sortEditableSegments(segments: EditableSegment[]): EditableSegment[] {
  return [...segments].sort((left, right) => {
    const leftStart = left.start_ms ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.start_ms ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    return left.id.localeCompare(right.id);
  });
}

export function createManualSegmentId(): string {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function insertSegmentAfter<T extends EditableSegment>(
  segments: T[],
  afterIndex: number,
  segment: T,
): T[] {
  const insertAt = Math.min(Math.max(afterIndex + 1, 0), segments.length);
  const next = [...segments];
  next.splice(insertAt, 0, segment);
  return next;
}

export function toggleSegmentOmitted(segments: EditableSegment[], index: number): EditableSegment[] {
  return segments.map((segment, currentIndex) =>
    currentIndex === index ? { ...segment, omitted: !segment.omitted } : segment,
  );
}
