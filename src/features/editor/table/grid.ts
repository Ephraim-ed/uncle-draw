import { ROUNDNESS, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import {
  ALIGN_KEY,
  BOX_SIZE,
  CELL_WIDTH,
  CHECK_COLUMN_WIDTH,
  CHECK_KEY,
  DIM_KEY,
  FILL_KEY,
  HEADER_KEY,
  PART_KEY,
  ROW_HEIGHT,
  centerOf,
  contains,
  makeTick,
  tablePart,
  unordered,
  type Point,
} from "./table";

/**
 * The table engine (EDIT-7). A table has no model of its own: `readPlan`
 * reads rows and columns back from where its cells sit, edits change the
 * plan, and `commit` lays every part out again in one pass, re-wrapping text
 * where a column changed width. Elements that end up unchanged keep their
 * version, so collaborators and undo only see real changes.
 */

type El = ExcalidrawElement;
type TextEl = ExcalidrawTextElement;

export type Align = "left" | "center" | "right";

/** Table-wide look. Fills are solid so a click anywhere in a cell hits it. */
export interface TableLook {
  headerFill: string;
  cellFill: string;
  border: string;
  borderWidth: number;
  align: Align;
  roughness: number;
  /** Fade the text of ticked rows (checkbox tables). */
  dimDone: boolean;
}

/** Font for text the table writes itself (pasted values). */
export interface TextStyle {
  fontSize: number;
  fontFamily: number;
  strokeColor: string;
}

/** Measuring and wrapping text needs real fonts, so it's injected (tests fake it). */
export interface TextEngine {
  /** A new text element bound to `containerId`, not yet measured. */
  create(
    o: TextStyle & {
      text: string;
      containerId: string;
      groupIds: readonly string[];
      frameId: string | null;
      textAlign: Align;
    },
  ): TextEl;
  /** Each text wrapped to its container's width (found in `containers`) and measured. */
  rewrap(texts: readonly TextEl[], containers: readonly El[]): TextEl[];
}

export interface TableOptions {
  /** Body rows, not counting the header. */
  rows: number;
  /** Text columns, not counting the checkbox column. */
  cols: number;
  header: boolean;
  /** A checkbox at the start of each body row. */
  checkboxes: boolean;
}

export const DEFAULT_HEADER_FILL = "#e9ecef";
/** Excalidraw's gap between a container and its text. */
const PAD = 5;
export const MIN_ROW_HEIGHT = BOX_SIZE + 2 * PAD + 4;
export const MIN_COL_WIDTH = 40;
export const MIN_CHECK_COL_WIDTH = BOX_SIZE + 2 * PAD + 4;
export const MAX_ROWS = 100;
export const MAX_COLS = 26;
/** Cells this close (scene px) share a row or column. */
const SNAP = 2;
/**
 * Opacity of a ticked row's text. Excalidraw's slider moves in steps of 10,
 * so 35 also marks text the table dimmed (and may brighten again).
 */
export const DIM_OPACITY = 35;

interface Slot {
  cell: El | null;
  text: TextEl | null;
  /** New content: a string replaces it ("" clears it); undefined keeps it. */
  value?: string;
  box: El | null;
  ticks: El[];
  /** Ticked or not after the commit; undefined keeps it. */
  tick?: boolean;
  /** The cell's own fill: a color, null to drop it, undefined to keep it. */
  fill?: string | null;
}

export interface Plan {
  groupId: string;
  /** groupIds for new parts: the table's group, then any groups it sits in. */
  groupIds: readonly string[];
  frameId: string | null;
  locked: boolean;
  x: number;
  y: number;
  colW: number[];
  rowH: number[];
  slots: Slot[][];
  header: boolean;
  checkCol: boolean;
  look: TableLook;
  font: TextStyle;
  /** Parts leaving the table. */
  removed: El[];
  /** Texts that take the table's alignment; the rest keep their own. */
  realign: "all" | Set<string>;
}

const emptySlot = (): Slot => ({ cell: null, text: null, box: null, ticks: [] });
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function cluster(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || v - out[out.length - 1]! > SNAP) out.push(v);
  }
  return out;
}
const indexIn = (starts: readonly number[], v: number) => starts.findIndex((s) => Math.abs(s - v) <= SNAP);

