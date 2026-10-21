import { ROUNDNESS, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  FillStyle,
} from "@excalidraw/excalidraw/element/types";

/**
 * Flowchart templates (EDIT-8): ready-made diagrams of ordinary, editable
 * shapes. Arrows are bound to their shapes, so they follow when a step moves.
 * Each template is laid out in its own coordinates; `buildTemplate` moves it
 * to where it's inserted.
 */

type Kind = "terminal" | "step" | "decision" | "laneHead" | "lane";
type Side = "top" | "bottom" | "left" | "right";

interface Node {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  label?: string;
}
interface Link {
  from: string;
  fromSide: Side;
  to: string;
  toSide: Side;
  /** Corner points between the two ends. */
  via?: readonly [number, number][];
  label?: string;
}

export interface FlowchartTemplate {
  id: string;
  name: string;
  description: string;
  nodes: readonly Node[];
  links: readonly Link[];
}

const SIZE: Record<Kind, { w: number; h: number }> = {
  terminal: { w: 160, h: 64 },
  step: { w: 180, h: 72 },
  decision: { w: 200, h: 120 },
  laneHead: { w: 140, h: 160 },
  lane: { w: 960, h: 160 },
};

/** Excalidraw's light palette: green ends, blue steps, yellow questions. */
const FILL: Record<Kind, string> = {
  terminal: "#b2f2bb",
  step: "#a5d8ff",
  decision: "#ffec99",
  laneHead: "#e9ecef",
  lane: "transparent",
};

const step = (id: string, x: number, y: number, label: string): Node => ({ id, kind: "step", x, y, label });
const terminal = (id: string, x: number, y: number, label: string): Node => ({
  id,
  kind: "terminal",
  x,
  y,
  label,
});
const decision = (id: string, x: number, y: number, label: string): Node => ({
  id,
  kind: "decision",
  x,
  y,
  label,
});
const down = (from: string, to: string, label?: string): Link => ({
  from,
  fromSide: "bottom",
  to,
  toSide: "top",
  label,
});
const right = (from: string, to: string, label?: string): Link => ({
  from,
  fromSide: "right",
  to,
  toSide: "left",
  label,
});

export const FLOWCHARTS: readonly FlowchartTemplate[] = [
  {
    id: "process",
    name: "Simple process",
    description: "Start, three steps, done.",
    nodes: [
      terminal("start", 10, 0, "Start"),
      step("a", 0, 120, "Gather what you need"),
      step("b", 0, 248, "Do the work"),
      step("c", 0, 376, "Check the result"),
      terminal("end", 10, 504, "Done"),
    ],
    links: [down("start", "a"), down("a", "b"), down("b", "c"), down("c", "end")],
  },
  {
    id: "timeline",
    name: "Left to right",
    description: "A process that reads across the page.",
    nodes: [
      terminal("start", 0, 4, "Start"),
      step("plan", 224, 0, "Plan"),
      step("build", 468, 0, "Build"),
      step("test", 712, 0, "Test"),
      terminal("end", 956, 4, "Ship it"),
    ],
    links: [right("start", "plan"), right("plan", "build"), right("build", "test"), right("test", "end")],
  },
  {
    id: "decision",
    name: "Yes or no",
    description: "One question, two paths, and a way back.",
    nodes: [
      terminal("start", 20, 0, "Start"),
      step("try", 10, 120, "Do something"),
      decision("ok", 0, 248, "Is it OK?"),
      step("next", 10, 464, "Carry on"),
      terminal("end", 20, 592, "Done"),
      step("fix", 310, 272, "Fix it"),
    ],
    links: [
      down("start", "try"),
      down("try", "ok"),
      down("ok", "next", "Yes"),
      down("next", "end"),
      right("ok", "fix", "No"),
      { from: "fix", fromSide: "top", to: "try", toSide: "right", via: [[400, 156]] },
    ],
  },
  {
    id: "loop",
    name: "Repeat until done",
    description: "A loop that runs until a check passes.",
    nodes: [
      terminal("start", 100, 0, "Start"),
      step("task", 90, 120, "Do the next bit"),
      decision("done", 80, 248, "All done?"),
      terminal("end", 100, 464, "Finish"),
    ],
    links: [
      down("start", "task"),
      down("task", "done"),
      down("done", "end", "Yes"),
      {
        from: "done",
        fromSide: "left",
        to: "task",
        toSide: "left",
        via: [
          [20, 308],
          [20, 156],
        ],
        label: "No",
      },
    ],
  },
  {
    id: "branches",
    name: "Three-way choice",
    description: "One question with three answers that meet again.",
    nodes: [
      terminal("start", 310, 0, "Start"),
      decision("which", 290, 120, "Which way?"),
      step("a", 60, 340, "Do A"),
      step("b", 300, 340, "Do B"),
      step("c", 540, 340, "Do C"),
      terminal("end", 310, 492, "Done"),
    ],
    links: [
      down("start", "which"),
      { from: "which", fromSide: "left", to: "a", toSide: "top", via: [[150, 180]], label: "A" },
      down("which", "b", "B"),
      { from: "which", fromSide: "right", to: "c", toSide: "top", via: [[630, 180]], label: "C" },
      { from: "a", fromSide: "bottom", to: "end", toSide: "left", via: [[150, 524]] },
      down("b", "end"),
      { from: "c", fromSide: "bottom", to: "end", toSide: "right", via: [[630, 524]] },
    ],
  },
  {
    id: "swimlanes",
    name: "Swimlanes",
    description: "Who does what, one lane per person or team.",
    nodes: [
      { id: "lane1", kind: "lane", x: 140, y: 0 },
      { id: "lane2", kind: "lane", x: 140, y: 160 },
      { id: "lane3", kind: "lane", x: 140, y: 320 },
      { id: "head1", kind: "laneHead", x: 0, y: 0, label: "Customer" },
      { id: "head2", kind: "laneHead", x: 0, y: 160, label: "Sales" },
      { id: "head3", kind: "laneHead", x: 0, y: 320, label: "Warehouse" },
      step("order", 180, 44, "Place order"),
      step("confirm", 420, 204, "Confirm order"),
      step("ship", 660, 364, "Pack and ship"),
      step("receive", 900, 44, "Receive order"),
    ],
    links: [
      {
        from: "order",
        fromSide: "right",
        to: "confirm",
        toSide: "left",
        via: [
          [390, 80],
          [390, 240],
        ],
      },
      {
        from: "confirm",
        fromSide: "right",
        to: "ship",
        toSide: "left",
        via: [
          [630, 240],
          [630, 400],
        ],
      },
      {
        from: "ship",
        fromSide: "right",
        to: "receive",
        toSide: "left",
        via: [
          [870, 400],
          [870, 80],
        ],
      },
    ],
  },
];

