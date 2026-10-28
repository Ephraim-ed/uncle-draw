import { ROUNDNESS, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  FillStyle,
} from "@excalidraw/excalidraw/element/types";
import { FLOW_KEY, type FlowKind } from "../flow/flow";
import { DEFAULT_HEADER_FILL, commit, fill, highlight, newPlan, resizeRow } from "../table/grid";
import { excalidrawText } from "../table/textEngine";

/**
 * Templates (EDIT-8): ready-made diagrams of ordinary, editable shapes.
 * Arrows are bound to their shapes, so they follow when a step moves. Each
 * template is laid out in its own coordinates; `buildTemplate` moves it to
 * where it's inserted. Shapes are tagged with their role, so charts can grow
 * afterwards (flow/flow.ts).
 */

export type Side = "top" | "bottom" | "left" | "right";

export interface Node {
  id: string;
  kind: FlowKind;
  x: number;
  y: number;
  label?: string;
  /** Overrides the kind's fill. */
  fill?: string;
  /** Override the kind's size (a long label needs a bigger box). */
  w?: number;
  h?: number;
  /** Left-aligned label, from the top (a note of bullets). */
  align?: "left";
}
export interface Link {
  from: string;
  fromSide: Side;
  to: string;
  toSide: Side;
  /** Corner points between the two ends. */
  via?: readonly [number, number][];
  /** Square corners worked out from the ends (org charts). */
  elbow?: boolean;
  label?: string;
  /** false: a plain line, no arrowhead (mind maps, org charts). */
  head?: boolean;
}
/** Free text; `x` is its center. */
interface Note {
  text: string;
  x: number;
  y: number;
  size?: number;
}
/** A line that isn't tied to shapes (a timeline's axis). */
interface Path {
  points: readonly [number, number][];
  head?: boolean;
}
/** A table (an editable EDIT-7 table, not just shapes). */
interface TableSpec {
  x: number;
  y: number;
  widths: readonly number[];
  rowHeight: number;
  header: readonly string[];
  rows: readonly (readonly string[])[];
  /** The header row's height, when it isn't `rowHeight`. */
  headerHeight?: number;
  /** Shade the first column like the header (the default). */
  firstColumn?: boolean;
}

export type TemplateCategory = "Flowcharts" | "Planning" | "Diagrams";

/** The name of a saved template nobody named. */
export const UNTITLED_TEMPLATE = "Untitled template";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  nodes: readonly Node[];
  links: readonly Link[];
  notes?: readonly Note[];
  paths?: readonly Path[];
  table?: TableSpec;
}

export const SIZE: Record<FlowKind, { w: number; h: number }> = {
  terminal: { w: 160, h: 64 },
  step: { w: 180, h: 72 },
  decision: { w: 200, h: 120 },
  idea: { w: 220, h: 110 },
  branch: { w: 170, h: 60 },
  person: { w: 180, h: 64 },
  laneHead: { w: 140, h: 160 },
  lane: { w: 960, h: 160 },
  colHead: { w: 240, h: 56 },
  column: { w: 240, h: 440 },
  note: { w: 200, h: 100 },
  milestone: { w: 28, h: 28 },
};

/** Excalidraw's light palette: green ends, blue steps, yellow questions and notes. */
const FILL: Record<FlowKind, string> = {
  terminal: "#b2f2bb",
  step: "#a5d8ff",
  decision: "#ffec99",
  idea: "#ffec99",
  branch: "#a5d8ff",
  person: "#a5d8ff",
  laneHead: DEFAULT_HEADER_FILL,
  lane: "transparent",
  colHead: DEFAULT_HEADER_FILL,
  column: "transparent",
  note: "#ffec99",
  milestone: "#1971c2",
};

/** Kinds filled solid, like paper: headers, sticky notes, timeline dots. */
const SOLID = new Set<FlowKind>(["laneHead", "colHead", "note", "milestone"]);
const ROUNDED = new Set<FlowKind>(["step", "branch", "person"]);
const SQUARE = new Set<FlowKind>(["lane", "laneHead", "column", "colHead", "note"]);

const node =
  (kind: FlowKind) =>
  (id: string, x: number, y: number, label?: string, fill?: string): Node => ({
    id,
    kind,
    x,
    y,
    label,
    fill,
  });
const step = node("step");
const terminal = node("terminal");
const decision = node("decision");
const link = (from: string, fromSide: Side, to: string, toSide: Side, more: Partial<Link> = {}): Link => ({
  from,
  fromSide,
  to,
  toSide,
  ...more,
});
const down = (from: string, to: string, label?: string) => link(from, "bottom", to, "top", { label });
const right = (from: string, to: string, label?: string) => link(from, "right", to, "left", { label });

