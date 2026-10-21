import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Where a shape must be (px inside the editor) to type into it in place:
 * clear of the toolbar, the footer and the style panel on the left.
 */
const SAFE = { left: 240, right: 80, top: 100, bottom: 100 };

/**
 * Selects a shape and opens its label editor, the way a double-click on it
 * would (Excalidraw has no API for this). `editingGroupId` is the group the
 * shape is inside of, like a table's cell. Scrolls the shape into view first
 * if it's hidden or under a panel.
 */
export function openLabelEditor(
  api: ExcalidrawImperativeAPI,
  host: HTMLElement,
  id: string,
  editingGroupId: string | null = null,
) {
  api.updateScene({ appState: { selectedElementIds: { [id]: true }, selectedGroupIds: {}, editingGroupId } });
  const center = () => {
    const el = api.getSceneElements().find((e) => e.id === id);
    return el
      ? sceneCoordsToViewportCoords(
          { sceneX: el.x + el.width / 2, sceneY: el.y + el.height / 2 },
          api.getAppState(),
        )
      : null;
  };
  const open = () => {
    const p = center();
    // The topmost canvas under the point is the one Excalidraw listens on, even where a panel covers it.
    const target = p
      ? document.elementsFromPoint(p.x, p.y).find((n) => n instanceof HTMLCanvasElement && host.contains(n))
      : null;
    if (!p || !target) return;
    target.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        view: window,
      }),
    );
  };
  requestAnimationFrame(() => {
    const p = center();
    if (!p) return;
    const r = host.getBoundingClientRect();
    const clear =
      p.x > r.left + SAFE.left &&
      p.x < r.right - SAFE.right &&
      p.y > r.top + SAFE.top &&
      p.y < r.bottom - SAFE.bottom;
    if (clear) {
      open();
      return;
    }
    const el = api.getSceneElements().find((e) => e.id === id);
    if (el) api.scrollToContent(el, { animate: false });
    requestAnimationFrame(() => requestAnimationFrame(open));
  });
}