export interface TemplateStyle {
  strokeColor: string;
  strokeWidth: number;
  roughness: number;
  fillStyle: FillStyle;
  fontFamily: number;
}

/** Gap between an arrow's end and its shape, like Excalidraw's own bindings. */
const GAP = 6;

function anchor(n: Node, side: Side): [number, number] {
  const { w, h } = SIZE[n.kind];
  switch (side) {
    case "top":
      return [n.x + w / 2, n.y - GAP];
    case "bottom":
      return [n.x + w / 2, n.y + h + GAP];
    case "left":
      return [n.x - GAP, n.y + h / 2];
    case "right":
      return [n.x + w + GAP, n.y + h / 2];
  }
}

/** The template's size in its own coordinates. */
export function templateBounds(t: FlowchartTemplate) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of t.nodes) {
    xs.push(n.x, n.x + SIZE[n.kind].w);
    ys.push(n.y, n.y + SIZE[n.kind].h);
  }
  for (const l of t.links) {
    for (const [x, y] of l.via ?? []) {
      xs.push(x);
      ys.push(y);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The template's elements with its top-left corner at `at`; fresh ids every time. */
export function buildTemplate(t: FlowchartTemplate, at: { x: number; y: number }, style: TemplateStyle) {
  const b = templateBounds(t);
  const dx = at.x - b.x;
  const dy = at.y - b.y;
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const line = { strokeColor: style.strokeColor, strokeWidth: style.strokeWidth, roughness: style.roughness };
  const skeletons: ExcalidrawElementSkeleton[] = [];
  for (const n of t.nodes) {
    const { w, h } = SIZE[n.kind];
    const type = n.kind === "terminal" ? "ellipse" : n.kind === "decision" ? "diamond" : "rectangle";
    skeletons.push({
      type,
      id: n.id,
      x: n.x + dx,
      y: n.y + dy,
      width: w,
      height: h,
      backgroundColor: FILL[n.kind],
      fillStyle: n.kind === "laneHead" ? "solid" : style.fillStyle,
      roundness:
        n.kind === "step" ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : n.kind === "lane" ? null : undefined,
      ...line,
      ...(n.label
        ? {
            label: {
              text: n.label,
              fontSize: 20,
              fontFamily: style.fontFamily,
              strokeColor: style.strokeColor,
            },
          }
        : {}),
    } as ExcalidrawElementSkeleton);
  }
  for (const l of t.links) {
    const [x0, y0] = anchor(byId.get(l.from)!, l.fromSide);
    const [x1, y1] = anchor(byId.get(l.to)!, l.toSide);
    const points = [[x0, y0], ...(l.via ?? []), [x1, y1]].map(([x, y]) => [x! - x0, y! - y0]);
    const xs = points.map((p) => p[0]!);
    const ys = points.map((p) => p[1]!);
    skeletons.push({
      type: "arrow",
      x: x0 + dx,
      y: y0 + dy,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points: points as unknown as ExcalidrawLinearElement["points"],
      roundness: null,
      endArrowhead: "arrow",
      start: { id: l.from },
      end: { id: l.to },
      ...line,
      ...(l.label ? { label: { text: l.label, fontSize: 16, fontFamily: style.fontFamily } } : {}),
    } as ExcalidrawElementSkeleton);
  }
  return convertToExcalidrawElements(skeletons).map((el): ExcalidrawElement => ({ ...el, index: null }));
}
