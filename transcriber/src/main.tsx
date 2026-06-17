import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { clearStaleClientPwaServiceWorkers } from "./serviceWorkerCleanup";

void (async () => {
  const removed = await clearStaleClientPwaServiceWorkers();
  if (removed) {
    window.location.reload();
    return;
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
