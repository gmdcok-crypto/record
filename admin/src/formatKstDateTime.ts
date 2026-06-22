const KST_TIMEZONE = "Asia/Seoul";

function parseServerDateTime(value: string): Date {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  return new Date(`${trimmed}Z`);
}

const KST_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: KST_TIMEZONE,
};

const KST_DATE_TIME_COMPACT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: KST_TIMEZONE,
};

export function formatKstDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return parseServerDateTime(value).toLocaleString("ko-KR", KST_DATE_TIME_OPTIONS);
  } catch {
    return value;
  }
}

export function formatKstDateTimeCompact(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return parseServerDateTime(value).toLocaleString("ko-KR", KST_DATE_TIME_COMPACT_OPTIONS);
  } catch {
    return value;
  }
}

export function todayKstDateKey(reference = new Date()): string {
  return reference.toLocaleDateString("en-CA", { timeZone: KST_TIMEZONE });
}

export function monthStartKstDateKey(reference = new Date()): string {
  const today = todayKstDateKey(reference);
  return `${today.slice(0, 7)}-01`;
}

export function getKstDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return parseServerDateTime(value).toLocaleDateString("en-CA", { timeZone: KST_TIMEZONE });
  } catch {
    return null;
  }
}
