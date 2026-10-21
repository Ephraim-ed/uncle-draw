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

/**
 * Shape roles in templates. The first six can grow (the "+" buttons): flowchart
 * steps, mind-map ideas and branches, org-chart people. The rest are layout.
 */
const NODE_KINDS = ["terminal", "step", "decision", "idea", "branch", "person"] as const;
const LAYOUT_KINDS = ["lane", "laneHead", "column", "colHead", "note", "milestone"] as const;
export type FlowKind = (typeof NODE_KINDS)[number] | (typeof LAYOUT_KINDS)[number];
export const FLOW_KEY = "udFlow";
export type Direction = "up" | "down" | "left" | "right";

export function flowKind(el: El | null | undefined): FlowKind | null {
  const kind: unknown = el?.customData?.[FLOW_KEY];
  return ([...NODE_KINDS, ...LAYOUT_KINDS] as readonly unknown[]).includes(kind) ? (kind as FlowKind) : null;
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
  if (kind !== null) return (NODE_KINDS as readonly string[]).includes(kind);
  return (el.boundElements ?? []).some((b) => b.type === "arrow");
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

interface Shift {
  dx: number;
  dy: number;
}
const NO_SHIFT: Shift = { dx: 0, dy: 0 };

/** Moves an arrow's start and/or end; corners lined up with a moving end move with it, so elbows stay square. */
function moveEnds(a: ExcalidrawLinearElement, start: Shift, end: Shift): Point[] {
  const abs = absPoints(a);
  const first = abs[0]!;
  const last = abs[abs.length - 1]!;
  return abs.map((p, i) => {
    if (i === 0) return { x: p.x + start.dx, y: p.y + start.dy };
    if (i === abs.length - 1) return { x: p.x + end.dx, y: p.y + end.dy };
    let { x, y } = p;
    if (end.dy && near(p.y, last.y)) y += end.dy;
    else if (start.dy && near(p.y, first.y)) y += start.dy;
    if (end.dx && near(p.x, last.x)) x += end.dx;
    else if (start.dx && near(p.x, first.x)) x += start.dx;
    return { x, y };
  });
}

/**
 * Moves the shapes `pick` chooses by dy, with their labels. Arrows between
 * two moved shapes move whole; arrows with one moved end stretch.
 */
function shiftShapes(elements: readonly El[], pick: (el: El) => boolean, d: Shift): El[] {
  const { dx, dy } = d;
  const all = live(elements);
  const moved = new Set(all.filter((el) => !isLinear(el) && !isLabel(el) && pick(el)).map((el) => el.id));
  const updates = new Map<string, Props>();
  for (const el of all) {
    if (moved.has(el.id)) updates.set(el.id, { x: el.x + dx, y: el.y + dy });
  }
  for (const el of all) {
    if (isLabel(el) && moved.has((el as { containerId: string }).containerId))
      updates.set(el.id, { x: el.x + dx, y: el.y + dy });
  }
  for (const el of all) {
    if (!isLinear(el)) continue;
    const start = !!el.startBinding && moved.has(el.startBinding.elementId);
    const end = !!el.endBinding && moved.has(el.endBinding.elementId);
    const free = !el.startBinding && !el.endBinding && pick(el);
    if (!start && !end && !free) continue;
    const abs =
      start === end || free
        ? absPoints(el).map((p) => ({ x: p.x + dx, y: p.y + dy }))
        : moveEnds(el, start ? d : NO_SHIFT, end ? d : NO_SHIFT);
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
  const next = shiftShapes(elements, below(line, x1, x2), { dx: 0, dy: height });

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
  return shiftShapes(next, below(body.y + body.height, x1, x2), { dx: 0, dy: -body.height });
}

// --- Next step ---------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };
const isVertical = (dir: Direction) => dir === "up" || dir === "down";

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

/** The direction from a to b along whichever axis is longer. */
function directionOf(a: Point, b: Point): Direction {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";
}

/** Shapes that would sit on `r` (lanes and columns themselves don't count; their headers do). */
function blockers(elements: readonly El[], r: Rect, except: string): El[] {
  const pad = 12;
  return live(elements).filter((el) => {
    if (el.id === except || isLinear(el) || el.type === "text" || el.type === "frame") return false;
    const kind = flowKind(el);
    if (kind === "lane" || kind === "column") return false;
    const [x1, y1, x2, y2] = localBox(el);
    return x1 < r.x + r.width + pad && x2 > r.x - pad && y1 < r.y + r.height + pad && y2 > r.y - pad;
  });
}

interface StepLook {
  width: number;
  height: number;
  fill: string;
  fillStyle: El["fillStyle"];
  roundness: El["roundness"];
  kind: FlowKind | null;
}

/**
 * What a new step after `src` looks like: like `src` if it's a box, else like
 * a box it's joined to (so a question's or a mind map's next step matches
 * the others), else a template step.
 */
function stepLook(all: readonly El[], src: El): StepLook {
  const neighbor = all.flatMap((el) => {
    if (el.type !== "arrow") return [];
    const other =
      el.startBinding?.elementId === src.id
        ? el.endBinding?.elementId
        : el.endBinding?.elementId === src.id
          ? el.startBinding?.elementId
          : undefined;
    const shape = other ? all.find((s) => s.id === other) : undefined;
    return shape && shape.type === "rectangle" && isFlowNode(shape) ? [shape] : [];
  })[0];
  const model = src.type === "rectangle" ? src : neighbor;
  const tagged = flowKind(src) !== null;
  if (model) {
    return {
      width: model.width,
      height: model.height,
      fill: model.backgroundColor,
      fillStyle: model.fillStyle,
      roundness: model.roundness,
      kind: flowKind(model) ?? (tagged ? "step" : null),
    };
  }
  return {
    ...STEP_SIZE,
    fill: tagged ? STEP_FILL : src.backgroundColor,
    fillStyle: src.fillStyle,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    kind: tagged ? "step" : null,
  };
}

/**
 * Where a step after `src` goes in a direction, before stepping past
 * anything in the way. In a swimlane, left/right stays in the lane and
 * up/down goes to the middle of the lane next door.
 */
function nextSlot(elements: readonly El[], src: El, dir: Direction, look: StepLook) {
  const { width, height } = look;
  const c = centerOf(src);
  const here = laneAt(elements, c);
  const vertical = isVertical(dir);
  const lane = here
    ? (here.lanes[vertical ? here.index + (dir === "down" ? 1 : -1) : here.index] ?? null)
    : null;
  const r: Rect =
    dir === "right"
      ? { x: src.x + src.width + STEP_GAP, y: c.y - height / 2, width, height }
      : dir === "left"
        ? { x: src.x - STEP_GAP - width, y: c.y - height / 2, width, height }
        : dir === "down"
          ? { x: c.x - width / 2, y: src.y + src.height + STEP_GAP, width, height }
          : { x: c.x - width / 2, y: src.y - STEP_GAP - height, width, height };
  if (lane && vertical) r.y = lane.body.y + (lane.body.height - height) / 2;
  // Past anything in the way: along the flow, or to the right within a lane.
  const past: Shift =
    lane && vertical
      ? { dx: width + STEP_GAP, dy: 0 }
      : dir === "left"
        ? { dx: -(width + STEP_GAP), dy: 0 }
        : dir === "right"
          ? { dx: width + STEP_GAP, dy: 0 }
          : { dx: 0, dy: dir === "up" ? -(height + STEP_GAP) : height + STEP_GAP };
  return { r, lane, past };
}

function stepPast(elements: readonly El[], r: Rect, past: Shift, except: string): Rect {
  let at = r;
  for (let i = 0; i < 20 && blockers(elements, at, except).length > 0; i++) {
    at = { ...at, x: at.x + past.dx, y: at.y + past.dy };
  }
  return at;
}

function makeStep(src: El, look: StepLook, r: Rect): El {
  return unordered([
    {
      type: "rectangle",
      ...r,
      strokeColor: src.strokeColor,
      strokeWidth: src.strokeWidth,
      strokeStyle: src.strokeStyle,
      roughness: src.roughness,
      opacity: src.opacity,
      backgroundColor: look.fill,
      fillStyle: look.fillStyle,
      roundness: look.roundness,
      frameId: src.frameId,
      ...(look.kind ? { customData: { [FLOW_KEY]: look.kind } } : {}),
    },
  ])[0]!;
}

/** An arrow's corners: straight along the flow, or square elbows when the ends don't line up. */
function route(from: Point, to: Point, dir: Direction): Point[] {
  if (isVertical(dir) && !near(from.x, to.x)) {
    // Bend near the target, so a sideways leg never runs along a lane line.
    const bendY = to.y + (dir === "down" ? -1 : 1) * Math.min(22, Math.abs(to.y - from.y) / 2);
    return [from, { x: from.x, y: bendY }, { x: to.x, y: bendY }, to];
  }
  if (!isVertical(dir) && !near(from.y, to.y)) {
    const midX = (from.x + to.x) / 2;
    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }
  return [from, to];
}

const binding = (elementId: string): PointBinding => ({ elementId, focus: 0, gap: BIND_GAP });

/** A new arrow along `path` from one shape to another, styled like `like` (or the shape `style`). */
function makeArrow(
  path: readonly Point[],
  fromId: string,
  toId: string,
  style: El,
  like?: ExcalidrawArrowElement,
): El {
  const geometry = linearProps(path);
  const [base] = unordered([
    {
      type: "arrow",
      x: path[0]!.x,
      y: path[0]!.y,
      width: geometry.width as number,
      height: geometry.height as number,
      points: geometry.points as unknown as ExcalidrawLinearElement["points"],
      roundness: null,
      strokeColor: like?.strokeColor ?? style.strokeColor,
      strokeWidth: like?.strokeWidth ?? style.strokeWidth,
      strokeStyle: like?.strokeStyle ?? style.strokeStyle,
      roughness: like?.roughness ?? style.roughness,
      startArrowhead: like ? like.startArrowhead : null,
      endArrowhead: like ? like.endArrowhead : "arrow",
      frameId: style.frameId,
    },
  ]);
  return {
    ...(base as ExcalidrawArrowElement),
    ...geometry,
    startBinding: binding(fromId),
    endBinding: binding(toId),
  } as El;
}

/** Lanes grow wider so every step in their stack keeps a margin before the end. */
function fitLanes(elements: El[], laneId: string | undefined): El[] {
  const stack = laneId ? laneStack(elements, laneId) : null;
  if (!stack) return elements;
  const bodies = stack.lanes.map((l) => l.body);
  const top = Math.min(...bodies.map((b) => b.y));
  const bottom = Math.max(...bodies.map((b) => b.y + b.height));
  const left = bodies[0]!.x;
  const right = Math.max(
    0,
    ...live(elements)
      .filter((el) => {
        const kind = flowKind(el);
        if (isLinear(el) || el.type === "text" || kind === "lane" || kind === "laneHead") return false;
        const c = centerOf(el);
        return c.y > top && c.y < bottom && c.x > left;
      })
      .map((el) => el.x + el.width + LANE_MARGIN),
  );
  if (right <= left + bodies[0]!.width) return elements;
  const ids = new Set(bodies.map((b) => b.id));
  return elements.map((el) => (ids.has(el.id) ? newElementWith(el, { width: right - el.x }) : el));
}

const arrowAt = (all: readonly El[], shapeId: string) =>
  all.find(
    (el): el is ExcalidrawArrowElement =>
      el.type === "arrow" && (el.startBinding?.elementId === shapeId || el.endBinding?.elementId === shapeId),
  );

/**
 * Adds a step next to `sourceId` in a direction, connected by a bound arrow.
 * In a swimlane, left/right stays in the lane and up/down goes to the lane
 * next door; lanes grow when a step would stick out. The new step looks like
 * its neighbors.
 */
export function addNextStep(
  elements: readonly El[],
  sourceId: string,
  dir: Direction,
): { elements: El[]; stepId: string } | null {
  const all = live(elements);
  const src = all.find((el) => el.id === sourceId);
  if (!src || !isFlowNode(src)) return null;
  const look = stepLook(all, src);
  const slot = nextSlot(elements, src, dir, look);
  const r = stepPast(elements, slot.r, slot.past, src.id);
  const shape = makeStep(src, look, r);
  const path = route(anchor(src, dir), anchor(r, OPPOSITE[dir]), dir);
  const arrow = makeArrow(path, src.id, shape.id, src, arrowAt(all, src.id));
  const ref = { type: "arrow" as const, id: arrow.id };
  const placed = { ...shape, boundElements: [ref] } as El;
  const next = elements.map((el) =>
    el.id === src.id ? newElementWith(el, { boundElements: [...(el.boundElements ?? []), ref] }) : el,
  );
  return { elements: fitLanes([...next, placed, arrow], slot.lane?.body.id), stepId: placed.id };
}

/** Shapes reachable from `fromId` by following arrows forward, never through `stopId`. */
function downstream(all: readonly El[], fromId: string, stopId: string): Set<string> {
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const el of all) {
      if (el.type !== "arrow" || el.startBinding?.elementId !== id) continue;
      const next = el.endBinding?.elementId;
      if (next && next !== stopId && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** An arrow between two flowchart steps, which a step can be inserted into. */
export function isSplittable(el: El, elements: readonly El[]): boolean {
  if (el.type !== "arrow" || el.isDeleted || el.locked) return false;
  const ends = [el.startBinding?.elementId, el.endBinding?.elementId].map((id) =>
    id ? elements.find((s) => s.id === id && !s.isDeleted) : undefined,
  );
  return ends.every((s) => !!s && isFlowNode(s));
}

/** Where to show the "insert a step" button for an arrow: its middle (scene coords). */
export function arrowMiddle(el: El): Point | null {
  return el.type === "arrow" ? labelCenter(absPoints(el)) : null;
}

/**
 * Splits the arrow between two steps with a new step. It goes where the
 * arrow leaves its start; if the next steps are in the way, they (and
 * everything after them) move along to make room. The arrow keeps its label
 * and now ends at the new step; a new arrow goes on to the old target.
 */
export function insertStep(
  elements: readonly El[],
  arrowId: string,
): { elements: El[]; stepId: string } | null {
  const all = live(elements);
  const arrow = all.find((el): el is ExcalidrawArrowElement => el.id === arrowId && el.type === "arrow");
  if (!arrow || !isSplittable(arrow, all)) return null;
  const from = all.find((el) => el.id === arrow.startBinding!.elementId)!;
  const target = all.find((el) => el.id === arrow.endBinding!.elementId)!;

  const abs = absPoints(arrow);
  const dir = directionOf(abs[0]!, abs[1] ?? centerOf(target));
  const look = stepLook(all, from);
  const slot = nextSlot(elements, from, dir, look);
  let next: El[] = [...elements];
  // Make room: the steps after this one move along.
  const after = downstream(all, target.id, from.id);
  if (blockers(next, slot.r, from.id).some((el) => after.has(el.id))) {
    next = shiftShapes(next, (el) => after.has(el.id), slot.past);
  }
  const r = stepPast(next, slot.r, slot.past, from.id);
  const shape = makeStep(from, look, r);

  // The old arrow now ends at the new step; a new one goes on to the old target.
  const toShape = route(anchor(from, dir), anchor(r, OPPOSITE[dir]), dir);
  const label = live(next).find((t) => t.type === "text" && t.containerId === arrow.id);
  const moved = live(next).find((el) => el.id === target.id)!;
  const onward = directionOf(centerOf(shape), centerOf(moved));
  const onwardPath = route(anchor(r, onward), anchor(moved, OPPOSITE[onward]), onward);
  const onwardArrow = makeArrow(onwardPath, shape.id, target.id, from, arrow);
  const placed = {
    ...shape,
    boundElements: [
      { type: "arrow" as const, id: arrow.id },
      { type: "arrow" as const, id: onwardArrow.id },
    ],
  } as El;
  next = next.map((el) => {
    if (el.id === arrow.id) {
      const update = { ...linearProps(toShape), endBinding: binding(shape.id) };
      return newElementWith(el, update as Parameters<typeof newElementWith>[1]);
    }
    if (label && el.id === label.id) {
      const c = labelCenter(toShape);
      return newElementWith(el, { x: c.x - label.width / 2, y: c.y - label.height / 2 });
    }
    if (el.id === target.id) {
      const bound = (el.boundElements ?? []).map((b) =>
        b.id === arrow.id ? { ...b, id: onwardArrow.id } : b,
      );
      return newElementWith(el, { boundElements: bound });
    }
    return el;
  });
  const lane = slot.lane?.body.id ?? laneAt(next, centerOf(from))?.lanes[0]?.body.id;
  return { elements: fitLanes([...next, placed, onwardArrow], lane), stepId: placed.id };
}
