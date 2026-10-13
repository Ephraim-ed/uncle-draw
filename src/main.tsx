import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { env } from "./lib/env";
import { canonicalRedirect } from "./lib/site";
import "./styles/index.css";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

// One public address: visitors on another alias move to the same page there,
// so sign-in (whose PKCE code is tied to one origin) and share links agree.
const canonical = canonicalRedirect(window.location, env.siteUrl);

if (canonical) {
  window.location.replace(canonical);
} else {
  // Excalidraw loads its fonts from here instead of esm.sh (tech §4.1). Set
  // before the editor chunk is ever imported.
  window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw-assets/`;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
