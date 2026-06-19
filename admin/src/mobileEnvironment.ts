export function isMobileLikeAdmin(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isNarrowViewport = window.matchMedia?.("(max-width: 1024px)")?.matches ?? false;
  return isMobileUserAgent || isNarrowViewport;
}
