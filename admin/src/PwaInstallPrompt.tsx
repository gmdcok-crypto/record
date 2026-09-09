import { useEffect, useMemo, useState } from "react";
import { getKakaoInAppPlatform, isIOS } from "./inAppBrowser";
import "./styles/pwa-install.css";

const DISMISS_KEY = "admin_pwa_install_prompt_dismissed_at_v2";
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type GuideMode = "none" | "ios" | "android" | "desktop";

function isStandaloneDisplay(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // no-op
  }
}

function isIosInstallableBrowser(): boolean {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  if (/CriOS|FxiOS|EdgiOS/i.test(ua)) return false;
  return true;
}

function isAndroidLike(): boolean {
  return /Android/i.test(navigator.userAgent || "");
}

function isMobileLike(): boolean {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|webOS|Mobile/i.test(ua)) return true;
  return (navigator.maxTouchPoints || 0) > 1 && window.matchMedia("(max-width: 1024px)").matches;
}

export default function PwaInstallPrompt() {
  const kakaoPlatform = useMemo(() => getKakaoInAppPlatform(), []);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [guideMode, setGuideMode] = useState<GuideMode>("none");

  useEffect(() => {
    if (kakaoPlatform) return;
    if (isStandaloneDisplay()) return;
    if (isDismissedRecently()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setGuideMode("none");
      setVisible(true);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
      markDismissed();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    const timer = window.setTimeout(() => {
      if (isStandaloneDisplay() || isDismissedRecently()) return;
      setGuideMode((current) => {
        if (current !== "none") return current;
        if (isIosInstallableBrowser()) return "ios";
        if (isAndroidLike() || isMobileLike()) return "android";
        return "desktop";
      });
      setVisible(true);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [kakaoPlatform]);

  if (!visible || kakaoPlatform) return null;

  const handleDismiss = () => {
    markDismissed();
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) {
      if (isIosInstallableBrowser()) setGuideMode("ios");
      else if (isAndroidLike() || isMobileLike()) setGuideMode("android");
      else setGuideMode("desktop");
      return;
    }
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        markDismissed();
        setVisible(false);
      }
    } catch {
      // User closed the native sheet or browser blocked the prompt.
    } finally {
      setDeferredPrompt(null);
      setInstalling(false);
    }
  };

  const showManualGuide = !deferredPrompt && guideMode !== "none";

  return (
    <div className="pwa-install" role="dialog" aria-labelledby="pwa-install-title" aria-modal="false">
      <div className="pwa-install__card">
        <img className="pwa-install__icon" src="/icon-192.png" alt="" width={48} height={48} />
        <div className="pwa-install__copy">
          <p className="pwa-install__eyebrow">불판관리자 앱</p>
          <h2 className="pwa-install__title" id="pwa-install-title">
            홈 화면에 설치하고 더 빠르게 운영하세요
          </h2>
          {showManualGuide && guideMode === "ios" ? (
            <ol className="pwa-install__steps">
              <li>
                하단(또는 상단) <strong>공유</strong> 버튼을 누릅니다
              </li>
              <li>
                <strong>홈 화면에 추가</strong>를 선택합니다
              </li>
              <li>
                <strong>추가</strong>를 눌러 앱으로 설치합니다
              </li>
            </ol>
          ) : null}
          {showManualGuide && guideMode === "android" ? (
            <ol className="pwa-install__steps">
              <li>
                브라우저 <strong>메뉴(⋮)</strong>를 엽니다
              </li>
              <li>
                <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택합니다
              </li>
              <li>
                <strong>설치/추가</strong>를 확인해 주세요
              </li>
            </ol>
          ) : null}
          {showManualGuide && guideMode === "desktop" ? (
            <ol className="pwa-install__steps">
              <li>
                주소창 오른쪽 <strong>설치</strong> 아이콘을 확인합니다
              </li>
              <li>
                또는 브라우저 메뉴에서 <strong>앱 설치</strong>를 선택합니다
              </li>
            </ol>
          ) : null}
          {!showManualGuide ? (
            <p className="pwa-install__desc">
              설치하면 앱처럼 실행되고, 알림·빠른 접속이 쉬워집니다.
            </p>
          ) : null}
        </div>
        <div className="pwa-install__actions">
          {deferredPrompt ? (
            <button
              type="button"
              className="pwa-install__btn pwa-install__btn--primary"
              disabled={installing}
              onClick={() => void handleInstall()}
            >
              {installing ? "설치 준비 중…" : "앱 설치하기"}
            </button>
          ) : null}
          <button type="button" className="pwa-install__btn pwa-install__btn--ghost" onClick={handleDismiss}>
            나중에
          </button>
        </div>
      </div>
    </div>
  );
}
