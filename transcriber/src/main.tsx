import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import InAppBrowserBanner from "./InAppBrowserBanner";
import PwaInstallPrompt from "./PwaInstallPrompt";
import "./index.css";
import { clearStaleClientPwaServiceWorkers } from "./serviceWorkerCleanup";

void (async () => {
  const removed = await clearStaleClientPwaServiceWorkers();
  if (removed) {
    window.location.reload();
    return;
  }

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      registration?.update().catch(() => undefined);
    },
    onNeedRefresh() {
      window.location.reload();
    },
    onOfflineReady() {
      // no-op
    },
  });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <InAppBrowserBanner />
      <App />
      <PwaInstallPrompt />
    </StrictMode>,
  );
})();
