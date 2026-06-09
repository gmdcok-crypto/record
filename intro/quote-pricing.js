const QuotePricing = (() => {
  const QUOTE_TIERS = [
    { maxMinutes: 3, label: "3분 미만", baseFee: 20000, totalWithVat: 22000 },
    { maxMinutes: 5, label: "5분 미만", baseFee: 30000, totalWithVat: 33000 },
    { maxMinutes: 10, label: "10분 미만", baseFee: 60000, totalWithVat: 66000 },
    { maxMinutes: 20, label: "20분 미만", baseFee: 80000, totalWithVat: 88000 },
    { maxMinutes: 30, label: "30분 미만", baseFee: 100000, totalWithVat: 110000 },
    { maxMinutes: 40, label: "40분 미만", baseFee: 130000, totalWithVat: 143000 },
    { maxMinutes: 50, label: "50분 미만", baseFee: 160000, totalWithVat: 176000 },
    { maxMinutes: 60, label: "60분 미만", baseFee: 180000, totalWithVat: 198000 },
  ];

  const ZERO_HMS = { hour: 0, minute: 0, second: 0 };

  function msToHms(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
      hour: Math.floor(total / 3600),
      minute: Math.floor((total % 3600) / 60),
      second: total % 60,
    };
  }

  function hmsToMs({ hour, minute, second }) {
    return (hour * 3600 + minute * 60 + second) * 1000;
  }

  function clampHms(value, maxMs) {
    if (maxMs == null) return value;
    const max = msToHms(maxMs);
    const next = { ...value };
    if (next.hour > max.hour) next.hour = max.hour;
    const minuteMax = next.hour === max.hour ? max.minute : 59;
    if (next.minute > minuteMax) next.minute = minuteMax;
    const secondMax = next.hour === max.hour && next.minute === max.minute ? max.second : 59;
    if (next.second > secondMax) next.second = secondMax;
    if (hmsToMs(next) > maxMs) return msToHms(maxMs);
    return next;
  }

  function calculateQuote(durationMs) {
    if (durationMs <= 0) return { durationMs: 0, tier: null, overLimit: false };
    const durationMinutes = durationMs / 60000;
    if (durationMinutes >= 60) return { durationMs, tier: null, overLimit: true };
    const tier = QUOTE_TIERS.find((item) => durationMinutes < item.maxMinutes) ?? null;
    return { durationMs, tier, overLimit: false };
  }

  function formatKrw(amount) {
    return `${amount.toLocaleString("ko-KR")}원`;
  }

  function formatDurationHuman(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hour = Math.floor(totalSec / 3600);
    const minute = Math.floor((totalSec % 3600) / 60);
    const second = totalSec % 60;
    if (hour > 0) return `${hour}시간 ${minute}분 ${second}초`;
    if (minute > 0) return `${minute}분 ${second}초`;
    return `${second}초`;
  }

  function formatSegmentClock(ms) {
    const { hour, minute, second } = msToHms(ms);
    if (hour > 0) return `${hour}시 ${minute}분 ${second}초`;
    if (minute > 0) return `${minute}분 ${second}초`;
    return `${second}초`;
  }

  function sumSelectedSegmentDurationMs(segments) {
    return segments
      .filter((segment) => segment.selected)
      .reduce((sum, segment) => sum + Math.max(0, segment.end_ms - segment.start_ms), 0);
  }

  function readMediaDuration(file) {
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
        if (durationMs > 0) resolve(durationMs);
        else reject(new Error("파일 재생 시간을 확인할 수 없습니다."));
      };

      media.onerror = () => {
        cleanup();
        reject(new Error("파일 재생 시간을 읽을 수 없습니다."));
      };

      media.src = url;
    });
  }

  return {
    QUOTE_TIERS,
    ZERO_HMS,
    msToHms,
    hmsToMs,
    clampHms,
    calculateQuote,
    formatKrw,
    formatDurationHuman,
    formatSegmentClock,
    sumSelectedSegmentDurationMs,
    readMediaDuration,
  };
})();
