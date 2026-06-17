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

export function readPaymentReturnFlags(): { paymentId: string | null; paymentConfirmed: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    paymentId: params.get("paymentId"),
    paymentConfirmed: params.get("payment_confirmed") === "1",
  };
}
