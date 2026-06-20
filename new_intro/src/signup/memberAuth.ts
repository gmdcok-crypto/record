const RAILWAY_API_BASE = "https://record-production.up.railway.app";
const CLIENT_PWA_URL = "https://bulpen-user.netlify.app/";

export const TOKEN_KEY = "member_access_token";
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[#?!@$%^&*\-]).{8,16}$/;
export const EMAIL_PATTERN = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

const API_FETCH_OPTIONS: RequestInit = {
  cache: "no-store",
  credentials: "omit",
  headers: { Accept: "application/json" },
};

export function getApiBase(): string {
  const origin = window.location.origin;
  const host = window.location.hostname;

  if (host.endsWith(".netlify.app") || host.endsWith(".github.io")) {
    return RAILWAY_API_BASE;
  }
  if (origin === "null" || origin.startsWith("file:")) {
    return RAILWAY_API_BASE;
  }
  if (host === "record-production.up.railway.app") {
    return origin;
  }
  return origin || RAILWAY_API_BASE;
}

export function formatApiError(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => {
      if (item && typeof item === "object" && ("msg" in item || "message" in item)) {
        const record = item as { msg?: string; message?: string };
        return record.msg || record.message || String(item);
      }
      return String(item);
    }).join(", ");
  }
  return fallback;
}

async function readJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("empty_response");
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_response");
  }
}

export async function memberFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...API_FETCH_OPTIONS,
    ...options,
    headers: {
      ...(API_FETCH_OPTIONS.headers as Record<string, string>),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

export async function checkEmailAvailability(email: string): Promise<{ ok: boolean; message: string }> {
  const res = await memberFetch(
    `${getApiBase()}/api/member/auth/check-email?email=${encodeURIComponent(email)}`
  );
  let data: Record<string, unknown>;
  try {
    data = await readJsonResponse(res);
  } catch {
    return { ok: false, message: "서버 응답 오류입니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!res.ok) {
    return { ok: false, message: formatApiError(data.detail, "이메일 확인에 실패했습니다.") };
  }
  if (data.available) {
    return { ok: true, message: "사용 가능한 이메일입니다." };
  }
  return { ok: false, message: "이미 사용 중인 이메일입니다." };
}

export async function signupMember(payload: {
  name: string;
  email: string;
  password: string;
  identityVerificationId?: string;
}): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const res = await memberFetch(`${getApiBase()}/api/member/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      password: payload.password,
      identityVerificationId: payload.identityVerificationId,
    }),
  });
  let data: Record<string, unknown>;
  try {
    data = await readJsonResponse(res);
  } catch {
    return { ok: false, message: "서버 응답 오류입니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!res.ok) {
    return { ok: false, message: formatApiError(data.detail, "회원가입에 실패했습니다.") };
  }
  const token = typeof data.access_token === "string" ? data.access_token : "";
  if (!token) {
    return { ok: false, message: "회원가입에 실패했습니다." };
  }
  return { ok: true, token };
}

export function redirectAfterSignup(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  const clientOrigin = new URL(CLIENT_PWA_URL).origin;
  if (clientOrigin === window.location.origin) {
    window.location.href = CLIENT_PWA_URL;
    return;
  }
  window.location.href = `${CLIENT_PWA_URL}#token=${encodeURIComponent(token)}`;
}