/** Board columns with sticky notes: headers at the top, notes stacked below. */
export function columns(
  heads: readonly string[],
  cards: readonly (readonly string[])[],
  fills: readonly string[],
): Node[] {
  return heads.flatMap((head, i) => {
    const x = i * 260;
    return [
      { id: `col${i}`, kind: "column" as const, x, y: 56 },
      { id: `head${i}`, kind: "colHead" as const, x, y: 0, label: head },
      ...(cards[i] ?? []).map((text, j) => ({
        id: `card${i}-${j}`,
        kind: "note" as const,
        x: x + 20,
        y: 76 + j * 120,
        label: text,
        fill: fills[i],
      })),
    ];
  });
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "process",
    name: "Simple process",
    description: "Start, three steps, done.",
    category: "Flowcharts",
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
    category: "Flowcharts",
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
    category: "Flowcharts",
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
      link("fix", "top", "try", "right", { via: [[400, 156]] }),
    ],
  },
  {
    id: "loop",
    name: "Repeat until done",
    description: "A loop that runs until a check passes.",
    category: "Flowcharts",
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
      link("done", "left", "task", "left", {
        via: [
          [20, 308],
          [20, 156],
        ],
        label: "No",
      }),
    ],
  },
  {
    id: "branches",
    name: "Three-way choice",
    description: "One question with three answers that meet again.",
    category: "Flowcharts",
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
      link("which", "left", "a", "top", { via: [[150, 180]], label: "A" }),
      down("which", "b", "B"),
      link("which", "right", "c", "top", { via: [[630, 180]], label: "C" }),
      link("a", "bottom", "end", "left", { via: [[150, 524]] }),
      down("b", "end"),
      link("c", "bottom", "end", "right", { via: [[630, 524]] }),
    ],
  },
  {
    id: "swimlanes",
    name: "Swimlanes",
    description: "Who does what, one lane per person or team.",
    category: "Flowcharts",
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
      link("order", "right", "confirm", "left", {
        via: [
          [390, 80],
          [390, 240],
        ],
      }),
      link("confirm", "right", "ship", "left", {
        via: [
          [630, 240],
          [630, 400],
        ],
      }),
      link("ship", "right", "receive", "left", {
        via: [
          [870, 400],
          [870, 80],
        ],
      }),
    ],
  },
  {
    id: "kanban",
    name: "Kanban board",
    description: "To do, doing, done, with cards to move along.",
    category: "Planning",
    nodes: columns(
      ["To do", "Doing", "Done"],
      [["Write the brief", "Book the venue"], ["Draft the agenda"], ["Pick a date"]],
      ["#ffec99", "#ffec99", "#b2f2bb"],
    ),
    links: [],
  },
  {
    id: "retro",
    name: "Retrospective",
    description: "What went well, what to improve, what to try next.",
    category: "Planning",
    nodes: columns(
      ["Went well", "To improve", "Try next"],
      [["Shipped on time", "Great teamwork"], ["Too many meetings"], ["Demo every Friday"]],
      ["#b2f2bb", "#ffc9c9", "#a5d8ff"],
    ),
    links: [],
  },
  {
    id: "milestones",
    name: "Timeline",
    description: "Milestones along a line, with dates underneath.",
    category: "Planning",
    nodes: ["Kickoff", "Design", "Build", "Launch"].flatMap((label, i) => {
      const cx = 120 + i * 250;
      return [
        { id: `phase${i}`, kind: "note" as const, x: cx - 100, y: 0, label, fill: "#a5d8ff" },
        { id: `dot${i}`, kind: "milestone" as const, x: cx - 14, y: 146 },
      ];
    }),
    links: [0, 1, 2, 3].map((i) => link(`phase${i}`, "bottom", `dot${i}`, "top", { head: false })),
    paths: [
      {
        points: [
          [0, 160],
          [1000, 160],
        ],
      },
    ],
    notes: ["Week 1", "Week 3", "Week 6", "Week 8"].map((text, i) => ({
      text,
      x: 120 + i * 250,
      y: 186,
      size: 16,
    })),
  },
  {
    id: "journey",
    name: "User journey",
    description: "What people do, think and feel at each stage.",
    category: "Planning",
    nodes: [],
    links: [],
    table: {
      x: 0,
      y: 0,
      widths: [120, 150, 150, 150, 150, 150],
      rowHeight: 88,
      header: ["", "Discover", "Try", "Buy", "Use", "Tell others"],
      rows: [["Doing"], ["Thinking"], ["Feeling"]],
    },
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "One big idea in the middle, with branches around it.",
    category: "Diagrams",
    nodes: [
      node("idea")("idea", 365, 190, "Big idea"),
      node("branch")("goals", 700, 60, "Goals", "#a5d8ff"),
      node("branch")("people", 740, 215, "People", "#b2f2bb"),
      node("branch")("tools", 700, 370, "Tools", "#ffc9c9"),
      node("branch")("why", 80, 60, "Why now", "#ffec99"),
      node("branch")("risks", 40, 215, "Risks", "#ffc9c9"),
      node("branch")("next", 80, 370, "Next steps", "#b2f2bb"),
    ],
    links: [
      ...["goals", "people", "tools"].map((b) => link("idea", "right", b, "left", { head: false })),
      ...["why", "risks", "next"].map((b) => link("idea", "left", b, "right", { head: false })),
    ],
  },
  {
    id: "orgchart",
    name: "Org chart",
    description: "Who reports to whom, from the top down.",
    category: "Diagrams",
    nodes: [
      node("person")("lead", 330, 0, "Team lead"),
      node("person")("design", 60, 144, "Design"),
      node("person")("eng", 330, 144, "Engineering"),
      node("person")("sales", 600, 144, "Sales"),
      node("person")("front", 230, 288, "Frontend", "#b2f2bb"),
      node("person")("back", 430, 288, "Backend", "#b2f2bb"),
    ],
    links: [
      ["lead", "design"],
      ["lead", "eng"],
      ["lead", "sales"],
      ["eng", "front"],
      ["eng", "back"],
    ].map(([from, to]) => link(from!, "bottom", to!, "top", { elbow: true, head: false })),
  },
];

