import { isKakaoInAppBrowser } from "./inAppBrowser";

export function isMobileLikeClient(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isNarrowViewport = window.matchMedia?.("(max-width: 768px)")?.matches ?? false;
  return isMobileUserAgent || isNarrowViewport;
}

export function shouldForceMobilePaymentRedirect(): boolean {
  return isMobileLikeClient();
}

export function shouldPreferBackendUpload(): boolean {
  return isMobileLikeClient() || isKakaoInAppBrowser();
}

export function buildPaymentRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}
