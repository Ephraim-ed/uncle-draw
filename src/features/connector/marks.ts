import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Text the connector made was measured with estimated font metrics (no real
 * fonts on the server). The editor re-measures tagged elements and clears the
 * tag (AI-6, remeasure.ts).
 */
export const MEASURE_KEY = "udMeasure";

/** Session ids of the connector's live edits start with this (AI-6). */
export const CONNECTOR_SESSION_PREFIX = "claude-";

/** Tags text elements and the shapes holding them. */
export function markForMeasure(els: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const containers = new Set(
    els.flatMap((el) => (el.type === "text" && el.containerId ? [el.containerId] : [])),
  );
  return els.map((el) =>
    el.type === "text" || containers.has(el.id)
      ? ({ ...el, customData: { ...el.customData, [MEASURE_KEY]: true } } as ExcalidrawElement)
      : el,
  );
}
