import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type El = ExcalidrawElement;

const freshId = () => crypto.randomUUID();
const freshNonce = () => crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;

/**
 * A copy of `elements` with new ids (and groups), its top-left corner at
 * `at`. Labels, arrow bindings and frames point at the copies; links to
 * anything left behind are dropped. For inserting a saved template.
 */
export function cloneElements(elements: readonly El[], at: { x: number; y: number }): El[] {
  const live = elements.filter((el) => !el.isDeleted);
  if (live.length === 0) return [];
  const [x1, y1] = getCommonBounds(live);
  const dx = at.x - x1;
  const dy = at.y - y1;
  const ids = new Map(live.map((el) => [el.id, freshId()]));
  const groups = new Map<string, string>();
  const group = (id: string) => {
    if (!groups.has(id)) groups.set(id, freshId());
    return groups.get(id)!;
  };
  const remap = (id: string | null | undefined) => (id && ids.has(id) ? ids.get(id)! : null);
  const now = Date.now();
  return live.map((el) => {
    const copy: Record<string, unknown> = {
      ...el,
      id: ids.get(el.id),
      x: el.x + dx,
      y: el.y + dy,
      groupIds: el.groupIds.map(group),
      frameId: remap(el.frameId),
      boundElements:
        el.boundElements?.filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id)! })) ?? null,
      index: null,
      version: 1,
      versionNonce: freshNonce(),
      updated: now,
    };
    if (el.type === "text") copy.containerId = remap(el.containerId);
    if ("startBinding" in el) {
      copy.startBinding =
        el.startBinding && ids.has(el.startBinding.elementId)
          ? { ...el.startBinding, elementId: ids.get(el.startBinding.elementId)! }
          : null;
      copy.endBinding =
        el.endBinding && ids.has(el.endBinding.elementId)
          ? { ...el.endBinding, elementId: ids.get(el.endBinding.elementId)! }
          : null;
    }
    return copy as unknown as El;
  });
}

/**
 * The selected elements plus what belongs to them (container labels, arrow
 * labels), leaving out images, whose files belong to their board.
 */
export function selectionForTemplate(
  elements: readonly El[],
  selectedIds: Readonly<Record<string, true | boolean>>,
): { elements: El[]; skippedImages: number } {
  const live = elements.filter((el) => !el.isDeleted);
  const picked = new Set(live.filter((el) => selectedIds[el.id]).map((el) => el.id));
  for (const el of live) {
    if (el.type === "text" && el.containerId && picked.has(el.containerId)) picked.add(el.id);
  }
  const chosen = live.filter((el) => picked.has(el.id));
  const kept = chosen.filter((el) => el.type !== "image");
  return {
    elements: kept.map((el) => ({ ...el, index: null }) as El),
    skippedImages: chosen.length - kept.length,
  };
}
