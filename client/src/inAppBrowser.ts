const DISMISS_KEY = "in_app_browser_banner_dismissed";

export function isKakaoInAppBrowser(): boolean {
  return /kakao/i.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export type InAppBrowserPlatform = "android" | "ios";

export function getKakaoInAppPlatform(): InAppBrowserPlatform | null {
  if (!isKakaoInAppBrowser()) return null;
  if (isAndroid()) return "android";
  if (isIOS()) return "ios";
  return null;
}

export function isInAppBrowserBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInAppBrowserBanner(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // no-op
  }
}

export function openInChrome(url: string): void {
  const path = url.replace(/^https?:\/\//i, "");
  const intent =
    `intent://${path}#Intent;` +
    "scheme=https;" +
    "package=com.android.chrome;" +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`;
  window.location.href = intent;
}

export function openInSafari(url: string): void {
  window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
}
