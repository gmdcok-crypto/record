export type QuoteTier = {
  maxMinutes: number;
  label: string;
  baseFee: number;
  totalWithVat: number;
};

/** 최종 통합 녹취록 요금표 (부가세 10% 포함 결제금액) */
export const QUOTE_TIERS: QuoteTier[] = [
  { maxMinutes: 3, label: "3분 미만", baseFee: 20_000, totalWithVat: 22_000 },
  { maxMinutes: 5, label: "5분 미만", baseFee: 30_000, totalWithVat: 33_000 },
  { maxMinutes: 10, label: "10분 미만", baseFee: 60_000, totalWithVat: 66_000 },
  { maxMinutes: 20, label: "20분 미만", baseFee: 80_000, totalWithVat: 88_000 },
  { maxMinutes: 30, label: "30분 미만", baseFee: 100_000, totalWithVat: 110_000 },
  { maxMinutes: 40, label: "40분 미만", baseFee: 130_000, totalWithVat: 143_000 },
  { maxMinutes: 50, label: "50분 미만", baseFee: 160_000, totalWithVat: 176_000 },
  { maxMinutes: 60, label: "60분 미만", baseFee: 180_000, totalWithVat: 198_000 },
];

export type QuoteResult = {
  durationMs: number;
  tier: QuoteTier | null;
  overLimit: boolean;
};

export function calculateQuote(durationMs: number): QuoteResult {
  if (durationMs <= 0) {
    return { durationMs: 0, tier: null, overLimit: false };
  }

  const durationMinutes = durationMs / 60_000;
  if (durationMinutes >= 60) {
    return { durationMs, tier: null, overLimit: true };
  }

  const tier = QUOTE_TIERS.find((item) => durationMinutes < item.maxMinutes) ?? null;
  return { durationMs, tier, overLimit: false };
}

export function formatKrw(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function formatDurationHuman(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hour = Math.floor(totalSec / 3600);
  const minute = Math.floor((totalSec % 3600) / 60);
  const second = totalSec % 60;

  if (hour > 0) {
    return `${hour}시간 ${minute}분 ${second}초`;
  }
  if (minute > 0) {
    return `${minute}분 ${second}초`;
  }
  return `${second}초`;
}

export function readMediaDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    media.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      media.removeAttribute("src");
      media.load();
    };

    media.onloadedmetadata = () => {
      const durationMs = Number.isFinite(media.duration) ? Math.floor(media.duration * 1000) : 0;
      cleanup();
      if (durationMs > 0) {
        resolve(durationMs);
      } else {
        reject(new Error("파일 재생 시간을 확인할 수 없습니다."));
      }
    };

    media.onerror = () => {
      cleanup();
      reject(new Error("파일 재생 시간을 읽을 수 없습니다."));
    };

    media.src = url;
  });
}

export type QuoteSegment = {
  id: string;
  label: string;
  start_ms: number;
  end_ms: number;
  selected: boolean;
};

export function createQuoteSegmentId(): string {
  return `quote-seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function sumSelectedSegmentDurationMs(segments: QuoteSegment[]): number {
  return segments
    .filter((segment) => segment.selected)
    .reduce((sum, segment) => sum + Math.max(0, segment.end_ms - segment.start_ms), 0);
}
