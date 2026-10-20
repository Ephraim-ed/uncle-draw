import { ROUNDNESS, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
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
 * each part. Which tick belongs to which box, and which row a cell is in, is
 * worked out from geometry, so copies, pastes and duplicates keep working.
 */

export type TablePart = "cell" | "checkbox" | "tick";
const PART_KEY = "udTable";

export function tablePart(el: ExcalidrawElement | null | undefined): TablePart | null {
  const part: unknown = el?.customData?.[PART_KEY];
  return part === "cell" || part === "checkbox" || part === "tick" ? part : null;
}

// --- Building ------------------------------------------------------------------

export interface TableOptions {
  /** Body rows, not counting the header. */
  rows: number;
  /** Text columns, not counting the checkbox column. */
  cols: number;
  header: boolean;
  /** A checkbox at the start of each body row. */
  checkboxes: boolean;
}

export interface TableStyle {
  strokeColor: string;
  roughness: number;
  /** Body cells are filled with the canvas color, so a click anywhere in a cell hits it. */
  fill: string;
}

export const TABLE_LIMITS = { rows: { min: 1, max: 30 }, cols: { min: 1, max: 12 } } as const;
export const CELL_WIDTH = 160;
export const ROW_HEIGHT = 48;
export const CHECK_COLUMN_WIDTH = 56;
export const BOX_SIZE = 22;
/** Excalidraw's light gray; dark mode inverts it with the rest of the canvas. */
const HEADER_FILL = "#e9ecef";

export function tableSize(o: TableOptions): { width: number; height: number } {
  return {
    width: (o.checkboxes ? CHECK_COLUMN_WIDTH : 0) + o.cols * CELL_WIDTH,
    height: (o.rows + (o.header ? 1 : 0)) * ROW_HEIGHT,
  };
}

type Skeleton = ExcalidrawElementSkeleton & { customData?: Record<string, unknown> };

/** New elements carry no index; Excalidraw assigns one where they're inserted. */
function unordered(skeletons: Skeleton[]): ExcalidrawElement[] {
  return convertToExcalidrawElements(skeletons).map((el) => ({ ...el, index: null }));
}

/** A table with its top-left corner at (x, y), grouped and ready to insert. */
export function buildTable(
  o: TableOptions,
  at: { x: number; y: number },
  style: TableStyle,
  groupId: string = crypto.randomUUID(),
): ExcalidrawElement[] {
  const columns = [
    ...(o.checkboxes ? [CHECK_COLUMN_WIDTH] : []),
    ...Array.from({ length: o.cols }, () => CELL_WIDTH),
  ];
  const rowCount = o.rows + (o.header ? 1 : 0);
  const common = {
    strokeColor: style.strokeColor,
    roughness: style.roughness,
    groupIds: [groupId],
  };
  const cells: Skeleton[] = [];
  const boxes: Skeleton[] = [];
  for (let r = 0; r < rowCount; r++) {
    const isHeader = o.header && r === 0;
    const y = at.y + r * ROW_HEIGHT;
    let x = at.x;
    columns.forEach((width, c) => {
      cells.push({
        type: "rectangle",
        x,
        y,
        width,
        height: ROW_HEIGHT,
        backgroundColor: isHeader ? HEADER_FILL : style.fill,
        fillStyle: "solid",
        strokeWidth: 1,
        roundness: null,
        customData: { [PART_KEY]: "cell" },
        ...common,
      });
      if (o.checkboxes && c === 0 && !isHeader) {
        boxes.push({
          type: "rectangle",
          x: x + (width - BOX_SIZE) / 2,
          y: y + (ROW_HEIGHT - BOX_SIZE) / 2,
          width: BOX_SIZE,
          height: BOX_SIZE,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
          customData: { [PART_KEY]: "checkbox" },
          ...common,
        });
      }
      x += width;
    });
  }
  // Boxes after all cells, so they're drawn on top.
  return unordered([...cells, ...boxes]);
}

// --- Geometry --------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/** [minX, minY, maxX, maxY] before rotation; linear elements are bounded by their points. */
function localBox(el: ExcalidrawElement): [number, number, number, number] {
  if ("points" in el && el.points.length > 0) {
    const xs = el.points.map((p) => p[0]);
    const ys = el.points.map((p) => p[1]);
    return [el.x + Math.min(...xs), el.y + Math.min(...ys), el.x + Math.max(...xs), el.y + Math.max(...ys)];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

function centerOf(el: ExcalidrawElement): Point {
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
function contains(el: ExcalidrawElement, p: Point, slop = 0): boolean {
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

function makeTick(box: ExcalidrawElement): ExcalidrawElement {
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

// --- Keeping rows lined up ----------------------------------------------------------

const EPS = 0.5;

/**
 * Excalidraw makes a cell taller when its text wraps. This makes the rest of
 * that row as tall and pushes the rows below down so nothing overlaps. Rows
 * never shrink on their own. Returns the whole scene, or null when nothing
 * needs to move (or the table is rotated).
 */
export function fitRow(elements: readonly ExcalidrawElement[], cellId: string): ExcalidrawElement[] | null {
  const cell = elements.find((el) => el.id === cellId);
  const groupId = cell?.groupIds[0];
  if (!cell || cell.isDeleted || tablePart(cell) !== "cell" || !groupId) return null;
  const members = elements.filter((el) => !el.isDeleted && el.groupIds[0] === groupId);
  if (members.some((el) => el.angle !== 0)) return null;

  const byId = new Map(members.map((el) => [el.id, el]));
  const cells = members.filter((el) => tablePart(el) === "cell");
  const boxes = members.filter((el) => tablePart(el) === "checkbox");
  const ticks = members.filter((el) => tablePart(el) === "tick");
  const top = cell.y;
  const row = cells.filter((c) => Math.abs(c.y - top) < EPS);
  const height = Math.max(...row.map((c) => c.height));

  const moves = new Map<string, { dy: number; height?: number }>();
  const inRow = new Set<string>();
  const move = (el: ExcalidrawElement, dy: number) => {
    inRow.add(el.id);
    if (dy > EPS) moves.set(el.id, { dy });
  };
  for (const c of row) {
    inRow.add(c.id);
    const grow = height - c.height;
    if (grow > EPS) moves.set(c.id, { dy: 0, height });
    const textId = c.boundElements?.find((b) => b.type === "text")?.id;
    const text = textId ? byId.get(textId) : undefined;
    if (text?.type === "text") {
      move(text, text.verticalAlign === "top" ? 0 : text.verticalAlign === "bottom" ? grow : grow / 2);
    }
    for (const box of boxes) {
      if (!contains(c, centerOf(box))) continue;
      move(box, grow / 2);
      for (const t of ticks) if (contains(box, centerOf(t))) move(t, grow / 2);
    }
  }

  const below = cells.filter((c) => c.y > top + EPS);
  if (below.length > 0) {
    const nextTop = Math.min(...below.map((c) => c.y));
    const push = top + height - nextTop;
    if (push > EPS) {
      for (const el of members) {
        if (!inRow.has(el.id) && localBox(el)[1] >= nextTop - EPS) moves.set(el.id, { dy: push });
      }
    }
  }

  if (moves.size === 0) return null;
  return elements.map((el) => {
    const m = moves.get(el.id);
    if (!m) return el;
    return newElementWith(
      el,
      m.height === undefined ? { y: el.y + m.dy } : { y: el.y + m.dy, height: m.height },
    );
  });
}
