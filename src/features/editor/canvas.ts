import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";

/** Where something `width` × `height` goes to sit in the middle of the view (scene coords), on the grid if it's on. */
export function centeredIn(s: AppState, width: number, height: number): { x: number; y: number } {
  const c = viewportCoordsToSceneCoords(
    { clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 },
    s,
  );
  return { x: snapToGrid(s, c.x - width / 2), y: snapToGrid(s, c.y - height / 2) };
}

export function snapToGrid(s: AppState, v: number): number {
  return s.gridModeEnabled && s.gridSize ? Math.round(v / s.gridSize) * s.gridSize : v;
}
