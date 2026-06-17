import { useMemo, useState } from "react";
import {
  dismissInAppBrowserBanner,
  getKakaoInAppPlatform,
  isInAppBrowserBannerDismissed,
  openInChrome,
  openInSafari,
} from "./inAppBrowser";

export default function InAppBrowserBanner() {
  const platform = useMemo(() => getKakaoInAppPlatform(), []);
  const [dismissed, setDismissed] = useState(() => isInAppBrowserBannerDismissed());

  if (!platform || dismissed) return null;

  const currentUrl = window.location.href;

  const handleOpenExternal = () => {
    if (platform === "android") {
      openInChrome(currentUrl);
      return;
    }
    openInSafari(currentUrl);
  };

  const handleDismiss = () => {
    dismissInAppBrowserBanner();
    setDismissed(true);
  };

  const isAndroid = platform === "android";

  return (
    <div className="sticky top-0 z-50 border-b border-amber-500/30 bg-amber-950/95 px-4 py-3 text-amber-50 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-100">
            {isAndroid ? "카카오톡 브라우저에서는 일부 기능이 제한될 수 있습니다." : "카카오톡 브라우저에서는 앱 설치와 알림이 제한될 수 있습니다."}
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            {isAndroid
              ? "크롬에서 열면 PWA 설치와 알림을 정상적으로 이용할 수 있습니다."
              : "Safari에서 열거나, 우측 상단 ··· → Safari에서 열기를 선택해 주세요."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleOpenExternal}
            className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
          >
            {isAndroid ? "크롬에서 열기" : "Safari에서 열기"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-xl border border-amber-500/40 px-3 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-500/10"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
