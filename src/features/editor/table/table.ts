import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawElement, ExcalidrawLinearElement } from "@excalidraw/excalidraw/element/types";

/**
 * Tables (EDIT-7) are plain Excalidraw elements, so saving, live collab, undo,
 * export and share views need nothing extra:
 * - each cell is a rectangle, and its text is ordinary bound text;
 * - a checkbox is a small rectangle drawn on top of a cell;
 * - a tick is a three-point line drawn on top of its checkbox. A box is ticked
 *   while a live tick sits inside it.
 * All of them share the table's group (`groupIds[0]`), and customData tags
 * each part. Rows, columns and which tick belongs to which box are worked out
 * from geometry (grid.ts), so copies, pastes and duplicates keep working.
 */

export type TablePart = "cell" | "checkbox" | "tick";
export const PART_KEY = "udTable";
/** Extra cell tags: the header row, the checkbox column, the table's text alignment. */
export const HEADER_KEY = "udHeader";
export const CHECK_KEY = "udCheck";
export const ALIGN_KEY = "udAlign";

export function tablePart(el: ExcalidrawElement | null | undefined): TablePart | null {
  const part: unknown = el?.customData?.[PART_KEY];
  return part === "cell" || part === "checkbox" || part === "tick" ? part : null;
}

export const CELL_WIDTH = 160;
export const ROW_HEIGHT = 48;
export const CHECK_COLUMN_WIDTH = 56;
export const BOX_SIZE = 22;

type Skeleton = ExcalidrawElementSkeleton & { customData?: Record<string, unknown> };

/** New elements carry no index; Excalidraw assigns one where they're inserted. */
export function unordered(skeletons: Skeleton[]): ExcalidrawElement[] {
  return convertToExcalidrawElements(skeletons).map((el) => ({ ...el, index: null }));
}

// --- Geometry --------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/** [minX, minY, maxX, maxY] before rotation; linear elements are bounded by their points. */
export function localBox(el: ExcalidrawElement): [number, number, number, number] {
  if ("points" in el && el.points.length > 0) {
    const xs = el.points.map((p) => p[0]);
    const ys = el.points.map((p) => p[1]);
    return [el.x + Math.min(...xs), el.y + Math.min(...ys), el.x + Math.max(...xs), el.y + Math.max(...ys)];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

export function centerOf(el: ExcalidrawElement): Point {
  const [x1, y1, x2, y2] = localBox(el);
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

function rotate(p: Point, c: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Whether `p` (scene coords) is inside the element, honoring its rotation. */
export function contains(el: ExcalidrawElement, p: Point, slop = 0): boolean {
  const q = el.angle ? rotate(p, centerOf(el), -el.angle) : p;
  const [x1, y1, x2, y2] = localBox(el);
  return q.x >= x1 - slop && q.x <= x2 + slop && q.y >= y1 - slop && q.y <= y2 + slop;
}

const FILLABLE = new Set(["rectangle", "diamond", "ellipse"]);
const ALWAYS_OPAQUE = new Set(["image", "embeddable", "iframe"]);

/**
 * The checkbox under a scene point, if any. `slop` widens each box (for
 * fingers). A filled shape or image drawn over the box hides it from clicks.
 */
export function checkboxAt(
  elements: readonly ExcalidrawElement[],
  p: Point,
  slop = 0,
): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (el.isDeleted) continue;
    const part = tablePart(el);
    if (part === "checkbox") {
      if (contains(el, p, slop)) return el;
      continue;
    }
    if (part === "tick" || !contains(el, p)) continue;
    if (ALWAYS_OPAQUE.has(el.type) || (FILLABLE.has(el.type) && el.backgroundColor !== "transparent")) {
      return null;
    }
  }
  return null;
}

/** The topmost table cell under a scene point. */
export function cellAt(elements: readonly ExcalidrawElement[], p: Point): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (!el.isDeleted && tablePart(el) === "cell" && contains(el, p)) return el;
  }
  return null;
}

function ticksIn(elements: readonly ExcalidrawElement[], box: ExcalidrawElement): ExcalidrawElement[] {
  return elements.filter((el) => !el.isDeleted && tablePart(el) === "tick" && contains(box, centerOf(el)));
}

export function isTicked(elements: readonly ExcalidrawElement[], box: ExcalidrawElement): boolean {
  return ticksIn(elements, box).length > 0;
}

/** Whether a checkbox sits in this cell (such cells hold only their box, no text). */
export function hasCheckbox(elements: readonly ExcalidrawElement[], cell: ExcalidrawElement): boolean {
  return elements.some((el) => !el.isDeleted && tablePart(el) === "checkbox" && contains(cell, centerOf(el)));
}

// --- Ticking ---------------------------------------------------------------------

/** The tick's corners as fractions of the box; it overshoots the top-right like a quick pen mark. */
const TICK: readonly (readonly [number, number])[] = [
  [0.18, 0.52],
  [0.42, 0.8],
  [1.02, 0.04],
];

/** A tick for `box`, in the box's groups, frame and colors. */
export function makeTick(box: ExcalidrawElement): ExcalidrawElement {
  const abs = TICK.map(([fx, fy]) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height }));
  const origin = abs[0]!;
  const points = abs.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]);
  let { x, y } = origin;
  if (box.angle) {
    // Rotate the tick's own center around the box's center; Excalidraw then
    // rotates the tick about that center by the same angle.
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const own = {
      x: x + (Math.min(...xs) + Math.max(...xs)) / 2,
      y: y + (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const moved = rotate(own, centerOf(box), box.angle);
    x += moved.x - own.x;
    y += moved.y - own.y;
  }
  const [tick] = unordered([
    {
      type: "line",
      x,
      y,
      points: points as unknown as ExcalidrawLinearElement["points"],
      strokeColor: box.strokeColor,
      strokeWidth: box.strokeWidth,
      roughness: box.roughness,
      opacity: box.opacity,
      angle: box.angle,
      groupIds: [...box.groupIds],
      frameId: box.frameId,
      locked: box.locked,
      customData: { [PART_KEY]: "tick" },
    },
  ]);
  return tick!;
}

/**
 * Ticks or unticks a checkbox. Returns the whole scene (deleted elements
 * included) for updateScene; unticking deletes every tick in the box, so two
 * people ticking at once still untick in one click.
 */
export function toggleCheckbox(elements: readonly ExcalidrawElement[], boxId: string): ExcalidrawElement[] {
  const at = elements.findIndex((el) => el.id === boxId);
  const box = elements[at];
  if (!box || box.isDeleted) return [...elements];
  const ticks = new Set(ticksIn(elements, box).map((t) => t.id));
  if (ticks.size > 0) {
    return elements.map((el) => (ticks.has(el.id) ? newElementWith(el, { isDeleted: true }) : el));
  }
  return [...elements.slice(0, at + 1), makeTick(box), ...elements.slice(at + 1)];
}
