/**
 * Placing our floating UI over the canvas. On desktop, Excalidraw's style
 * panel covers the left edge while something is selected (its phone layout
 * starts below 730 px), and it sits above our overlays, so they keep right of it.
 */
const PANEL_EDGE = 232;
const PHONE_MAX_WIDTH = 730;
const EDGE = 8;

export function leftEdge(): number {
  return window.innerWidth >= PHONE_MAX_WIDTH ? PANEL_EDGE : EDGE;
}