// --- Reading -------------------------------------------------------------------------

/** The table whose group is `groupId`, or null (no cells, or rotated). */
export function readPlan(elements: readonly El[], groupId: string, font: TextStyle): Plan | null {
  const members = elements.filter((el) => !el.isDeleted && el.groupIds[0] === groupId);
  if (members.length === 0 || members.some((el) => el.angle !== 0)) return null;
  let cells = members.filter((el) => tablePart(el) === "cell");
  // A cell dragged out of the grid would add a whole row and column; leave it be.
  for (let pass = 0; pass < 2 && cells.length > 0; pass++) {
    const xs = cluster(cells.map((c) => c.x));
    const ys = cluster(cells.map((c) => c.y));
    const perCol = xs.map((x) => cells.filter((c) => Math.abs(c.x - x) <= SNAP).length);
    const perRow = ys.map((y) => cells.filter((c) => Math.abs(c.y - y) <= SNAP).length);
    cells = cells.filter(
      (c) =>
        perCol[indexIn(xs, c.x)]! >= Math.ceil(ys.length / 2) &&
        perRow[indexIn(ys, c.y)]! >= Math.ceil(xs.length / 2),
    );
  }
  if (cells.length === 0) return null;

  const xs = cluster(cells.map((c) => c.x));
  const ys = cluster(cells.map((c) => c.y));
  const slots: Slot[][] = ys.map(() => xs.map(emptySlot));
  for (const cell of cells) {
    const slot = slots[indexIn(ys, cell.y)]![indexIn(xs, cell.x)]!;
    if (!slot.cell) slot.cell = cell;
  }
  const colW = xs.map((x, c) =>
    c < xs.length - 1
      ? xs[c + 1]! - x
      : Math.max(...cells.filter((k) => indexIn(xs, k.x) === c).map((k) => k.width)),
  );
  // Excalidraw grows a cell downward to fit its text, so a row is as tall as its tallest cell.
  const rowH = ys.map((y, r) =>
    Math.max(
      r < ys.length - 1 ? ys[r + 1]! - y : 0,
      ...cells.filter((k) => indexIn(ys, k.y) === r).map((k) => k.height),
    ),
  );

  const plan: Plan = {
    groupId,
    groupIds: cells[0]!.groupIds,
    frameId: cells[0]!.frameId,
    locked: cells.some((c) => c.locked),
    x: xs[0]!,
    y: ys[0]!,
    colW,
    rowH,
    slots,
    header: false,
    checkCol: false,
    look: {
      headerFill: DEFAULT_HEADER_FILL,
      cellFill: "#ffffff",
      border: "#1e1e1e",
      borderWidth: 1,
      align: "center",
      roughness: 1,
      dimDone: false,
    },
    font,
    removed: [],
    realign: new Set(),
  };

  const byCell = new Map(slots.flat().flatMap((s) => (s.cell ? [[s.cell.id, s] as const] : [])));
  for (const el of members) {
    if (el.type !== "text" || !el.containerId) continue;
    const slot = byCell.get(el.containerId);
    if (slot && !slot.text) slot.text = el;
  }
  for (const box of members.filter((el) => tablePart(el) === "checkbox")) {
    const at = slotAt(plan, centerOf(box));
    const slot = at && slots[at.row]![at.col]!;
    if (slot && !slot.box) slot.box = box;
  }
  for (const tick of members.filter((el) => tablePart(el) === "tick")) {
    const at = slotAt(plan, centerOf(tick));
    const slot = at && slots[at.row]![at.col]!;
    if (slot?.box && contains(slot.box, centerOf(tick))) slot.ticks.push(tick);
  }

  plan.header = slots[0]!.some((s) => s.cell?.customData?.[HEADER_KEY] === true);
  plan.checkCol = slots.some((row) => row[0]!.cell?.customData?.[CHECK_KEY] === true || row[0]!.box !== null);
  // The table's colors come from cells without a highlight of their own.
  const plainFirst = (row: readonly Slot[]) =>
    row.find((s) => s.cell && s.cell.customData?.[FILL_KEY] === undefined)?.cell ??
    row.find((s) => s.cell)?.cell;
  const body =
    plainFirst(slots.slice(plan.header ? 1 : 0).flatMap((row) => row.slice(plan.checkCol ? 1 : 0))) ??
    cells[0]!;
  const headerCell = plan.header ? plainFirst(slots[0]!) : undefined;
  const align: unknown = body.customData?.[ALIGN_KEY];
  plan.look = {
    headerFill: headerCell?.backgroundColor ?? DEFAULT_HEADER_FILL,
    cellFill: body.backgroundColor,
    border: body.strokeColor,
    borderWidth: body.strokeWidth,
    roughness: body.roughness,
    align: align === "left" || align === "right" ? align : "center",
    dimDone: body.customData?.[DIM_KEY] === true,
  };
  const firstText = slots.flat().find((s) => s.text)?.text;
  if (firstText) {
    plan.font = {
      fontSize: firstText.fontSize,
      fontFamily: firstText.fontFamily,
      strokeColor: firstText.strokeColor,
    };
  }
  return plan;
}