export interface TemplateStyle {
  strokeColor: string;
  strokeWidth: number;
  roughness: number;
  fillStyle: FillStyle;
  fontFamily: number;
  /** The canvas color, for a table's cells. */
  paper: string;
}

/** Gap between an arrow's end and its shape, like Excalidraw's own bindings. */
const GAP = 6;

const sizeOf = (n: Node) => ({ w: n.w ?? SIZE[n.kind].w, h: n.h ?? SIZE[n.kind].h });

function anchor(n: Node, side: Side): [number, number] {
  const { w, h } = sizeOf(n);
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

function tableSize(t: TableSpec) {
  return { w: t.widths.reduce((a, b) => a + b, 0), h: (t.rows.length + 1) * t.rowHeight };
}

/** The template's size in its own coordinates. */
export function templateBounds(t: Template) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of t.nodes) {
    xs.push(n.x, n.x + sizeOf(n).w);
    ys.push(n.y, n.y + sizeOf(n).h);
  }
  for (const l of t.links) {
    for (const [x, y] of l.via ?? []) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const p of t.paths ?? []) {
    for (const [x, y] of p.points) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const n of t.notes ?? []) {
    // Free text is centred on x; its width is estimated (0.6em a character).
    const size = n.size ?? 20;
    const half = (Math.max(...n.text.split("\n").map((line) => line.length)) * size * 0.6) / 2;
    xs.push(n.x - half, n.x + half);
    ys.push(n.y, n.y + n.text.split("\n").length * size * 1.25);
  }
  if (t.table) {
    const { w, h } = tableSize(t.table);
    xs.push(t.table.x, t.table.x + w);
    ys.push(t.table.y, t.table.y + h);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Points relative to the first, with the bounding size, for a skeleton. */
function pathProps(abs: readonly (readonly [number, number])[]) {
  const [x0, y0] = abs[0]!;
  const points = abs.map(([x, y]) => [x - x0, y - y0]);
  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  return {
    x: x0,
    y: y0,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: points as unknown as ExcalidrawLinearElement["points"],
  };
}

/** The template's elements with its top-left corner at `at`; fresh ids every time. */
export function buildTemplate(
  t: Template,
  at: { x: number; y: number },
  style: TemplateStyle,
): ExcalidrawElement[] {
  const b = templateBounds(t);
  const dx = at.x - b.x;
  const dy = at.y - b.y;
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  // Our own ids, unique per insert, so text can be centered after it's measured.
  const run = crypto.randomUUID().slice(0, 8);
  const idOf = (id: string) => `${run}-${id}`;
  const line = { strokeColor: style.strokeColor, strokeWidth: style.strokeWidth, roughness: style.roughness };
  const skeletons: ExcalidrawElementSkeleton[] = [];

  for (const n of t.nodes) {
    const { w, h } = sizeOf(n);
    const round = n.kind === "terminal" || n.kind === "idea" || n.kind === "milestone";
    const type = round ? "ellipse" : n.kind === "decision" ? "diamond" : "rectangle";
    skeletons.push({
      type,
      id: idOf(n.id),
      x: n.x + dx,
      y: n.y + dy,
      width: w,
      height: h,
      backgroundColor: n.fill ?? FILL[n.kind],
      fillStyle: SOLID.has(n.kind) ? "solid" : style.fillStyle,
      roundness: ROUNDED.has(n.kind)
        ? { type: ROUNDNESS.ADAPTIVE_RADIUS }
        : SQUARE.has(n.kind)
          ? null
          : undefined,
      // Tags let the chart grow later: next steps, more lanes (flow/flow.ts).
      customData: { [FLOW_KEY]: n.kind },
      ...line,
      ...(n.label
        ? {
            label: {
              text: n.label,
              fontSize: n.kind === "note" ? 18 : 20,
              fontFamily: style.fontFamily,
              strokeColor: style.strokeColor,
              ...(n.align ? { textAlign: n.align, verticalAlign: "top" } : {}),
            },
          }
        : {}),
    } as ExcalidrawElementSkeleton);
  }

  for (const l of t.links) {
    const a = anchor(byId.get(l.from)!, l.fromSide);
    const z = anchor(byId.get(l.to)!, l.toSide);
    const midY = (a[1] + z[1]) / 2;
    const via =
      l.elbow && a[0] !== z[0]
        ? ([
            [a[0], midY],
            [z[0], midY],
          ] as const)
        : (l.via ?? []);
    const geometry = pathProps([a, ...via, z].map(([x, y]) => [x + dx, y + dy] as const));
    skeletons.push({
      type: "arrow",
      ...geometry,
      roundness: null,
      startArrowhead: null,
      endArrowhead: l.head === false ? null : "arrow",
      start: { id: idOf(l.from) },
      end: { id: idOf(l.to) },
      ...line,
      ...(l.label ? { label: { text: l.label, fontSize: 16, fontFamily: style.fontFamily } } : {}),
    } as ExcalidrawElementSkeleton);
  }

  for (const p of t.paths ?? []) {
    skeletons.push({
      type: "arrow",
      ...pathProps(p.points.map(([x, y]) => [x + dx, y + dy] as const)),
      roundness: null,
      startArrowhead: null,
      endArrowhead: p.head === false ? null : "arrow",
      ...line,
    } as ExcalidrawElementSkeleton);
  }

  (t.notes ?? []).forEach((n, i) => {
    skeletons.push({
      type: "text",
      id: idOf(`note${i}`),
      text: n.text,
      x: n.x + dx,
      y: n.y + dy,
      fontSize: n.size ?? 20,
      fontFamily: style.fontFamily,
      strokeColor: style.strokeColor,
      textAlign: "center",
    } as ExcalidrawElementSkeleton);
  });

  // Free text is placed by its centre: the converter shifts centre-aligned text left by half itself.
  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false }).map(
    (el): ExcalidrawElement => ({ ...el, index: null }),
  );
  return t.table ? [...elements, ...buildTable(t.table, dx, dy, style)] : elements;
}

