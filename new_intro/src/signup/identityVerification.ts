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
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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

export type PortOnePublicConfig = {
  portoneStoreId: string;
  portonePaymentChannelKey: string;
  portoneIdentityChannelKey: string;
  portoneEnv: string;
  portonePaymentEnabled: boolean;
  portoneIdentityEnabled: boolean;
};

export async function fetchPortOnePublicConfig(): Promise<PortOnePublicConfig> {
  const res = await fetch(`${getApiBase()}/api/public-config`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<PortOnePublicConfig>;
  return {
    portoneStoreId: data.portoneStoreId?.trim() ?? "",
    portonePaymentChannelKey: data.portonePaymentChannelKey?.trim() ?? "",
    portoneIdentityChannelKey: data.portoneIdentityChannelKey?.trim() ?? "",
    portoneEnv: data.portoneEnv?.trim() ?? "live",
    portonePaymentEnabled: Boolean(data.portonePaymentEnabled),
    portoneIdentityEnabled: Boolean(data.portoneIdentityEnabled),
  };
}

function getApiBase(): string {
  const origin = window.location.origin;
  const host = window.location.hostname;
  const railwayApiBase = "https://record-production.up.railway.app";

  if (host.endsWith(".netlify.app") || host.endsWith(".github.io")) {
    return railwayApiBase;
  }
  if (origin === "null" || origin.startsWith("file:")) {
    return railwayApiBase;
  }
  if (host === "record-production.up.railway.app") {
    return origin;
  }
  return origin || railwayApiBase;
}

export async function lookupMemberIdentityVerification(identityVerificationId: string): Promise<{
  name: string | null;
  phone: string | null;
}> {
  const res = await fetch(`${getApiBase()}/api/member/auth/identity-verifications/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identityVerificationId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiError(data.detail, "본인인증 결과를 불러오지 못했습니다."));
  }
  return {
    name: typeof data.name === "string" ? data.name : null,
    phone: typeof data.phone === "string" ? data.phone : null,
  };
}

function formatApiError(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && ("msg" in item || "message" in item)) {
          const record = item as { msg?: string; message?: string };
          return record.msg || record.message || String(item);
        }
        return String(item);
      })
      .join(", ");
  }
  return fallback;
}
