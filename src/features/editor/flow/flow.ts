import { ROUNDNESS, newElementWith } from "@excalidraw/excalidraw";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  PointBinding,
} from "@excalidraw/excalidraw/element/types";
import { centerOf, localBox, tablePart, unordered, type Point } from "../table/table";

/**
 * Growing flowcharts (EDIT-8): add the next step after a shape, and add or
 * remove swimlanes. Everything stays ordinary Excalidraw elements; template
 * shapes carry a `udFlow` tag, and lanes are found from geometry (stacked,
 * touching lane bodies with their headers on the left), so copies work too.
 */

type El = ExcalidrawElement;
type Props = Record<string, unknown>;

export type FlowKind = "terminal" | "step" | "decision" | "lane" | "laneHead";
export const FLOW_KEY = "udFlow";
export type Direction = "up" | "down" | "left" | "right";

export function flowKind(el: El | null | undefined): FlowKind | null {
  const kind: unknown = el?.customData?.[FLOW_KEY];
  return kind === "terminal" ||
    kind === "step" ||
    kind === "decision" ||
    kind === "lane" ||
    kind === "laneHead"
    ? kind
    : null;
}

const NODE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);
/** Same edge, within this many scene px. */
const TOL = 2;
/** Space between a step and the next one. */
export const STEP_GAP = 64;
/** Room kept between a lane's last step and its right end. */
const LANE_MARGIN = 40;
/** Gap between an arrow's end and its shape, like Excalidraw's own bindings. */
const BIND_GAP = 6;
export const STEP_FILL = "#a5d8ff";
const STEP_SIZE = { width: 180, height: 72 };

const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
const isLinear = (el: El): el is ExcalidrawLinearElement => el.type === "arrow" || el.type === "line";
const isLabel = (el: El) => el.type === "text" && !!el.containerId;
const live = (elements: readonly El[]) => elements.filter((el) => !el.isDeleted);

/** A shape the "+" buttons grow a chart from: a template step, or any box, diamond or ellipse with arrows. */
export function isFlowNode(el: El): boolean {
  if (el.isDeleted || el.locked || el.angle !== 0 || !NODE_TYPES.has(el.type) || tablePart(el)) return false;
  const kind = flowKind(el);
  if (kind === "lane" || kind === "laneHead") return false;
  return kind !== null || (el.boundElements ?? []).some((b) => b.type === "arrow");
}

// --- Lanes -----------------------------------------------------------------------

export interface Lane {
  body: El;
  head: El | null;
}

export interface LaneStack {
  lanes: Lane[];
  /** The lane this was asked about. */
  index: number;
}

/** The swimlane stack a lane body or header belongs to, top to bottom. */
export function laneStack(elements: readonly El[], id: string): LaneStack | null {
  const all = live(elements);
  const heads = all.filter((el) => flowKind(el) === "laneHead");
  const bodies = all.filter((el) => flowKind(el) === "lane");
  let start = all.find((el) => el.id === id);
  if (flowKind(start) === "laneHead") {
    const head = start!;
    start = bodies.find((b) => near(b.x, head.x + head.width) && near(b.y, head.y));
  }
  if (!start || flowKind(start) !== "lane") return null;
  const first = start;
  const column = bodies.filter((b) => near(b.x, first.x) && near(b.width, first.width));
  const stack = [first];
  for (let cur = first; ;) {
    const above = column.find((b) => !stack.includes(b) && near(b.y + b.height, cur.y));
    if (!above) break;
    stack.unshift(above);
    cur = above;
  }
  for (let cur = first; ;) {
    const below = column.find((b) => !stack.includes(b) && near(b.y, cur.y + cur.height));
    if (!below) break;
    stack.push(below);
    cur = below;
  }
  const lanes = stack.map((body) => ({
    body,
    head:
      heads.find((h) => near(h.x + h.width, body.x) && near(h.y, body.y) && near(h.height, body.height)) ??
      null,
  }));
  return { lanes, index: stack.indexOf(first) };
}

/** The lane whose body contains `p`, if any. */
function laneAt(elements: readonly El[], p: Point): LaneStack | null {
  const body = live(elements).find(
    (el) =>
      flowKind(el) === "lane" &&
      p.x >= el.x &&
      p.x <= el.x + el.width &&
      p.y >= el.y &&
      p.y <= el.y + el.height,
  );
  return body ? laneStack(elements, body.id) : null;
}

// --- Moving parts of a chart, arrows included --------------------------------------

function absPoints(a: ExcalidrawLinearElement): Point[] {
  return a.points.map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
}