/** An empty table plan with its top-left corner at `at`. */
export function newPlan(
  o: TableOptions,
  at: Point,
  look: TableLook,
  font: TextStyle,
  groupId: string = crypto.randomUUID(),
): Plan {
  const colW = [
    ...(o.checkboxes ? [CHECK_COLUMN_WIDTH] : []),
    ...Array.from({ length: o.cols }, () => CELL_WIDTH),
  ];
  const rowH = Array.from({ length: o.rows + (o.header ? 1 : 0) }, () => ROW_HEIGHT);
  return {
    groupId,
    groupIds: [groupId],
    frameId: null,
    locked: false,
    x: at.x,
    y: at.y,
    colW,
    rowH,
    slots: rowH.map(() => colW.map(emptySlot)),
    header: o.header,
    checkCol: o.checkboxes,
    look,
    font,
    removed: [],
    realign: new Set(),
  };
}

export function tableSize(o: TableOptions): { width: number; height: number } {
  return {
    width: (o.checkboxes ? CHECK_COLUMN_WIDTH : 0) + o.cols * CELL_WIDTH,
    height: (o.rows + (o.header ? 1 : 0)) * ROW_HEIGHT,
  };
}

/** Building a table never writes text. */
const NO_TEXT: TextEngine = {
  create() {
    throw new Error("A new table has no text.");
  },
  rewrap: (texts) => [...texts],
};

/** A new table's elements, grouped and ready to insert. */
export function buildTable(
  o: TableOptions,
  at: Point,
  look: TableLook,
  font: TextStyle,
  groupId: string = crypto.randomUUID(),
): El[] {
  return commit([], newPlan(o, at, look, font, groupId), NO_TEXT) ?? [];
}

// --- Geometry ------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function planRect(p: Plan): Rect {
  return { x: p.x, y: p.y, width: sum(p.colW), height: sum(p.rowH) };
}

export function slotRect(p: Plan, row: number, col: number): Rect {
  return {
    x: p.x + sum(p.colW.slice(0, col)),
    y: p.y + sum(p.rowH.slice(0, row)),
    width: p.colW[col]!,
    height: p.rowH[row]!,
  };
}

/** Row and column under a scene point, if it's inside the table. */
export function slotAt(p: Plan, pt: Point): { row: number; col: number } | null {
  const find = (start: number, sizes: readonly number[], v: number) => {
    let edge = start;
    for (let i = 0; i < sizes.length; i++) {
      edge += sizes[i]!;
      if (v >= edge - sizes[i]! && v < edge) return i;
    }
    return -1;
  };
  const col = find(p.x, p.colW, pt.x);
  const row = find(p.y, p.rowH, pt.y);
  return col < 0 || row < 0 ? null : { row, col };
}