/** A template's table: an ordinary EDIT-7 table, header on top and the first column shaded. */
function buildTable(spec: TableSpec, dx: number, dy: number, style: TemplateStyle): ExcalidrawElement[] {
  const look = {
    headerFill: "#a5d8ff",
    cellFill: style.paper,
    border: style.strokeColor,
    borderWidth: 1,
    align: "center" as const,
    roughness: style.roughness,
    dimDone: false,
  };
  const font = { fontSize: 20, fontFamily: style.fontFamily, strokeColor: style.strokeColor };
  const p = newPlan(
    { rows: spec.rows.length, cols: spec.widths.length, header: true, checkboxes: false },
    { x: spec.x + dx, y: spec.y + dy },
    look,
    font,
  );
  p.colW = [...spec.widths];
  if (spec.headerHeight) resizeRow(p, 0, spec.headerHeight);
  spec.rows.forEach((_, i) => resizeRow(p, i + 1, spec.rowHeight));
  fill(p, 0, 0, [spec.header, ...spec.rows]);
  if (spec.firstColumn !== false) {
    highlight(
      p,
      spec.rows.map((_, i) => ({ row: i + 1, col: 0 })),
      DEFAULT_HEADER_FILL,
    );
  }
  return commit([], p, excalidrawText) ?? [];
}