function linearProps(abs: readonly Point[]): Props {
  const origin = abs[0]!;
  const points = abs.map((p) => [p.x - origin.x, p.y - origin.y]);
  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  return {
    x: origin.x,
    y: origin.y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Where Excalidraw centers an arrow's label: its middle point, or the middle of its middle segment. */
function labelCenter(abs: readonly Point[]): Point {
  const n = abs.length;
  if (n % 2 === 1) return abs[Math.floor(n / 2)]!;
  const a = abs[n / 2 - 1]!;
  const b = abs[n / 2]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Moves an arrow's start and/or end by dy; corners lined up with a moving end move with it, so elbows stay square. */
function moveEnds(a: ExcalidrawLinearElement, dyStart: number, dyEnd: number): Point[] {
  const abs = absPoints(a);
  const first = abs[0]!;
  const last = abs[abs.length - 1]!;
  return abs.map((p, i) => {
    if (i === 0) return { x: p.x, y: p.y + dyStart };
    if (i === abs.length - 1) return { x: p.x, y: p.y + dyEnd };
    let y = p.y;
    if (dyEnd && near(p.y, last.y)) y += dyEnd;
    else if (dyStart && near(p.y, first.y)) y += dyStart;
    return { x: p.x, y };
  });
}

/**
 * Moves the shapes `pick` chooses by dy, with their labels. Arrows between
 * two moved shapes move whole; arrows with one moved end stretch.
 */
function shiftShapes(elements: readonly El[], pick: (el: El) => boolean, dy: number): El[] {
  const all = live(elements);
  const moved = new Set(all.filter((el) => !isLinear(el) && !isLabel(el) && pick(el)).map((el) => el.id));
  const updates = new Map<string, Props>();
  for (const el of all) {
    if (moved.has(el.id)) updates.set(el.id, { y: el.y + dy });
  }
  for (const el of all) {
    if (isLabel(el) && moved.has((el as { containerId: string }).containerId))
      updates.set(el.id, { y: el.y + dy });
  }
  for (const el of all) {
    if (!isLinear(el)) continue;
    const start = !!el.startBinding && moved.has(el.startBinding.elementId);
    const end = !!el.endBinding && moved.has(el.endBinding.elementId);
    const free = !el.startBinding && !el.endBinding && pick(el);
    if (!start && !end && !free) continue;
    const abs =
      start === end || free
        ? absPoints(el).map((p) => ({ x: p.x, y: p.y + dy }))
        : moveEnds(el, start ? dy : 0, end ? dy : 0);
    updates.set(el.id, linearProps(abs));
    const label = all.find((t) => t.type === "text" && t.containerId === el.id);
    if (label) {
      const c = labelCenter(abs);
      updates.set(label.id, { x: c.x - label.width / 2, y: c.y - label.height / 2 });
    }
  }
  return elements.map((el) => {
    const props = updates.get(el.id);
    return props ? newElementWith(el, props as Parameters<typeof newElementWith>[1]) : el;
  });
}

/** Everything at or below `line` that overlaps the chart's columns [x1, x2]. */
const below = (line: number, x1: number, x2: number) => (el: El) => {
  const [bx1, by1, bx2] = localBox(el);
  return by1 >= line - TOL && bx1 < x2 && bx2 > x1;
};

function laneSpan(stack: LaneStack) {
  const { body, head } = stack.lanes[0]!;
  return { x1: Math.min(head?.x ?? body.x, body.x), x2: body.x + body.width };
}

/** Inserts a lane above or below one, pushing the lanes (and steps) below it down. Selects nothing. */
export function addLane(
  elements: readonly El[],
  laneId: string,
  where: "above" | "below",
): { elements: El[]; laneId: string; headId: string | null } | null {
  const stack = laneStack(elements, laneId);
  if (!stack) return null;
  const ref = stack.lanes[stack.index]!;
  const line = where === "below" ? ref.body.y + ref.body.height : ref.body.y;
  const height = ref.body.height;
  const { x1, x2 } = laneSpan(stack);
  const next = shiftShapes(elements, below(line, x1, x2), height);

  const copy = (el: El, kind: FlowKind): El =>
    unordered([
      {
        type: "rectangle",
        x: el.x,
        y: line,
        width: el.width,
        height,
        strokeColor: el.strokeColor,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        roughness: el.roughness,
        opacity: el.opacity,
        backgroundColor: el.backgroundColor,
        fillStyle: el.fillStyle,
        roundness: el.roundness,
        frameId: el.frameId,
        groupIds: [...el.groupIds],
        customData: { [FLOW_KEY]: kind },
      },
    ])[0]!;
  const body = copy(ref.body, "lane");
  const head = ref.head ? copy(ref.head, "laneHead") : null;
  // New lanes go behind the steps, next to the other lanes.
  const at = Math.max(
    ...[ref.body, ref.head].flatMap((el) => (el ? [next.findIndex((n) => n.id === el.id)] : [])),
  );
  return {
    elements: [...next.slice(0, at + 1), body, ...(head ? [head] : []), ...next.slice(at + 1)],
    laneId: body.id,
    headId: head?.id ?? null,
  };
}

/** Deletes a lane with the steps in it and their arrows, and closes the gap. Keeps one lane. */
export function deleteLane(elements: readonly El[], laneId: string): El[] | null {
  const stack = laneStack(elements, laneId);
  if (!stack || stack.lanes.length <= 1) return null;
  const { body, head } = stack.lanes[stack.index]!;
  const all = live(elements);
  const inLane = (el: El) => {
    const c = centerOf(el);
    return c.x >= body.x && c.x <= body.x + body.width && c.y >= body.y && c.y <= body.y + body.height;
  };
  const doomed = new Set<string>([body.id, ...(head ? [head.id] : [])]);
  for (const el of all) {
    const kind = flowKind(el);
    if (!isLinear(el) && !isLabel(el) && kind !== "lane" && kind !== "laneHead" && inLane(el))
      doomed.add(el.id);
  }
  for (const el of all) {
    if (!isLinear(el)) continue;
    const touches =
      doomed.has(el.startBinding?.elementId ?? "") || doomed.has(el.endBinding?.elementId ?? "");
    if (touches || (!el.startBinding && !el.endBinding && inLane(el))) doomed.add(el.id);
  }
  for (const el of all) {
    if (el.type === "text" && el.containerId && doomed.has(el.containerId)) doomed.add(el.id);
  }
  const next = elements.map((el) => {
    if (el.isDeleted) return el;
    if (doomed.has(el.id)) return newElementWith(el, { isDeleted: true });
    if (el.boundElements?.some((b) => doomed.has(b.id))) {
      return newElementWith(el, { boundElements: el.boundElements.filter((b) => !doomed.has(b.id)) });
    }
    return el;
  });
  const { x1, x2 } = laneSpan(stack);
  return shiftShapes(next, below(body.y + body.height, x1, x2), -body.height);
}

// --- Next step -----------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

function anchor(r: Rect, side: Direction): Point {
  switch (side) {
    case "up":
      return { x: r.x + r.width / 2, y: r.y - BIND_GAP };
    case "down":
      return { x: r.x + r.width / 2, y: r.y + r.height + BIND_GAP };
    case "left":
      return { x: r.x - BIND_GAP, y: r.y + r.height / 2 };
    case "right":
      return { x: r.x + r.width + BIND_GAP, y: r.y + r.height / 2 };
  }
}

/** Whether `r` would land on another shape (lanes themselves don't count; their headers do). */
function blocked(elements: readonly El[], r: Rect, except: string): boolean {
  const pad = 12;
  return live(elements).some((el) => {
    if (
      el.id === except ||
      isLinear(el) ||
      el.type === "text" ||
      el.type === "frame" ||
      flowKind(el) === "lane"
    ) {
      return false;
    }
    const [x1, y1, x2, y2] = localBox(el);
    return x1 < r.x + r.width + pad && x2 > r.x - pad && y1 < r.y + r.height + pad && y2 > r.y - pad;
  });
}

/**
 * Adds a step next to `sourceId` in a direction, connected by a bound arrow.
 * In a swimlane, left/right stays in the lane and up/down goes to the lane
 * next door; lanes grow when a step would stick out. New steps look like the
 * source's steps (template steps stay blue rounded boxes).
 */
export function addNextStep(
  elements: readonly El[],
  sourceId: string,
  dir: Direction,
): { elements: El[]; stepId: string } | null {
  const all = live(elements);
  const src = all.find((el) => el.id === sourceId);
  if (!src || !isFlowNode(src)) return null;
  const tagged = flowKind(src) !== null;
  const box = src.type === "rectangle";
  const width = box ? src.width : STEP_SIZE.width;
  const height = box ? src.height : STEP_SIZE.height;
  const c = centerOf(src);

  // Which lane the step goes in, if the source is in a swimlane.
  const here = laneAt(elements, c);
  let lane = here ? here.lanes[here.index]! : null;
  const vertical = dir === "up" || dir === "down";
  if (here && vertical) lane = here.lanes[here.index + (dir === "down" ? 1 : -1)] ?? null;
  const inLanes = !!here && !!lane;

  let r: Rect;
  switch (dir) {
    case "right":
      r = { x: src.x + src.width + STEP_GAP, y: c.y - height / 2, width, height };
      break;
    case "left":
      r = { x: src.x - STEP_GAP - width, y: c.y - height / 2, width, height };
      break;
    case "down":
      r = { x: c.x - width / 2, y: src.y + src.height + STEP_GAP, width, height };
      break;
    case "up":
      r = { x: c.x - width / 2, y: src.y - STEP_GAP - height, width, height };
      break;
  }
  if (inLanes && vertical) r.y = lane!.body.y + (lane!.body.height - height) / 2;
  // Step past anything in the way: along the flow, or to the right within a lane.
  const step = {
    x: dir === "left" ? -(width + STEP_GAP) : dir === "right" || (inLanes && vertical) ? width + STEP_GAP : 0,
    y: inLanes && vertical ? 0 : dir === "up" ? -(height + STEP_GAP) : dir === "down" ? height + STEP_GAP : 0,
  };
  for (let i = 0; i < 20 && blocked(elements, r, src.id); i++) {
    r = { ...r, x: r.x + step.x, y: r.y + step.y };
  }

  const fill = tagged ? (flowKind(src) === "step" ? src.backgroundColor : STEP_FILL) : src.backgroundColor;
  const shape = unordered([
    {
      type: "rectangle",
      ...r,
      strokeColor: src.strokeColor,
      strokeWidth: src.strokeWidth,
      strokeStyle: src.strokeStyle,
      roughness: src.roughness,
      opacity: src.opacity,
      backgroundColor: fill,
      fillStyle: src.fillStyle,
      roundness: box ? src.roundness : { type: ROUNDNESS.ADAPTIVE_RADIUS },
      frameId: src.frameId,
      ...(tagged ? { customData: { [FLOW_KEY]: "step" } } : {}),
    },
  ])[0]!;

  // The arrow: straight along the flow, or square elbows when the step had to shift sideways.
  const from = anchor(src, dir);
  const to = anchor(r, OPPOSITE[dir]);
  let path: Point[] = [from, to];
  if (vertical && !near(from.x, to.x)) {
    // Bend just inside the target's lane, so the sideways leg never runs along a lane line.
    const bendY = to.y + (dir === "down" ? -1 : 1) * Math.min(22, Math.abs(to.y - from.y) / 2);
    path = [from, { x: from.x, y: bendY }, { x: to.x, y: bendY }, to];
  } else if (!vertical && !near(from.y, to.y)) {
    const midX = (from.x + to.x) / 2;
    path = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }
  const like = all.find(
    (el): el is ExcalidrawArrowElement =>
      el.type === "arrow" && (el.startBinding?.elementId === src.id || el.endBinding?.elementId === src.id),
  );
  const geometry = linearProps(path);
  const [base] = unordered([
    {
      type: "arrow",
      x: from.x,
      y: from.y,
      width: geometry.width as number,
      height: geometry.height as number,
      points: geometry.points as unknown as ExcalidrawLinearElement["points"],
      roundness: null,
      strokeColor: like?.strokeColor ?? src.strokeColor,
      strokeWidth: like?.strokeWidth ?? src.strokeWidth,
      strokeStyle: like?.strokeStyle ?? src.strokeStyle,
      roughness: like?.roughness ?? src.roughness,
      startArrowhead: like?.startArrowhead ?? null,
      endArrowhead: like?.endArrowhead ?? "arrow",
      frameId: src.frameId,
    },
  ]);
  const binding = (elementId: string): PointBinding => ({ elementId, focus: 0, gap: BIND_GAP });
  const arrow = {
    ...(base as ExcalidrawArrowElement),
    ...geometry,
    startBinding: binding(src.id),
    endBinding: binding(shape.id),
  } as El;
  const ref = { type: "arrow" as const, id: arrow.id };
  const placed = { ...shape, boundElements: [ref] } as El;

  let next = elements.map((el) =>
    el.id === src.id ? newElementWith(el, { boundElements: [...(el.boundElements ?? []), ref] }) : el,
  );
  // Lanes grow to keep the new step inside.
  if (inLanes) {
    const stack = laneStack(next, lane!.body.id)!;
    const right = r.x + r.width + LANE_MARGIN;
    const end = lane!.body.x + lane!.body.width;
    if (right > end) {
      const ids = new Set(stack.lanes.map((l) => l.body.id));
      next = next.map((el) => (ids.has(el.id) ? newElementWith(el, { width: right - el.x }) : el));
    }
  }
  return { elements: [...next, placed, arrow], stepId: placed.id };
}