export interface Edge {
  kind: "col" | "row";
  /** The column (or row) whose right (or bottom) edge this is. */
  index: number;
}

/**
 * The grid line under a scene point: inner lines and the right and bottom
 * edges, which resize the column or row before them. `guard` keeps the outer
 * corners free for Excalidraw's own resize handles.
 */
export function edgeAt(p: Plan, pt: Point, tolerance: number, guard: number): Edge | null {
  const { x, y, width, height } = planRect(p);
  if (
    pt.x < x - tolerance ||
    pt.x > x + width + tolerance ||
    pt.y < y - tolerance ||
    pt.y > y + height + tolerance
  ) {
    return null;
  }
  let at = x;
  for (let c = 0; c < p.colW.length; c++) {
    at += p.colW[c]!;
    const g = c === p.colW.length - 1 ? guard : 0;
    if (Math.abs(pt.x - at) <= tolerance && pt.y >= y + g && pt.y <= y + height - g)
      return { kind: "col", index: c };
  }
  at = y;
  for (let r = 0; r < p.rowH.length; r++) {
    at += p.rowH[r]!;
    const g = r === p.rowH.length - 1 ? guard : 0;
    if (Math.abs(pt.y - at) <= tolerance && pt.x >= x + g && pt.x <= x + width - g)
      return { kind: "row", index: r };
  }
  return null;
}

// --- Edits ---------------------------------------------------------------------------

