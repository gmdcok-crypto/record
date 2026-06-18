const MOBILE_PREPAYMENT_UPLOAD_KEY = "mobile_prepayment_upload";

export type MobilePrePaymentUpload = {
  paymentId: string;
  projectTitle: string;
  fileCount: number;
  completedAt: number;
};

export function saveMobilePrePaymentUpload(result: MobilePrePaymentUpload): void {
  try {
    localStorage.setItem(MOBILE_PREPAYMENT_UPLOAD_KEY, JSON.stringify(result));
  } catch {
    // no-op
  }
}

export function readMobilePrePaymentUpload(paymentId: string): MobilePrePaymentUpload | null {
  try {
    const raw = localStorage.getItem(MOBILE_PREPAYMENT_UPLOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobilePrePaymentUpload;
    if (!parsed?.paymentId || parsed.paymentId !== paymentId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearMobilePrePaymentUpload(): void {
  try {
    localStorage.removeItem(MOBILE_PREPAYMENT_UPLOAD_KEY);
  } catch {
    // no-op
  }
}
