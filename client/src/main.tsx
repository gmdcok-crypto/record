import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import InAppBrowserBanner from "./InAppBrowserBanner";
import SharedTranscriptPage from "./SharedTranscriptPage";
import "./index.css";

const shareMatch = window.location.pathname.match(/^\/share\/transcript\/([^/]+)$/);

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
    {shareMatch ? <SharedTranscriptPage token={decodeURIComponent(shareMatch[1])} /> : <App />}
  </StrictMode>,
);
