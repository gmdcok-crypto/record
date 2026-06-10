import type { Segment } from "./api";
import { collectSpeakerIds } from "./api";

export type EditableSegment = Segment & { id: string };

export function sortSpeakerIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

export function mergeSpeakerIds(segments: Segment[], extraSpeakerIds: string[]): string[] {
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
  segments: Segment[],
  speakerLabels: Record<string, string>,
): string[] {
  const used = new Set(collectSpeakerIds(segments));
  return sortSpeakerIds(Object.keys(speakerLabels).filter((id) => !used.has(id)));
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