export const bodyRows = (p: Plan) => p.rowH.length - (p.header ? 1 : 0);
export const textCols = (p: Plan) => p.colW.length - (p.checkCol ? 1 : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function drop(p: Plan, s: Slot) {
  for (const el of [s.cell, s.text, s.box, ...s.ticks]) if (el) p.removed.push(el);
}

/** New rows match the table's shortest row, so a scaled table keeps its scale. */
const baseRowHeight = (p: Plan) => (p.rowH.length > 0 ? Math.min(...p.rowH) : ROW_HEIGHT);

/** Inserts a body row before row `at` (never above the header). */
export function insertRow(p: Plan, at: number): boolean {
  if (p.rowH.length >= MAX_ROWS) return false;
  const i = clamp(at, p.header ? 1 : 0, p.rowH.length);
  p.rowH.splice(i, 0, baseRowHeight(p));
  p.slots.splice(i, 0, p.colW.map(emptySlot));
  return true;
}

/** Deletes a row; deleting the header row turns the header off. Keeps one body row. */
export function deleteRow(p: Plan, r: number): boolean {
  if (r < 0 || r >= p.rowH.length) return false;
  const isHeader = p.header && r === 0;
  if (!isHeader && bodyRows(p) <= 1) return false;
  if (isHeader) {
    // Keep the body where it is: the table loses its top row.
    p.y += p.rowH[0]!;
    p.header = false;
  }
  p.slots[r]!.forEach((s) => drop(p, s));
  p.slots.splice(r, 1);
  p.rowH.splice(r, 1);
  return true;
}

/** Inserts a text column before column `at` (never left of the checkbox column). */
export function insertCol(p: Plan, at: number): boolean {
  if (p.colW.length >= MAX_COLS) return false;
  const first = p.checkCol ? 1 : 0;
  const i = clamp(at, first, p.colW.length);
  const neighbor = i - 1 >= first ? p.colW[i - 1] : p.colW[i];
  p.colW.splice(i, 0, neighbor ?? CELL_WIDTH);
  p.slots.forEach((row) => row.splice(i, 0, emptySlot()));
  return true;
}

/** Deletes a column; deleting the checkbox column turns it off. Keeps one text column. */
export function deleteCol(p: Plan, c: number): boolean {
  if (c < 0 || c >= p.colW.length) return false;
  const isCheck = p.checkCol && c === 0;
  if (!isCheck && textCols(p) <= 1) return false;
  if (isCheck) {
    p.x += p.colW[0]!;
    p.checkCol = false;
  }
  p.slots.forEach((row) => {
    drop(p, row[c]!);
    row.splice(c, 1);
  });
  p.colW.splice(c, 1);
  return true;
}

/** Adds or removes the header row; the body stays where it is. */
export function setHeader(p: Plan, on: boolean): boolean {
  if (on === p.header) return false;
  if (!on) return deleteRow(p, 0);
  if (p.rowH.length >= MAX_ROWS) return false;
  const height = baseRowHeight(p);
  p.y -= height;
  p.rowH.unshift(height);
  p.slots.unshift(p.colW.map(emptySlot));
  p.header = true;
  return true;
}

/** Adds or removes the checkbox column; the other columns stay where they are. */
export function setCheckCol(p: Plan, on: boolean): boolean {
  if (on === p.checkCol) return false;
  if (!on) return deleteCol(p, 0);
  if (p.colW.length >= MAX_COLS) return false;
  p.x -= CHECK_COLUMN_WIDTH;
  p.colW.unshift(CHECK_COLUMN_WIDTH);
  p.slots.forEach((row) => row.unshift(emptySlot()));
  p.checkCol = true;
  return true;
}

export function resizeCol(p: Plan, c: number, width: number) {
  if (c < 0 || c >= p.colW.length) return;
  p.colW[c] = Math.max(p.checkCol && c === 0 ? MIN_CHECK_COL_WIDTH : MIN_COL_WIDTH, width);
}

/** Rows never get shorter than their text; commit enforces that. */
export function resizeRow(p: Plan, r: number, height: number) {
  if (r < 0 || r >= p.rowH.length) return;
  p.rowH[r] = Math.max(MIN_ROW_HEIGHT, height);
}

export function setLook(p: Plan, look: Partial<TableLook>) {
  p.look = { ...p.look, ...look };
  if (look.align) p.realign = "all";
}

/** Deletes several rows (highest first); stops at the last body row. */
export function deleteRows(p: Plan, rows: Iterable<number>): boolean {
  let any = false;
  for (const r of [...new Set(rows)].sort((a, b) => b - a)) any = deleteRow(p, r) || any;
  return any;
}

/** Deletes several columns (rightmost first); stops at the last text column. */
export function deleteCols(p: Plan, cols: Iterable<number>): boolean {
  let any = false;
  for (const c of [...new Set(cols)].sort((a, b) => b - a)) any = deleteCol(p, c) || any;
  return any;
}

/** Gives cells their own fill (a highlight), or drops it with null. */
export function highlight(p: Plan, cells: readonly { row: number; col: number }[], fill: string | null) {
  for (const { row, col } of cells) {
    const slot = p.slots[row]?.[col];
    if (slot) slot.fill = fill;
  }
}

/** Empties cells' text; checkbox cells keep their boxes. */
export function clearCells(p: Plan, cells: readonly { row: number; col: number }[]) {
  for (const { row, col } of cells) {
    const slot = p.slots[row]?.[col];
    if (slot && !(p.checkCol && col === 0)) slot.value = "";
  }
}

/** Whether row `r` is ticked. */
export function isDone(p: Plan, r: number): boolean {
  const slot = p.checkCol ? p.slots[r]?.[0] : undefined;
  if (!slot?.box) return false;
  return slot.tick ?? slot.ticks.length > 0;
}

const cellText = (s: Slot | undefined) => (s?.value ?? s?.text?.originalText ?? "").trim();

/**
 * Sorts the body rows by a column: text in natural order ("Item 2" before
 * "Item 10"), numbers by value, empty cells last; the checkbox column puts
 * open items first. Rows keep their order on ties.
 */
export function sortRows(p: Plan, col: number, dir: "asc" | "desc") {
  const first = p.header ? 1 : 0;
  const rows = p.slots
    .slice(first)
    .map((slots, i) => ({ slots, height: p.rowH[first + i]!, index: first + i }));
  const key = (row: (typeof rows)[number]) =>
    p.checkCol && col === 0 ? (isDone(p, row.index) ? "1" : "0") : cellText(row.slots[col]);
  const compare = (a: string, b: string) => {
    const x = Number(a.replace(/,/g, ""));
    const y = Number(b.replace(/,/g, ""));
    if (a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  };
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === "" || kb === "") return ka === kb ? a.index - b.index : ka === "" ? 1 : -1;
    return (dir === "asc" ? compare(ka, kb) : compare(kb, ka)) || a.index - b.index;
  });
  p.slots.splice(first, rows.length, ...rows.map((r) => r.slots));
  p.rowH.splice(first, rows.length, ...rows.map((r) => r.height));
}

