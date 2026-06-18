export type PostPaymentStepId =
  | "save_snapshot"
  | "prepare_payment"
  | "portone_checkout"
  | "server_redirect"
  | "restore_session"
  | "payment_return"
  | "restore_files"
  | "wait_billing"
  | "create_project"
  | "upload_voice"
  | "refresh_workspace";

const STEP_LABEL_BY_ID: Record<PostPaymentStepId, string> = {
  save_snapshot: "결제 전 파일 저장",
  prepare_payment: "결제 준비",
  portone_checkout: "포트원 결제",
  server_redirect: "서버 결제 확인",
  restore_session: "로그인 세션 확인",
  payment_return: "결제 복귀 처리",
  restore_files: "파일 복원",
  wait_billing: "견적·구간 복원",
  create_project: "프로젝트 생성",
  upload_voice: "음성 업로드",
  refresh_workspace: "보관함 새로고침",
};

export function formatStepError(stepId: PostPaymentStepId, message: string): string {
  const label = STEP_LABEL_BY_ID[stepId] ?? stepId;
  return `${label}\n${message}`;
}

const PENDING_PORTONE_PAYMENT_KEY = "pending_portone_payment";
const POST_PAYMENT_RETURN_KEY = "post_payment_return";

export type PaymentReturnFlags = {
  paymentId: string | null;
  paymentConfirmed: boolean;
  paymentError: string | null;
};

function readPaymentReturnFlagsFromSearch(search: string): PaymentReturnFlags {
  const params = new URLSearchParams(search);
  return {
    paymentId: params.get("paymentId"),
    paymentConfirmed: params.get("payment_confirmed") === "1",
    paymentError: params.get("payment_error"),
  };
}

export function readPaymentReturnFlags(): PaymentReturnFlags {
  return readPaymentReturnFlagsFromSearch(window.location.search);
}

export function stashPaymentReturnFlags(): void {
  const flags = readPaymentReturnFlags();
  if (!flags.paymentId) return;
  try {
    sessionStorage.setItem(POST_PAYMENT_RETURN_KEY, JSON.stringify(flags));
  } catch {
    // no-op
  }
}

export function readStashedPaymentReturnFlags(): PaymentReturnFlags | null {
  try {
    const raw = sessionStorage.getItem(POST_PAYMENT_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PaymentReturnFlags>;
    if (!parsed.paymentId) return null;
    return {
      paymentId: parsed.paymentId,
      paymentConfirmed: Boolean(parsed.paymentConfirmed),
      paymentError: parsed.paymentError ?? null,
    };
  } catch {
    return null;
  }
}

export function clearStashedPaymentReturnFlags(): void {
  try {
    sessionStorage.removeItem(POST_PAYMENT_RETURN_KEY);
  } catch {
    // no-op
  }
}

function isMobilePaymentClient(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function shouldResumePostPaymentUpload(flags: PaymentReturnFlags): boolean {
  if (!flags.paymentId || flags.paymentError) return false;
  if (flags.paymentConfirmed) return true;
  // Mobile PortOne return often keeps only paymentId when PWA reloads or query params are trimmed.
  if (isMobilePaymentClient()) return true;
  try {
    const raw = window.localStorage.getItem(PENDING_PORTONE_PAYMENT_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as { paymentId?: string };
    return pending.paymentId === flags.paymentId;
  } catch {
    return false;
  }
}

export function resolvePaymentReturnFlags(): PaymentReturnFlags {
  const fromUrl = readPaymentReturnFlags();
  const stashed = readStashedPaymentReturnFlags();
  if (!fromUrl.paymentId) {
    return stashed ?? fromUrl;
  }
  if (!stashed || stashed.paymentId !== fromUrl.paymentId) {
    return fromUrl;
  }
  return {
    paymentId: fromUrl.paymentId,
    paymentConfirmed: fromUrl.paymentConfirmed || stashed.paymentConfirmed,
    paymentError: fromUrl.paymentError ?? stashed.paymentError,
  };
}
