/** PortOne/KCP ordr_idxx: 영문·숫자만, 40자 이하 */
export function createIdentityVerificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `iv${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 40);
  }
  const suffix = Math.random().toString(36).slice(2, 12);
  return `iv${Date.now()}${suffix}`.slice(0, 40);
}

export function readPortOneIdentityVerificationIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("identityVerificationId");
}

export function clearPortOneIdentityVerificationIdFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("identityVerificationId");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function formatVerifiedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}