/** Moves a body row so it lands before row `to` (as numbered now); never above the header. */
export function moveRow(p: Plan, from: number, to: number): boolean {
  const first = p.header ? 1 : 0;
  if (from < first || from >= p.rowH.length) return false;
  const target = clamp(to, first, p.rowH.length);
  const at = target > from ? target - 1 : target;
  if (at === from) return false;
  const [slots] = p.slots.splice(from, 1);
  const [height] = p.rowH.splice(from, 1);
  p.slots.splice(at, 0, slots!);
  p.rowH.splice(at, 0, height!);
  return true;
}

/**
 * Writes `values` into the grid from (row, col): one row per line, one column
 * per tab. Adds rows and columns as needed; the checkbox column is skipped and
 * takes `ticks` (from "[x]" / "[ ]" list items) instead.
 */
export function fill(
  p: Plan,
  row: number,
  col: number,
  values: readonly (readonly string[])[],
  ticks: readonly (boolean | undefined)[] = [],
): void {
  // Spreadsheet text copied from a checklist starts each row with TRUE / FALSE.
  const bool = /^(true|false)$/i;
  if (p.checkCol && values.length > 0 && values.every((line) => bool.test(line[0]?.trim() ?? ""))) {
    ticks = values.map((line) => /^true$/i.test(line[0]!.trim()));
    values = values.map((line) => line.slice(1));
  }
  const c0 = Math.max(col, p.checkCol ? 1 : 0);
  const width = Math.max(0, ...values.map((v) => v.length));
  while (c0 + width > p.colW.length && insertCol(p, p.colW.length));
  while (row + values.length > p.rowH.length && insertRow(p, p.rowH.length));
  values.forEach((line, i) => {
    const r = row + i;
    if (r >= p.rowH.length) return;
    line.forEach((value, j) => {
      const slot = p.slots[r]![c0 + j];
      if (slot) slot.value = value.trim();
    });
    const tick = ticks[i];
    if (tick !== undefined && p.checkCol && !(p.header && r === 0)) p.slots[r]![0]!.tick = tick;
  });
}

// --- Committing --------------------------------------------------------------------------

type Props = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function alignedX(align: Align, x: number, width: number, textWidth: number) {
  if (align === "left") return x + PAD;
  if (align === "right") return x + width - PAD - textWidth;
  return x + (width - textWidth) / 2;
}

/**
 * Lays the plan out over `elements` (the whole scene, deleted ones included).
 * Returns the next scene for updateScene, or null when nothing changes.
 */
