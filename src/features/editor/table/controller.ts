import {
  CaptureUpdateAction,
  newElementWith,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import {
  bodyRows,
  buildTable,
  commit,
  deleteCol,
  deleteRow,
  edgeAt,
  fill,
  insertCol,
  insertRow,
  MIN_CHECK_COL_WIDTH,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  planRect,
  readPlan,
  resizeCol,
  resizeRow,
  setCheckCol,
  setHeader,
  setLook,
  slotAt,
  slotRect,
  tableSize,
  textCols,
  tidy,
  type Edge,
  type Plan,
  type Rect,
  type TableLook,
  type TableOptions,
  type TextStyle,
} from "./grid";
import { centeredIn, snapToGrid } from "../canvas";
import { TABLE_LIMITS, loadSetup, paperColor, resolveLook, type TableSetup } from "./options";
import { parseCells, spansCells } from "./paste";
import {
  ALIGN_KEY,
  CELL_WIDTH,
  CHECK_COLUMN_WIDTH,
  ROW_HEIGHT,
  cellAt,
  centerOf,
  checkboxAt,
  hasCheckbox,
  tablePart,
  toggleCheckbox,
  type Point,
} from "./table";
import { excalidrawText } from "./textEngine";

type El = ExcalidrawElement;

/** Excalidraw's custom tool name for drawing tables. */
export const TABLE_TOOL = "table";
/** Extra reach around each checkbox, in screen px, so boxes are easy to hit with a finger. */
const BOX_SLOP_PX = 6;
/** A press that travels further than this is a drag, not a click. */
const TAP_SLOP_PX = 8;
/** How close (screen px) the pointer must be to a grid line to grab it. */
const EDGE_PX = 5;
const TOUCH_EDGE_PX = 10;
/** The table's outer corners belong to Excalidraw's resize handles. */
const CORNER_PX = 12;
/** Below this, the table tool treats a press as a click. */
const DRAW_MIN_PX = 6;

/** A rectangle in px, relative to the editor wrapper. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the table bar shows while one table is selected. */
export interface TableFocus {
  groupId: string;
  rows: number;
  cols: number;
  header: boolean;
  checkCol: boolean;
  look: TableLook;
  /** The cell row/column actions apply to: the selected cell, or the last one clicked. */
  active: { row: number; col: number } | null;
  activeSize: { width: number; height: number } | null;
  canDeleteRow: boolean;
  canDeleteCol: boolean;
  box: Box;
  activeBox: Box | null;
}

/** The table tool's preview while dragging. */
export interface TableDraft {
  box: Box;
  /** Column widths and row heights in px. */
  cols: number[];
  rows: number[];
  label: string;
}

/** The line that follows the pointer while a column or row is resized; it applies on release. */
export interface TableGuide {
  kind: "col" | "row";
  box: Box;
  label: string;
}

export interface TableUi {
  focus: TableFocus | null;
  toolActive: boolean;
  draft: TableDraft | null;
  guide: TableGuide | null;
  /** False in view and zen mode, where nothing gets added. */
  editable: boolean;
  /** The canvas color, for the "Canvas color" swatch. */
  paper: string;
}

type Gesture =
  | { kind: "tick"; pointerId: number; boxId: string; x: number; y: number }
  | {
      kind: "resize";
      pointerId: number;
      groupId: string;
      edge: Edge;
      /** Pointer position (client px) and the column's width / row's height (scene px) at the start. */
      start: number;
      size: number;
      min: number;
      /** Where the grid line was (scene coords), and the table, for the guide. */
      line: number;
      rect: Rect;
      moved: boolean;
    }
  | { kind: "draw"; pointerId: number; start: Point; x: number; y: number; setup: TableSetup };

const toolOn = (s: AppState) => s.activeTool.type === "custom" && s.activeTool.customType === TABLE_TOOL;
const busy = (s: AppState) =>
  s.viewModeEnabled ||
  !!s.editingTextElement ||
  !!s.editingLinearElement ||
  !!s.newElement ||
  !!s.multiElement ||
  !!s.croppingElementId;
const selecting = (s: AppState) => !busy(s) && s.activeTool.type === "selection";
const plain = (e: MouseEvent | TouchEvent | KeyboardEvent) =>
  !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Tables on top of Excalidraw (EDIT-7), through its imperative API and DOM
 * events on our own wrapper only:
 * - a plain click on a checkbox ticks it, without selecting or dragging;
 * - dragging a grid line resizes that column or row (a guide follows; one undo step);
 * - double-clicking a cell types in it (one step, not Excalidraw's two);
 * - the "table" custom tool (toolbar or B) drags out a new table;
 * - pasting lines or tab-separated values fills cells, one per line;
 * - the table bar's actions (rows, columns, header, checkboxes, styling).
 */
export class TableController {
  private api: ExcalidrawImperativeAPI | null = null;
  private host: HTMLElement | null = null;
  private ui: TableUi = {
    focus: null,
    toolActive: false,
    draft: null,
    guide: null,
    editable: true,
    paper: "#ffffff",
  };
  private listeners = new Set<() => void>();
  private frame = 0;
  private gesture: Gesture | null = null;
  /** Where the last click inside a table landed, for the bar's row/column actions. */
  private lastPress: { groupId: string; at: Point } | null = null;
  private index: {
    source: readonly El[];
    byId: Map<string, El>;
    tables: Map<string, [number, number, number, number]>;
  } | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.ui;

  // --- Actions (toolbar, dialog, table bar) -----------------------------------------

  /** Picks the table tool: the next drag on the canvas draws a table. */
  activateTool = () => {
    const api = this.api;
    if (!api || api.getAppState().viewModeEnabled) return;
    api.setActiveTool({ type: "custom", customType: TABLE_TOOL });
  };

  /** Adds a table (top-left at `at`, or centered in the view) and selects it. One undo step. */
  insert = (setup: TableOptions & Pick<TableSetup, "look">, at?: Point, keepTool = false) => {
    const api = this.api;
    if (!api) return;
    const s = api.getAppState();
    const { width, height } = tableSize(setup);
    const topLeft = at ? { x: snapToGrid(s, at.x), y: snapToGrid(s, at.y) } : centeredIn(s, width, height);
    const groupId = crypto.randomUUID();
    const table = buildTable(setup, topLeft, resolveLook(setup.look, s), this.font(s), groupId);
    if (!keepTool) api.setActiveTool({ type: "selection" });
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...table],
      appState: { ...this.selection(table, groupId), editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  insertRow = (where: "above" | "below") =>
    this.withFocus((p, a) =>
      insertRow(p, a ? a.row + (where === "below" ? 1 : 0) : where === "below" ? p.rowH.length : 0),
    );
  deleteRow = () => this.withFocus((p, a) => (a ? deleteRow(p, a.row) : false));
  insertCol = (where: "left" | "right") =>
    this.withFocus((p, a) =>
      insertCol(p, a ? a.col + (where === "right" ? 1 : 0) : where === "right" ? p.colW.length : 0),
    );
  deleteCol = () => this.withFocus((p, a) => (a ? deleteCol(p, a.col) : false));
  setHeader = (on: boolean) => this.withFocus((p) => setHeader(p, on));
  setCheckCol = (on: boolean) => this.withFocus((p) => setCheckCol(p, on));
  setLook = (look: Partial<TableLook>) => this.withFocus((p) => setLook(p, look));
  /** Sets the active column's width or row's height, in scene px. */
  setSize = (kind: "width" | "height", size: number) =>
    this.withFocus((p, a) => {
      if (!a || !Number.isFinite(size)) return false;
      if (kind === "width") resizeCol(p, a.col, size);
      else resizeRow(p, a.row, size);
    });

  deleteTable = () => {
    const api = this.api;
    const focus = this.currentFocus();
    if (!api || !focus) return;
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((el) =>
          !el.isDeleted && el.groupIds[0] === focus.groupId ? newElementWith(el, { isDeleted: true }) : el,
        ),
      appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /**
   * Excalidraw's onPaste: text pasted while a table is selected fills its
   * cells from the active one (one row per line, one column per tab).
   * Returning false stops Excalidraw's own paste.
   */
  onPaste: NonNullable<ExcalidrawProps["onPaste"]> = (data) => {
    const api = this.api;
    if (!api || data.elements?.length || (data.files && Object.keys(data.files).length > 0)) return true;
    const text =
      data.text ??
      (data.mixedContent?.every((c) => c.type === "text")
        ? data.mixedContent.map((c) => c.value).join("\n")
        : "");
    const focus = this.currentFocus();
    const cells = text ? parseCells(text) : null;
    if (!focus || !cells) return true;
    this.edit(focus.groupId, (p) => {
      const at = focus.active ?? { row: p.header ? 1 : 0, col: p.checkCol ? 1 : 0 };
      fill(p, at.row, at.col, cells.rows, cells.ticks);
    });
    return false;
  };

  // --- Wiring ----------------------------------------------------------------------

  attach(api: ExcalidrawImperativeAPI, host: HTMLElement): () => void {
    this.api = api;
    this.host = host;
    const toScene = (clientX: number, clientY: number) =>
      viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
    const onCanvas = (t: EventTarget | null): t is HTMLCanvasElement =>
      t instanceof HTMLCanvasElement && host.contains(t);
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const boxAt = (clientX: number, clientY: number) =>
      checkboxAt(
        api.getSceneElements(),
        toScene(clientX, clientY),
        BOX_SLOP_PX / api.getAppState().zoom.value,
      );
    const edgeUnder = (clientX: number, clientY: number, touch: boolean) => {
      const s = api.getAppState();
      const p = toScene(clientX, clientY);
      const z = s.zoom.value;
      const tolerance = (touch ? TOUCH_EDGE_PX : EDGE_PX) / z;
      const { source, tables } = this.scene();
      for (const [groupId, [x1, y1, x2, y2]] of tables) {
        if (p.x < x1 - tolerance || p.x > x2 + tolerance || p.y < y1 - tolerance || p.y > y2 + tolerance)
          continue;
        const plan = readPlan(source, groupId, this.font(s));
        if (!plan || plan.locked) continue;
        const edge = edgeAt(plan, p, tolerance, CORNER_PX / z);
        if (edge) return { groupId, edge, plan };
      }
      return null;
    };

    // Resizes and table drafts follow the pointer once per frame.
    let pending: { clientX: number; clientY: number } | null = null;
    let moveFrame = 0;
    const flushMove = () => {
      moveFrame = 0;
      const g = this.gesture;
      const at = pending;
      pending = null;
      if (!g || !at) return;
      if (g.kind === "resize") {
        g.moved = true;
        this.showGuide(g, g.edge.kind === "col" ? at.clientX : at.clientY);
      } else if (g.kind === "draw") {
        this.showDraft(g, at.clientX, at.clientY);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (this.gesture) {
        // A second finger: this is a pinch, not ours.
        this.cancelGesture();
        return;
      }
      if (!onCanvas(e.target) || e.button !== 0) return;
      const s = api.getAppState();
      if (toolOn(s) && !s.viewModeEnabled) {
        stop(e);
        const start = toScene(e.clientX, e.clientY);
        this.gesture = {
          kind: "draw",
          pointerId: e.pointerId,
          start,
          x: e.clientX,
          y: e.clientY,
          setup: loadSetup(),
        };
        return;
      }
      if (!selecting(s)) return;
      const at = toScene(e.clientX, e.clientY);
      const groupId = cellAt(api.getSceneElements(), at)?.groupIds[0];
      this.lastPress = groupId ? { groupId, at } : null;
      if (!plain(e)) return;
      const hit = edgeUnder(e.clientX, e.clientY, e.pointerType === "touch");
      if (hit) {
        stop(e);
        const { plan, edge } = hit;
        const col = edge.kind === "col";
        const rect = planRect(plan);
        const before = (sizes: readonly number[]) =>
          sizes.slice(0, edge.index + 1).reduce((a, b) => a + b, 0);
        this.gesture = {
          kind: "resize",
          pointerId: e.pointerId,
          groupId: hit.groupId,
          edge,
          start: col ? e.clientX : e.clientY,
          size: col ? plan.colW[edge.index]! : plan.rowH[edge.index]!,
          min: !col
            ? MIN_ROW_HEIGHT
            : plan.checkCol && edge.index === 0
              ? MIN_CHECK_COL_WIDTH
              : MIN_COL_WIDTH,
          line: col ? rect.x + before(plan.colW) : rect.y + before(plan.rowH),
          rect,
          moved: false,
        };
        return;
      }
      const box = boxAt(e.clientX, e.clientY);
      if (box) {
        stop(e);
        this.gesture = { kind: "tick", pointerId: e.pointerId, boxId: box.id, x: e.clientX, y: e.clientY };
      }
    };

    // After Excalidraw's own hover handling, so our cursor wins.
    const onPointerMove = (e: PointerEvent) => {
      const g = this.gesture;
      if (g && e.pointerId === g.pointerId) {
        if (g.kind === "resize") api.setCursor(g.edge.kind === "col" ? "col-resize" : "row-resize");
        if (g.kind !== "tick") {
          pending = { clientX: e.clientX, clientY: e.clientY };
          if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
        }
        return;
      }
      if (e.pointerType === "touch" || e.buttons !== 0 || !onCanvas(e.target)) return;
      const s = api.getAppState();
      if (toolOn(s)) {
        api.setCursor("crosshair");
        return;
      }
      if (!selecting(s) || !plain(e)) return;
      const hit = edgeUnder(e.clientX, e.clientY, false);
      if (hit) api.setCursor(hit.edge.kind === "col" ? "col-resize" : "row-resize");
      else if (boxAt(e.clientX, e.clientY)) api.setCursor("pointer");
    };

    const onPointerUp = (e: PointerEvent) => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.pointerId) return;
      this.gesture = null;
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pending = null;
      if (g.kind === "tick") {
        if (!onCanvas(e.target)) return;
        e.stopPropagation();
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_SLOP_PX) return;
        if (boxAt(e.clientX, e.clientY)?.id !== g.boxId) return;
        api.updateScene({
          elements: toggleCheckbox(api.getSceneElementsIncludingDeleted(), g.boxId),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return;
      }
      e.stopPropagation();
      if (g.kind === "resize") {
        this.set({ guide: null });
        if (g.moved) this.resize(g, g.edge.kind === "col" ? e.clientX : e.clientY);
        return;
      }
      this.finishDraw(g, e.clientX, e.clientY);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (this.gesture?.pointerId === e.pointerId) this.cancelGesture();
    };

    // Two quick ticks are a double-click to Excalidraw, which would drop a
    // text box on the checkbox (or a grid line). The ticks already happened.
    const onDoubleClick = (e: MouseEvent) => {
      if (!e.isTrusted || !plain(e) || !onCanvas(e.target) || !selecting(api.getAppState())) return;
      if (boxAt(e.clientX, e.clientY) || edgeUnder(e.clientX, e.clientY, false)) e.stopPropagation();
    };
    // The same for double-taps, which Excalidraw spots on touchstart.
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches.length === 1 ? e.touches[0] : undefined;
      if (!touch || !onCanvas(e.target)) return;
      const s = api.getAppState();
      const ours =
        toolOn(s) ||
        (selecting(s) &&
          (boxAt(touch.clientX, touch.clientY) || edgeUnder(touch.clientX, touch.clientY, true)));
      if (ours) stop(e);
    };

    // Excalidraw's first double-click on a table enters its group and selects
    // the cell; finish the job by double-clicking again, which edits the text.
    let followUp: ReturnType<typeof setTimeout> | undefined;
    const onDoubleClickDone = (e: MouseEvent) => {
      const target = e.target;
      if (!e.isTrusted || !onCanvas(target)) return;
      const { clientX, clientY } = e;
      clearTimeout(followUp);
      followUp = setTimeout(() => {
        const s = api.getAppState();
        const ids = Object.keys(s.selectedElementIds);
        if (!s.editingGroupId || s.editingTextElement || ids.length !== 1 || !target.isConnected) return;
        const { byId, source } = this.scene();
        let cell = byId.get(ids[0]!);
        if (cell?.type === "text" && cell.containerId) cell = byId.get(cell.containerId);
        if (!cell || tablePart(cell) !== "cell" || cell.groupIds[0] !== s.editingGroupId) return;
        if (hasCheckbox(source, cell)) return;
        target.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, view: window }),
        );
      }, 0);
    };

    // Pasting several lines while typing in a cell spreads them over the cells below.
    const onPasteInCell = (e: ClipboardEvent) => {
      const area = e.target;
      if (!(area instanceof HTMLTextAreaElement) || !host.contains(area)) return;
      const raw = e.clipboardData?.getData("text/plain") ?? "";
      if (!spansCells(raw)) return;
      const editing = api.getAppState().editingTextElement;
      const containerId = editing?.type === "text" ? editing.containerId : null;
      const cell = containerId ? this.scene().byId.get(containerId) : undefined;
      const groupId = cell?.groupIds[0];
      const cells = parseCells(raw);
      if (!cell || !groupId || tablePart(cell) !== "cell" || !cells) return;
      stop(e);
      // The first value joins what's already typed, at the caret.
      const first = cells.rows[0]!;
      first[0] =
        area.value.slice(0, area.selectionStart) + (first[0] ?? "") + area.value.slice(area.selectionEnd);
      const at = centerOf(cell);
      area.blur(); // Excalidraw keeps the typed text and closes its editor
      setTimeout(() => {
        this.edit(groupId, (p) => {
          const slot = slotAt(p, at);
          if (!slot) return false;
          fill(p, slot.row, slot.col, cells.rows, cells.ticks);
        });
      }, 0);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (this.gesture?.kind === "draw" && e.key === "Escape") {
        stop(e);
        this.cancelGesture();
        return;
      }
      if ((e.key !== "b" && e.key !== "B") || !plain(e) || e.repeat) return;
      const t = e.target;
      const typing =
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t instanceof HTMLTextAreaElement ||
          t instanceof HTMLSelectElement ||
          (t instanceof HTMLInputElement && !["radio", "checkbox", "button"].includes(t.type)));
      const s = api.getAppState();
      if (typing || s.viewModeEnabled || s.editingTextElement) return;
      e.preventDefault();
      this.activateTool();
    };

    // When a cell's text editor opens or closes.
    let editingId: string | null = null;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const stopWatching = api.onChange((_elements, appState) => {
      this.schedule();
      const now = appState.editingTextElement?.id ?? null;
      if (now === editingId) return;
      const ended = editingId;
      editingId = now;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        if (ended) this.afterTyping(ended);
        if (now) this.beforeTyping(now);
      }, 0);
    });
    const stopScroll = api.onScrollChange(() => this.schedule());
    const onResize = () => this.schedule();

    const capture = { capture: true };
    const activeCapture = { capture: true, passive: false };
    host.addEventListener("pointerdown", onPointerDown, capture);
    host.addEventListener("dblclick", onDoubleClick, capture);
    host.addEventListener("touchstart", onTouchStart, activeCapture);
    host.addEventListener("paste", onPasteInCell, capture);
    host.addEventListener("keydown", onKeyDown, capture);
    window.addEventListener("pointerup", onPointerUp, capture);
    window.addEventListener("pointercancel", onPointerCancel, capture);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("dblclick", onDoubleClickDone);
    window.addEventListener("resize", onResize);
    this.schedule();
    return () => {
      clearTimeout(followUp);
      clearTimeout(typingTimer);
      cancelAnimationFrame(moveFrame);
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      stopWatching();
      stopScroll();
      host.removeEventListener("pointerdown", onPointerDown, capture);
      host.removeEventListener("dblclick", onDoubleClick, capture);
      host.removeEventListener("touchstart", onTouchStart, activeCapture);
      host.removeEventListener("paste", onPasteInCell, capture);
      host.removeEventListener("keydown", onKeyDown, capture);
      window.removeEventListener("pointerup", onPointerUp, capture);
      window.removeEventListener("pointercancel", onPointerCancel, capture);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("dblclick", onDoubleClickDone);
      window.removeEventListener("resize", onResize);
      this.gesture = null;
      this.api = null;
      this.host = null;
    };
  }

  // --- Internals ---------------------------------------------------------------------

  private set(next: Partial<TableUi>) {
    const merged = { ...this.ui, ...next };
    if (JSON.stringify(merged) === JSON.stringify(this.ui)) return;
    this.ui = merged;
    this.listeners.forEach((l) => l());
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.refresh);
  };

  private refresh = () => {
    this.frame = 0;
    const api = this.api;
    if (!api) return;
    const s = api.getAppState();
    this.set({
      focus: this.readFocus(s),
      toolActive: toolOn(s),
      editable: !s.viewModeEnabled && !s.zenModeEnabled,
      paper: paperColor(s),
    });
  };

  /** Live elements by id and each table's bounds, rebuilt when the scene changes. */
  private scene() {
    const source = this.api!.getSceneElements();
    if (this.index?.source !== source) {
      const byId = new Map<string, El>();
      const tables = new Map<string, [number, number, number, number]>();
      for (const el of source) {
        byId.set(el.id, el);
        const groupId = el.groupIds[0];
        if (!groupId || tablePart(el) !== "cell") continue;
        const b = tables.get(groupId);
        if (b) {
          b[0] = Math.min(b[0], el.x);
          b[1] = Math.min(b[1], el.y);
          b[2] = Math.max(b[2], el.x + el.width);
          b[3] = Math.max(b[3], el.y + el.height);
        } else {
          tables.set(groupId, [el.x, el.y, el.x + el.width, el.y + el.height]);
        }
      }
      this.index = { source, byId, tables };
    }
    return this.index;
  }

  private font(s: AppState = this.api!.getAppState()): TextStyle {
    return {
      fontSize: s.currentItemFontSize,
      fontFamily: s.currentItemFontFamily,
      strokeColor: s.currentItemStrokeColor,
    };
  }

  /** Selects the whole table, as a click on it would. */
  private selection(elements: readonly El[], groupId: string) {
    const ids = elements
      .filter((el) => !el.isDeleted && el.groupIds[0] === groupId)
      .map((el) => [el.id, true] as const);
    return { selectedElementIds: Object.fromEntries(ids), selectedGroupIds: { [groupId]: true } };
  }

  /** Reads the table, applies `change`, and commits. False when nothing changed. */
  private edit(
    groupId: string,
    change: (p: Plan) => boolean | void,
    captureUpdate: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction] = CaptureUpdateAction.IMMEDIATELY,
    reselect = true,
  ): boolean {
    const api = this.api;
    if (!api) return false;
    const all = api.getSceneElementsIncludingDeleted();
    const plan = readPlan(all, groupId, this.font());
    if (!plan || change(plan) === false) return false;
    const next = commit(all, plan, excalidrawText);
    if (!next) return false;
    const s = api.getAppState();
    api.updateScene({
      elements: next,
      captureUpdate,
      ...(reselect
        ? {
            appState: {
              ...this.selection(next, groupId),
              editingGroupId: s.editingGroupId === groupId ? null : s.editingGroupId,
            },
          }
        : {}),
    });
    return true;
  }

  private currentFocus() {
    return this.api ? this.readFocus(this.api.getAppState()) : null;
  }

  private withFocus(change: (p: Plan, active: TableFocus["active"]) => boolean | void) {
    const focus = this.currentFocus();
    if (focus) this.edit(focus.groupId, (p) => change(p, focus.active));
  }

  /** The new size for a resize gesture's pointer position (scene px). */
  private sizeFor(g: Extract<Gesture, { kind: "resize" }>, client: number) {
    return Math.max(g.min, g.size + (client - g.start) / this.api!.getAppState().zoom.value);
  }

  /**
   * While dragging a grid line only a guide moves; the table changes once,
   * on release. (A live re-layout through updateScene can't become a single
   * undo step: Excalidraw leaves out changes it hasn't recorded yet.)
   */
  private showGuide(g: Extract<Gesture, { kind: "resize" }>, client: number) {
    const s = this.api!.getAppState();
    const size = this.sizeFor(g, client);
    const at = g.line + size - g.size;
    const col = g.edge.kind === "col";
    const r = col ? { ...g.rect, x: at, width: 0 } : { ...g.rect, y: at, height: 0 };
    this.set({ guide: { kind: g.edge.kind, box: this.toBox(s, r), label: `${Math.round(size)} px` } });
  }

  private resize(g: Extract<Gesture, { kind: "resize" }>, client: number): boolean {
    const size = this.sizeFor(g, client);
    return this.edit(
      g.groupId,
      (p) => (g.edge.kind === "col" ? resizeCol(p, g.edge.index, size) : resizeRow(p, g.edge.index, size)),
      CaptureUpdateAction.IMMEDIATELY,
      false,
    );
  }

  private cancelGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === "resize") this.set({ guide: null });
    if (g?.kind === "draw") this.set({ draft: null });
  }

  /** The table a draw gesture would make: dragged size → rows and columns, or the saved size on a click. */
  private drawn(g: Extract<Gesture, { kind: "draw" }>, clientX: number, clientY: number) {
    const end = viewportCoordsToSceneCoords({ clientX, clientY }, this.api!.getAppState());
    const dragged = Math.hypot(clientX - g.x, clientY - g.y) >= DRAW_MIN_PX;
    const counts = dragged
      ? {
          cols: clamp(
            Math.round(
              (Math.abs(end.x - g.start.x) - (g.setup.checkboxes ? CHECK_COLUMN_WIDTH : 0)) / CELL_WIDTH,
            ),
            1,
            TABLE_LIMITS.cols.max,
          ),
          rows: clamp(
            Math.round(Math.abs(end.y - g.start.y) / ROW_HEIGHT) - (g.setup.header ? 1 : 0),
            1,
            TABLE_LIMITS.rows.max,
          ),
        }
      : {};
    const setup = { ...g.setup, ...counts };
    const { width, height } = tableSize(setup);
    const at = {
      x: dragged && end.x < g.start.x ? g.start.x - width : g.start.x,
      y: dragged && end.y < g.start.y ? g.start.y - height : g.start.y,
    };
    return { setup, at, width, height };
  }

  private showDraft(g: Extract<Gesture, { kind: "draw" }>, clientX: number, clientY: number) {
    const s = this.api!.getAppState();
    const { setup, at, width, height } = this.drawn(g, clientX, clientY);
    const z = s.zoom.value;
    this.set({
      draft: {
        box: this.toBox(s, { x: at.x, y: at.y, width, height }),
        cols: [
          ...(setup.checkboxes ? [CHECK_COLUMN_WIDTH] : []),
          ...Array.from({ length: setup.cols }, () => CELL_WIDTH),
        ].map((w) => w * z),
        rows: Array.from({ length: setup.rows + (setup.header ? 1 : 0) }, () => ROW_HEIGHT * z),
        label: `${count(setup.rows, "row")} × ${count(setup.cols, "column")}`,
      },
    });
  }

  private finishDraw(g: Extract<Gesture, { kind: "draw" }>, clientX: number, clientY: number) {
    const { setup, at } = this.drawn(g, clientX, clientY);
    this.set({ draft: null });
    this.insert(setup, at, this.api!.getAppState().activeTool.locked);
  }

  private afterTyping(textId: string) {
    const api = this.api;
    if (!api) return;
    const all = api.getSceneElementsIncludingDeleted();
    const text = all.find((el) => el.id === textId);
    const containerId = text?.type === "text" ? text.containerId : null;
    const cell = containerId ? all.find((el) => el.id === containerId) : undefined;
    const groupId = cell?.groupIds[0];
    if (!cell || cell.isDeleted || tablePart(cell) !== "cell" || !groupId) return;
    const next = tidy(all, groupId, textId, this.font(), excalidrawText);
    if (next) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  /** New text in a cell starts centered (Excalidraw's rule); show the table's alignment while typing. */
  private beforeTyping(textId: string) {
    const api = this.api;
    const editing = api?.getAppState().editingTextElement;
    if (!api || editing?.id !== textId || editing.type !== "text" || !editing.containerId) return;
    const all = api.getSceneElementsIncludingDeleted();
    const cell = all.find((el) => el.id === editing.containerId);
    const align = cell?.customData?.[ALIGN_KEY];
    const text = all.find((el) => el.id === textId);
    if (tablePart(cell) !== "cell" || (align !== "left" && align !== "right")) return;
    if (text?.type !== "text" || text.textAlign === align) return;
    api.updateScene({
      elements: all.map((el) =>
        el.id === textId ? newElementWith(el as ExcalidrawTextElement, { textAlign: align }) : el,
      ),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
  }

  private toBox(s: AppState, r: Rect): Box {
    const origin = this.host!.getBoundingClientRect();
    const v = sceneCoordsToViewportCoords({ sceneX: r.x, sceneY: r.y }, s);
    return {
      left: v.x - origin.left,
      top: v.y - origin.top,
      width: r.width * s.zoom.value,
      height: r.height * s.zoom.value,
    };
  }

  private readFocus(s: AppState): TableFocus | null {
    if (!this.api || !this.host) return null;
    if (
      s.viewModeEnabled ||
      s.activeTool.type !== "selection" ||
      s.editingTextElement ||
      s.selectedElementsAreBeingDragged ||
      s.isResizing ||
      s.isRotating ||
      s.newElement
    ) {
      return null;
    }
    const { source, byId } = this.scene();
    const selected = Object.keys(s.selectedElementIds).flatMap((id) => byId.get(id) ?? []);
    const groupId = selected[0]?.groupIds[0];
    if (!groupId || !selected.every((el) => el.groupIds[0] === groupId)) return null;
    if (!s.selectedGroupIds[groupId] && s.editingGroupId !== groupId) return null;
    const p = readPlan(source, groupId, this.font(s));
    if (!p) return null;

    let active: TableFocus["active"] = null;
    if (selected.length === 1) {
      let el: El | undefined = selected[0];
      if (el?.type === "text" && el.containerId) el = byId.get(el.containerId);
      if (el && tablePart(el)) active = slotAt(p, centerOf(el));
    }
    if (!active && this.lastPress?.groupId === groupId) active = slotAt(p, this.lastPress.at);
    return {
      groupId,
      rows: p.rowH.length,
      cols: p.colW.length,
      header: p.header,
      checkCol: p.checkCol,
      look: p.look,
      active,
      activeSize: active ? { width: p.colW[active.col]!, height: p.rowH[active.row]! } : null,
      canDeleteRow: !!active && ((p.header && active.row === 0) || bodyRows(p) > 1),
      canDeleteCol: !!active && ((p.checkCol && active.col === 0) || textCols(p) > 1),
      box: this.toBox(s, planRect(p)),
      activeBox: active ? this.toBox(s, slotRect(p, active.row, active.col)) : null,
    };
  }
}
