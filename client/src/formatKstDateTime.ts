const KST_TIMEZONE = "Asia/Seoul";

function parseServerDateTime(value: string): Date {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  // Backend stores UTC wall time without a timezone suffix.
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

export function formatKstDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return parseServerDateTime(value).toLocaleString("ko-KR", KST_DATE_TIME_OPTIONS);
  } catch {
    return value;
  }
}