export function commit(elements: readonly El[], p: Plan, engine: TextEngine): El[] | null {
  const created = { cells: [] as El[], texts: [] as El[], boxes: [] as El[], ticks: [] as El[] };
  const fresh = new Map<string, El>();
  const changes = new Map<string, Props>();
  const removed = new Map(p.removed.map((el) => [el.id, el]));
  const put = (el: El, props: Props) => {
    const own = fresh.get(el.id);
    if (own) fresh.set(el.id, { ...own, ...props } as El);
    else changes.set(el.id, { ...changes.get(el.id), ...props });
  };
  const add = (list: El[], el: El) => {
    fresh.set(el.id, el);
    list.push(el);
  };
  const isHeaderRow = (r: number) => p.header && r === 0;
  const isCheckCol = (c: number) => p.checkCol && c === 0;
  const common = {
    groupIds: [...p.groupIds],
    frameId: p.frameId,
    locked: p.locked,
    roughness: p.look.roughness,
  };

  // 1. A cell in every slot.
  p.slots.forEach((row) =>
    row.forEach((slot) => {
      if (slot.cell) return;
      const [cell] = unordered([
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          roundness: null,
          fillStyle: "solid",
          ...common,
        },
      ]);
      slot.cell = cell!;
      add(created.cells, cell!);
    }),
  );

  // 2. Text content, wrapped to the new column widths.
  const needed = (s: Slot) => (s.text ? s.text.height + 2 * PAD : 0);
  const neededBefore = p.slots.map((row) => Math.max(0, ...row.map(needed)));
  const measure: TextEl[] = [];
  const touched = new Set<string>();
  p.slots.forEach((row) =>
    row.forEach((slot, c) => {
      const cell = slot.cell!;
      const resized = fresh.has(cell.id) || Math.abs(cell.width - p.colW[c]!) > 0.01;
      if (slot.value !== undefined) {
        const value = slot.value;
        if (!value) {
          if (slot.text) removed.set(slot.text.id, slot.text);
          slot.text = null;
          return;
        }
        let text = slot.text;
        if (!text) {
          text = engine.create({
            ...p.font,
            text: value,
            containerId: cell.id,
            groupIds: p.groupIds,
            frameId: p.frameId,
            textAlign: p.look.align,
          });
          add(created.texts, text);
        }
        slot.text = { ...text, text: value, originalText: value };
        touched.add(text.id);
        measure.push(slot.text);
      } else if (slot.text && resized) {
        measure.push(slot.text);
      }
    }),
  );
  if (measure.length > 0) {
    const containers = p.slots.flatMap((row) => row.map((s, c) => ({ ...s.cell!, width: p.colW[c]! }) as El));
    const measured = new Map(engine.rewrap(measure, containers).map((t) => [t.id, t]));
    p.slots.forEach((row) =>
      row.forEach((s) => {
        if (s.text && measured.has(s.text.id)) s.text = measured.get(s.text.id)!;
      }),
    );
  }

  // 3. Rows fit their text. A row that was exactly as tall as its text
  //    shrinks back when re-wrapping makes the text shorter.
  const base = Math.min(...p.rowH);
  p.slots.forEach((row, r) => {
    const need = Math.max(0, ...row.map(needed));
    const fitted = neededBefore[r]! > 0 && Math.abs(p.rowH[r]! - neededBefore[r]!) < 1;
    p.rowH[r] = fitted && need !== neededBefore[r] ? Math.max(base, need) : Math.max(p.rowH[r]!, need);
  });

  // 4. Lay out every part.
  let y = p.y;
  p.slots.forEach((row, r) => {
    let x = p.x;
    const h = p.rowH[r]!;
    row.forEach((slot, c) => {
      const w = p.colW[c]!;
      const cell = slot.cell!;
      const data: Props = { ...cell.customData, [PART_KEY]: "cell", [ALIGN_KEY]: p.look.align };
      delete data[HEADER_KEY];
      delete data[CHECK_KEY];
      delete data[DIM_KEY];
      if (isHeaderRow(r)) data[HEADER_KEY] = true;
      if (isCheckCol(c)) data[CHECK_KEY] = true;
      if (p.look.dimDone) data[DIM_KEY] = true;
      if (slot.fill === null) delete data[FILL_KEY];
      else if (slot.fill !== undefined) data[FILL_KEY] = slot.fill;
      const ownFill = typeof data[FILL_KEY] === "string" ? (data[FILL_KEY] as string) : undefined;
      // Keep other bindings (arrows drawn to the cell); only the text binding changes.
      const others = (cell.boundElements ?? []).filter((b) => b.type !== "text");
      const hadText = others.length !== (cell.boundElements ?? []).length;
      const bindings = slot.text
        ? [...others, { type: "text", id: slot.text.id }]
        : hadText
          ? others.length > 0
            ? others
            : null
          : cell.boundElements;
      put(cell, {
        x,
        y,
        width: w,
        height: h,
        backgroundColor: ownFill ?? (isHeaderRow(r) ? p.look.headerFill : p.look.cellFill),
        fillStyle: "solid",
        strokeColor: p.look.border,
        strokeWidth: p.look.borderWidth,
        roughness: p.look.roughness,
        customData: data,
        boundElements: bindings,
      });

      const text = slot.text;
      if (text) {
        // Ticked rows fade (if the table says so); text the table faded comes back.
        const dim = p.look.dimDone && !isCheckCol(c) && !isHeaderRow(r) && isDone(p, r);
        const opacity = dim ? DIM_OPACITY : text.opacity === DIM_OPACITY ? 100 : text.opacity;
        const realign = p.realign === "all" || p.realign.has(text.id) || touched.has(text.id);
        const align = (realign ? p.look.align : text.textAlign) as Align;
        put(text, {
          text: text.text,
          originalText: text.originalText,
          width: text.width,
          height: text.height,
          lineHeight: text.lineHeight,
          textAlign: align,
          verticalAlign: "middle",
          containerId: cell.id,
          opacity,
          x: alignedX(align, x, w, text.width),
          y: y + (h - text.height) / 2,
        });
      }

      if (isCheckCol(c) && !isHeaderRow(r)) {
        const bx = x + (w - BOX_SIZE) / 2;
        const by = y + (h - BOX_SIZE) / 2;
        let box = slot.box;
        if (!box) {
          box = unordered([
            {
              type: "rectangle",
              x: bx,
              y: by,
              width: BOX_SIZE,
              height: BOX_SIZE,
              backgroundColor: "transparent",
              fillStyle: "solid",
              strokeWidth: 2,
              roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
              customData: { [PART_KEY]: "checkbox" },
              ...common,
            },
          ])[0]!;
          add(created.boxes, box);
        }
        const dx = bx - box.x;
        const dy = by - box.y;
        const boxLook = { strokeColor: p.look.border, strokeWidth: Math.max(2, p.look.borderWidth) };
        put(box, { x: bx, y: by, width: BOX_SIZE, height: BOX_SIZE, ...boxLook });
        if (slot.tick === false) {
          slot.ticks.forEach((t) => removed.set(t.id, t));
        } else {
          for (const t of slot.ticks) put(t, { x: t.x + dx, y: t.y + dy, ...boxLook });
          if (slot.tick && slot.ticks.length === 0) {
            add(
              created.ticks,
              makeTick({ ...box, x: bx, y: by, width: BOX_SIZE, height: BOX_SIZE, ...boxLook } as El),
            );
          }
        }
      } else if (slot.box) {
        removed.set(slot.box.id, slot.box);
        slot.ticks.forEach((t) => removed.set(t.id, t));
      }
      x += w;
    });
    y += h;
  });

  // 5. The next scene: changed parts get a new version, new ones go right
  //    after the table so its z-order stays together.
  let changed = fresh.size > 0;
  const next = elements.map((el) => {
    if (removed.has(el.id)) {
      if (el.isDeleted) return el;
      changed = true;
      return newElementWith(el, { isDeleted: true });
    }
    const props = changes.get(el.id);
    if (!props) return el;
    const diff: Props = {};
    for (const [key, value] of Object.entries(props)) {
      if (!same((el as unknown as Props)[key], value)) diff[key] = value;
    }
    if (Object.keys(diff).length === 0) return el;
    changed = true;
    return newElementWith(el, diff as Parameters<typeof newElementWith>[1]);
  });
  if (!changed) return null;
  const order = [...created.cells, ...created.boxes, ...created.texts, ...created.ticks].map((el) =>
    fresh.get(el.id)!,
  );
  let last = -1;
  next.forEach((el, i) => {
    if (!el.isDeleted && el.groupIds[0] === p.groupId) last = i;
  });
  if (last < 0) return [...next, ...order];
  return [...next.slice(0, last + 1), ...order, ...next.slice(last + 1)];
}

/**
 * After a cell's text was edited: its row fits the text, rows below make
 * room, and the edited text takes the table's alignment.
 */
export function tidy(
  elements: readonly El[],
  groupId: string,
  editedTextId: string,
  font: TextStyle,
  engine: TextEngine,
): El[] | null {
  const p = readPlan(elements, groupId, font);
  if (!p) return null;
  p.realign = new Set([editedTextId]);
  return commit(elements, p, engine);
}
