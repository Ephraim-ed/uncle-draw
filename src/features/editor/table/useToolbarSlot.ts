import { useEffect, useState } from "react";

const MISSING_AFTER_MS = 1500;

/**
 * A slot in Excalidraw's own toolbar, right after the eraser (EDIT-7/8).
 *
 * Excalidraw 0.18 has no API for extra tools, so this is the one place we
 * reach into its markup: it finds the eraser by its test id and keeps our
 * slot next to it whenever the toolbar re-renders (view mode, phone layout).
 * When there's no toolbar for a while, `missing` turns on and the footer offers the same tools.
 */
export function useToolbarSlot(host: HTMLElement | null): { slot: HTMLElement | null; missing: boolean } {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Only "missing" after a moment, so the footer fallback doesn't flash while Excalidraw loads.
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!host) return;
    const span = document.createElement("span");
    span.className = "ud-toolbar-tools";
    let frame = 0;
    let missingTimer: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      frame = 0;
      const anchor = host.querySelector('[data-testid="toolbar-eraser"]')?.closest("label");
      if (!anchor) {
        span.remove();
        setSlot(null);
        missingTimer ??= setTimeout(() => setMissing(true), MISSING_AFTER_MS);
        return;
      }
      clearTimeout(missingTimer);
      missingTimer = undefined;
      setMissing(false);
      if (anchor.nextSibling !== span) anchor.after(span);
      setSlot(span);
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(place);
    });
    observer.observe(host, { childList: true, subtree: true });
    frame = requestAnimationFrame(place);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(missingTimer);
      span.remove();
      setSlot(null);
    };
  }, [host]);
  return { slot, missing };
}
