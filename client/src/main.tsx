import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SharedTranscriptPage from "./SharedTranscriptPage";
import "./index.css";

const shareMatch = window.location.pathname.match(/^\/share\/transcript\/([^/]+)$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {shareMatch ? <SharedTranscriptPage token={decodeURIComponent(shareMatch[1])} /> : <App />}
  </StrictMode>,
);
