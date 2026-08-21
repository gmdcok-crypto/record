import {
  createQuoteSegmentId,
  sumSelectedSegmentDurationMs,
  type QuoteSegment,
} from "./quotePricing";

export type UploadBillingMode = "full" | "segments";

export type UploadBillingFile = {
  key: string;
  file: File;
  url: string;
  durationMs: number | null;
  loading: boolean;
  error: string;
  mode: UploadBillingMode;
  segments: QuoteSegment[];
};

export function fileBillableDurationMs(entry: UploadBillingFile): number {
  if (!entry.durationMs) return 0;
  if (entry.mode === "full") return entry.durationMs;
  return sumSelectedSegmentDurationMs(entry.segments);
}

export function totalBillableDurationMs(entries: UploadBillingFile[]): number {
  return entries.reduce((sum, entry) => sum + fileBillableDurationMs(entry), 0);
}

export function isUploadBillingReady(entries: UploadBillingFile[]): boolean {
  if (!entries.length) return false;
  if (entries.some((entry) => entry.loading)) return false;

  return entries.every((entry) => {
    if (!entry.durationMs || entry.error) return false;
    if (entry.mode === "full") return true;
    return sumSelectedSegmentDurationMs(entry.segments) > 0;
  });
}

export function createUploadSegment(fileKey: string, start_ms: number, end_ms: number): QuoteSegment {
  return {
    id: createQuoteSegmentId(),
    fileId: fileKey,
    start_ms,
    end_ms,
    selected: true,
  };
}
