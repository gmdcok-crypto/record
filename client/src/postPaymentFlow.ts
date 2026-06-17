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

export type PostPaymentStepStatus = "pending" | "running" | "ok" | "error" | "skipped";

export type PostPaymentStepTrace = {
  id: PostPaymentStepId;
  label: string;
  status: PostPaymentStepStatus;
  detail?: string;
};

export const POST_PAYMENT_STEP_ORDER: Array<{ id: PostPaymentStepId; label: string }> = [
  { id: "save_snapshot", label: "1. 결제 전 파일 저장 (IndexedDB)" },
  { id: "prepare_payment", label: "2. 결제 준비 API" },
  { id: "portone_checkout", label: "3. 포트원 결제" },
  { id: "server_redirect", label: "4. 서버 결제 확인 리다이렉트" },
  { id: "restore_session", label: "5. 로그인 세션 확인" },
  { id: "payment_return", label: "6. 결제 복귀 처리" },
  { id: "restore_files", label: "7. 파일 복원 (IndexedDB)" },
  { id: "wait_billing", label: "8. 견적·구간 복원" },
  { id: "create_project", label: "9. 프로젝트 생성 API" },
  { id: "upload_voice", label: "10. 음성 업로드 API" },
  { id: "refresh_workspace", label: "11. 보관함 새로고침" },
];

const STEP_LABEL_BY_ID = Object.fromEntries(POST_PAYMENT_STEP_ORDER.map((step) => [step.id, step.label])) as Record<
  PostPaymentStepId,
  string
>;

export function stepLabel(stepId: PostPaymentStepId): string {
  return STEP_LABEL_BY_ID[stepId] ?? stepId;
}

export function formatStepError(stepId: PostPaymentStepId, message: string): string {
  return `${stepLabel(stepId)}\n${message}`;
}

export function initialFlowTrace(): PostPaymentStepTrace[] {
  return POST_PAYMENT_STEP_ORDER.map((step) => ({
    id: step.id,
    label: step.label,
    status: "pending",
  }));
}

export function upsertFlowTrace(
  trace: PostPaymentStepTrace[],
  stepId: PostPaymentStepId,
  status: PostPaymentStepStatus,
  detail?: string,
): PostPaymentStepTrace[] {
  const label = stepLabel(stepId);
  const found = trace.some((entry) => entry.id === stepId);
  if (!found) {
    return [...trace, { id: stepId, label, status, detail }];
  }
  return trace.map((entry) => (entry.id === stepId ? { ...entry, status, detail: detail ?? entry.detail } : entry));
}

export function readPaymentReturnFlags(): { paymentId: string | null; paymentConfirmed: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    paymentId: params.get("paymentId"),
    paymentConfirmed: params.get("payment_confirmed") === "1",
  };
}
