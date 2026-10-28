import dagre from "@dagrejs/dagre";
import { STEP_GAP, type FlowKind } from "../editor/flow/flow";
import { columns, SIZE, type Link, type Node, type Side, type Template } from "../editor/templates/templates";
import { ConnectorError, LIMITS, type ChartSpec, type NodeRole } from "./types";

/**
 * Charts from nodes and links (AI-2): Claude says what's connected, this
 * works out where everything goes and returns an ordinary template, so the
 * shapes come out tagged like the built-in ones and can grow afterwards.
 */

type SpecNode = ChartSpec["nodes"][number];
type SpecLink = ChartSpec["links"][number];
interface Item {
  key: string;
  spec: SpecNode;
  kind: FlowKind;
  w: number;
  h: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Space between neighbours in the same rank. */
const NODE_SEP = 48;
/** Space between tree levels. */
const LEVEL_GAP = 80;
/** How far loops back up a chart run outside it. */
const DETOUR = 40;
/** Room kept after a lane's last step (same as flow.ts). */
const LANE_MARGIN = 40;
const CARD_GAP = 20;
const TIMELINE_SPACING = 250;
const TITLE_SIZE = 28;
/** Mind-map branches take these in turn; their sub-branches keep their colour. */
const BRANCH_FILLS = ["#a5d8ff", "#b2f2bb", "#ffc9c9", "#ffec99"];

// --- sizing ---------------------------------------------------------------------

/** Share of a shape's width its label can use. */
const TEXT_SHARE: Partial<Record<FlowKind, number>> = { decision: 0.5, terminal: 0.7, idea: 0.7 };
const PAD = 10;
/** Matches the estimate the server's canvas stand-in measures with (server/mcp/dom.ts). */
const CHAR_EM = 0.6;

/** Width in characters of `line`, counting CJK and emoji as wide. */
export function textUnits(line: string): number {
  let units = 0;
  for (const ch of line) units += ch.codePointAt(0)! >= 0x1100 ? 1 / CHAR_EM : 1;
  return units;
}

/** The kind's size, grown so `label` fits: wider first (up to 2×), then taller. */
export function fitSize(
  kind: FlowKind,
  label: string | undefined,
  maxW = 2 * SIZE[kind].w,
): { w: number; h: number } {
  const base = SIZE[kind];
  if (!label) return base;
  const share = TEXT_SHARE[kind] ?? 1;
  const fontPx = kind === "note" ? 18 : 20;
  const charW = CHAR_EM * fontPx;
  const lineH = fontPx * 1.25;
  const lines = label.split("\n").map(textUnits);
  const longest = Math.max(...lines) * charW;
  const usable = (w: number) => w * share - 2 * PAD;
  const w = longest > usable(base.w) ? Math.min(maxW, Math.ceil((longest + 2 * PAD) / share)) : base.w;
  const perLine = Math.max(1, Math.floor(usable(w) / charW));
  const count = lines.reduce((sum, units) => sum + Math.max(1, Math.ceil(units / perLine)), 0);
  // Words wrap early; leave a spare line once text wraps at all.
  const textH = (count + (count > lines.length ? 1 : 0)) * lineH + 2 * PAD;
  return { w, h: Math.max(base.h, Math.ceil(textH / (share === 1 ? 1 : share + 0.25))) };
}

const ROLE_KIND: Record<NodeRole, FlowKind> = {
  step: "step",
  decision: "decision",
  terminal: "terminal",
  note: "note",
};

// --- checks -----------------------------------------------------------------------

function check(spec: ChartSpec): void {
  if (spec.nodes.length === 0) throw new ConnectorError("A chart needs at least one item.");
  if (spec.nodes.length > LIMITS.nodes)
    throw new ConnectorError(`A chart can have at most ${LIMITS.nodes} items.`);
  if (spec.links.length > LIMITS.links)
    throw new ConnectorError(`A chart can have at most ${LIMITS.links} links.`);
  if ((spec.lanes?.length ?? 0) > LIMITS.lanes)
    throw new ConnectorError(`A chart can have at most ${LIMITS.lanes} lanes.`);
  const ids = new Set<string>();
  for (const node of spec.nodes) {
    if (ids.has(node.id)) throw new ConnectorError(`Two items share the id "${node.id}".`);
    ids.add(node.id);
    tooLong(node.label);
  }
  for (const link of spec.links) {
    for (const end of [link.from, link.to]) {
      if (!ids.has(end)) throw new ConnectorError(`A link points at "${end}", which isn't one of the items.`);
    }
    if (link.from === link.to)
      throw new ConnectorError(`A link from "${link.from}" can't point back at itself.`);
    if (link.label) tooLong(link.label);
  }
  for (const lane of spec.lanes ?? []) tooLong(lane);
  if (spec.title) tooLong(spec.title);
}

function tooLong(text: string) {
  if (text.length > LIMITS.label) {
    throw new ConnectorError(`Labels can be at most ${LIMITS.label} characters ("${text.slice(0, 40)}…").`);
  }
}

/** Lanes in order: as given, or as they first appear. Every item must name one. */
function lanesOf(spec: ChartSpec): string[] {
  const lanes = spec.lanes ? [...spec.lanes] : [];
  for (const node of spec.nodes) {
    if (!node.lane)
      throw new ConnectorError(`"${node.id}" needs a lane: every item in this chart sits in one.`);
    if (!lanes.includes(node.lane)) {
      if (spec.lanes)
        throw new ConnectorError(`"${node.id}" is in lane "${node.lane}", which isn't in the list of lanes.`);
      lanes.push(node.lane);
    }
  }
  if (lanes.length > LIMITS.lanes)
    throw new ConnectorError(`A chart can have at most ${LIMITS.lanes} lanes.`);
  return lanes;
}

// --- links ------------------------------------------------------------------------

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The link as a template link, with sides and corners picked from where its ends ended up. */
function route(
  link: SpecLink,
  from: string,
  to: string,
  a: Box,
  z: Box,
  flow: "down" | "right",
  detour: () => number,
): Link {
  const ca = center(a);
  const cz = center(z);
  const base = {
    from,
    to,
    ...(link.label ? { label: link.label } : {}),
    ...(link.arrow === false ? { head: false } : {}),
  };
  const side = (fromSide: Side, toSide: Side, more: Partial<Link> = {}): Link => ({
    ...base,
    fromSide,
    toSide,
    ...more,
  });
  const across = (): Link => {
    const right = cz.x >= ca.x;
    const midX = right ? (a.x + a.w + z.x) / 2 : (z.x + z.w + a.x) / 2;
    const via =
      Math.abs(ca.y - cz.y) > 1
        ? { via: [[midX, ca.y] as [number, number], [midX, cz.y] as [number, number]] }
        : {};
    return right ? side("right", "left", via) : side("left", "right", via);
  };
  const upDown = (): Link =>
    cz.y >= ca.y ? side("bottom", "top", { elbow: true }) : side("top", "bottom", { elbow: true });

  if (flow === "down") {
    if (z.y >= a.y + a.h) return upDown();
    if (z.y + z.h <= a.y) {
      // Back up the chart: around the left, outside everything.
      const x = detour();
      return side("left", "left", {
        via: [
          [x, ca.y],
          [x, cz.y],
        ],
      });
    }
    return across();
  }
  if (z.x >= a.x + a.w) return across();
  if (z.x + z.w <= a.x) {
    // Back along the chart: underneath, outside everything.
    const y = detour();
    return side("bottom", "bottom", {
      via: [
        [ca.x, y],
        [cz.x, y],
      ],
    });
  }
  return upDown();
}

// --- layouts ------------------------------------------------------------------------

/** dagre's placement, as top-left corners. */
function ranked(
  items: Item[],
  links: readonly SpecLink[],
  keyOf: Map<string, string>,
  rankdir: "TB" | "LR",
): Map<string, Box> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, nodesep: NODE_SEP, ranksep: STEP_GAP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const item of items) g.setNode(item.key, { width: item.w, height: item.h });
  links.forEach((link, i) => g.setEdge(keyOf.get(link.from)!, keyOf.get(link.to)!, {}, `e${i}`));
  dagre.layout(g);
  const boxes = new Map<string, Box>();
  for (const item of items) {
    const { x, y } = g.node(item.key);
    boxes.set(item.key, {
      x: Math.round(x - item.w / 2),
      y: Math.round(y - item.h / 2),
      w: item.w,
      h: item.h,
    });
  }
  return boxes;
}

const toNode = (item: Item, b: Box, more: Partial<Node> = {}): Node => ({
  id: item.key,
  kind: item.kind,
  x: b.x,
  y: b.y,
  label: item.spec.label,
  ...(item.w !== SIZE[item.kind].w ? { w: item.w } : {}),
  ...(item.h !== SIZE[item.kind].h ? { h: item.h } : {}),
  ...more,
});

/** Detour positions just outside `edge`, one further out per loop. */
function detours(edge: number, sign: 1 | -1) {
  let n = 0;
  return () => edge + sign * DETOUR * ++n;
}

function flowchart(spec: ChartSpec, items: Item[], keyOf: Map<string, string>) {
  const flow = spec.direction === "right" ? "right" : "down";
  const boxes = ranked(items, spec.links, keyOf, flow === "right" ? "LR" : "TB");
  const all = [...boxes.values()];
  const detour =
    flow === "down"
      ? detours(Math.min(...all.map((b) => b.x)), -1)
      : detours(Math.max(...all.map((b) => b.y + b.h)), 1);
  return {
    nodes: items.map((item) => toNode(item, boxes.get(item.key)!)),
    links: spec.links.map((link) => {
      const from = keyOf.get(link.from)!;
      const to = keyOf.get(link.to)!;
      return route(link, from, to, boxes.get(from)!, boxes.get(to)!, flow, detour);
    }),
  };
}

function swimlanes(spec: ChartSpec, items: Item[], keyOf: Map<string, string>) {
  const lanes = lanesOf(spec);
  const order = ranked(items, spec.links, keyOf, "LR");
  const headW = SIZE.laneHead.w;
  const firstX = headW + LANE_MARGIN;
  const minX = Math.min(...[...order.values()].map((b) => b.x));
  const rowH = lanes.map((lane) =>
    Math.max(
      SIZE.lane.h,
      ...items.filter((item) => item.spec.lane === lane).map((item) => item.h + 2 * LANE_MARGIN),
    ),
  );
  const rowY = rowH.map((_, i) => rowH.slice(0, i).reduce((a, b) => a + b, 0));

  const boxes = new Map<string, Box>();
  lanes.forEach((lane, row) => {
    const inLane = items
      .filter((item) => item.spec.lane === lane)
      .sort((p, q) => order.get(p.key)!.x - order.get(q.key)!.x);
    let next = -Infinity;
    for (const item of inLane) {
      const x = Math.max(order.get(item.key)!.x - minX + firstX, next);
      boxes.set(item.key, { x, y: rowY[row]! + Math.round((rowH[row]! - item.h) / 2), w: item.w, h: item.h });
      next = x + item.w + NODE_SEP;
    }
  });

  const right = Math.max(...[...boxes.values()].map((b) => b.x + b.w));
  const laneW = right + LANE_MARGIN - headW;
  const frame: Node[] = lanes.flatMap((lane, i) => [
    { id: `lane${i}`, kind: "lane", x: headW, y: rowY[i]!, w: laneW, h: rowH[i]! },
    { id: `head${i}`, kind: "laneHead", x: 0, y: rowY[i]!, label: lane, h: rowH[i]! },
  ]);
  return {
    nodes: [...frame, ...items.map((item) => toNode(item, boxes.get(item.key)!))],
    links: spec.links.map((link) => {
      const from = keyOf.get(link.from)!;
      const to = keyOf.get(link.to)!;
      return route(
        link,
        from,
        to,
        boxes.get(from)!,
        boxes.get(to)!,
        "right",
        detours(rowY.at(-1)! + rowH.at(-1)!, 1),
      );
    }),
  };
}

/** Children in link order; each item has at most one parent and there are no loops. */
function treeOf(spec: ChartSpec, keyOf: Map<string, string>) {
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const link of spec.links) {
    const from = keyOf.get(link.from)!;
    const to = keyOf.get(link.to)!;
    if (parent.has(to))
      throw new ConnectorError(`"${link.to}" has two parents; in this chart each item has one.`);
    parent.set(to, from);
    children.set(from, [...(children.get(from) ?? []), to]);
  }
  const roots = [...keyOf.values()].filter((key) => !parent.has(key));
  const seen = new Set<string>();
  const visit = (key: string) => {
    seen.add(key);
    for (const child of children.get(key) ?? []) visit(child);
  };
  roots.forEach(visit);
  if (seen.size !== keyOf.size)
    throw new ConnectorError("The links go round in a circle; this chart needs a tree.");
  return { roots, kids: (key: string) => children.get(key) ?? [] };
}

/**
 * A tidy tree along one axis: `breadth` is across siblings, `depth` from
 * parent to child. Each parent sits centred over the span of its children.
 */
function tidyTree(
  roots: readonly string[],
  kids: (key: string) => string[],
  size: (key: string) => { breadth: number; depth: number },
  gap: number,
): Map<string, { across: number; level: number }> {
  const span = new Map<string, number>();
  const measure = (key: string): number => {
    const c = kids(key);
    const childSpan = c.reduce((sum, k) => sum + measure(k), 0) + gap * Math.max(0, c.length - 1);
    const s = Math.max(size(key).breadth, childSpan);
    span.set(key, s);
    return s;
  };
  const out = new Map<string, { across: number; level: number }>();
  const place = (key: string, start: number, level: number) => {
    const c = kids(key);
    const childSpan = c.reduce((sum, k) => sum + span.get(k)!, 0) + gap * Math.max(0, c.length - 1);
    let at = start + (span.get(key)! - childSpan) / 2;
    for (const k of c) {
      place(k, at, level + 1);
      at += span.get(k)! + gap;
    }
    out.set(key, { across: start + (span.get(key)! - size(key).breadth) / 2, level });
  };
  let start = 0;
  for (const root of roots) {
    measure(root);
    place(root, start, 0);
    start += span.get(root)! + gap;
  }
  return out;
}

/** Offsets of each level along the depth axis, from the deepest item at each level. */
function levelOffsets(levels: Map<string, { level: number }>, depth: (key: string) => number, gap: number) {
  const deepest: number[] = [];
  for (const [key, { level }] of levels) deepest[level] = Math.max(deepest[level] ?? 0, depth(key));
  const offsets = [0];
  for (let i = 1; i < deepest.length; i++) offsets.push(offsets[i - 1]! + deepest[i - 1]! + gap);
  return offsets;
}

function orgchart(spec: ChartSpec, items: Item[], keyOf: Map<string, string>) {
  const { roots, kids } = treeOf(spec, keyOf);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const levels = tidyTree(
    roots,
    kids,
    (k) => ({ breadth: byKey.get(k)!.w, depth: byKey.get(k)!.h }),
    NODE_SEP,
  );
  const offsets = levelOffsets(levels, (k) => byKey.get(k)!.h, LEVEL_GAP);
  return {
    nodes: items.map((item) => {
      const { across, level } = levels.get(item.key)!;
      return toNode(item, { x: Math.round(across), y: offsets[level]!, w: item.w, h: item.h });
    }),
    links: spec.links.map((link): Link => ({
      from: keyOf.get(link.from)!,
      fromSide: "bottom",
      to: keyOf.get(link.to)!,
      toSide: "top",
      elbow: true,
      head: false,
      ...(link.label ? { label: link.label } : {}),
    })),
  };
}

function mindmap(spec: ChartSpec, items: Item[], keyOf: Map<string, string>) {
  const { roots, kids } = treeOf(spec, keyOf);
  if (roots.length !== 1)
    throw new ConnectorError("A mind map has one big idea in the middle; link every other item to it.");
  const root = roots[0]!;
  const byKey = new Map(items.map((item) => [item.key, item]));
  const first = kids(root);
  const half = Math.ceil(first.length / 2);
  const fills = new Map<string, string>();
  const paint = (key: string, fill: string) => {
    fills.set(key, fill);
    kids(key).forEach((k) => paint(k, fill));
  };
  first.forEach((k, i) => paint(k, BRANCH_FILLS[i % BRANCH_FILLS.length]!));

  const rootItem = byKey.get(root)!;
  const boxes = new Map<string, Box>([[root, { x: 0, y: 0, w: rootItem.w, h: rootItem.h }]]);
  const sideOf = new Map<string, 1 | -1>();
  for (const [sign, branch] of [
    [1, first.slice(0, half)],
    [-1, first.slice(half)],
  ] as const) {
    if (branch.length === 0) continue;
    const levels = tidyTree(
      branch,
      kids,
      (k) => ({ breadth: byKey.get(k)!.h, depth: byKey.get(k)!.w }),
      NODE_SEP / 2,
    );
    const offsets = levelOffsets(levels, (k) => byKey.get(k)!.w, LEVEL_GAP);
    const height = Math.max(...[...levels].map(([k, v]) => v.across + byKey.get(k)!.h));
    const top = rootItem.h / 2 - height / 2;
    for (const [key, { across, level }] of levels) {
      const item = byKey.get(key)!;
      const reach = LEVEL_GAP + 20 + offsets[level]!;
      const x = sign === 1 ? rootItem.w + reach : -reach - item.w;
      boxes.set(key, { x, y: Math.round(top + across), w: item.w, h: item.h });
      sideOf.set(key, sign);
    }
  }
  return {
    nodes: items.map((item) =>
      toNode(item, boxes.get(item.key)!, item.key === root ? {} : { fill: fills.get(item.key) }),
    ),
    links: spec.links.map((link): Link => {
      const to = keyOf.get(link.to)!;
      const right = sideOf.get(to) === 1;
      return {
        from: keyOf.get(link.from)!,
        fromSide: right ? "right" : "left",
        to,
        toSide: right ? "left" : "right",
        head: false,
        ...(link.label ? { label: link.label } : {}),
      };
    }),
  };
}

function kanban(spec: ChartSpec) {
  const lanes = lanesOf(spec);
  const cards = lanes.map((lane) =>
    spec.nodes.filter((node) => node.lane === lane).map((node) => node.label),
  );
  const nodes = columns(
    lanes,
    cards,
    lanes.map(() => "#ffec99"),
  );
  // columns() spaces cards for the default size; restack them as they grew and stretch the column.
  const noteW = SIZE.note.w;
  lanes.forEach((_, i) => {
    let y = nodes.find((node) => node.id === `col${i}`)!.y + CARD_GAP;
    for (const card of nodes.filter((node) => node.id.startsWith(`card${i}-`))) {
      const { h } = fitSize("note", card.label, noteW);
      card.y = y;
      if (h !== SIZE.note.h) card.h = h;
      y += h + CARD_GAP;
    }
    const column = nodes.find((node) => node.id === `col${i}`)!;
    const needed = y - column.y;
    if (needed > SIZE.column.h) column.h = needed;
  });
  return { nodes, links: [] };
}

function timeline(items: Item[]) {
  const spacing = Math.max(TIMELINE_SPACING, ...items.map((item) => item.w + 50));
  const tallest = Math.max(...items.map((item) => item.h));
  const dotY = tallest + 46;
  const axisY = dotY + SIZE.milestone.h / 2;
  const nodes: Node[] = items.flatMap((item, i) => {
    const cx = 120 + i * spacing;
    return [
      toNode(item, { x: cx - item.w / 2, y: 0, w: item.w, h: item.h }, { fill: "#a5d8ff" }),
      { id: `dot${i}`, kind: "milestone" as const, x: cx - SIZE.milestone.w / 2, y: dotY },
    ];
  });
  const end = 120 + (items.length - 1) * spacing + 120;
  return {
    nodes,
    links: items.map((item, i): Link => ({
      from: item.key,
      fromSide: "bottom",
      to: `dot${i}`,
      toSide: "top",
      head: false,
    })),
    paths: [{ points: [[0, axisY] as [number, number], [end, axisY] as [number, number]] }],
  };
}

// --- entry point -------------------------------------------------------------------

/** A laid-out template for the chart. Throws ConnectorError when the spec can't be drawn. */
export function chartTemplate(spec: ChartSpec): Template {
  check(spec);
  const keyOf = new Map(spec.nodes.map((node, i) => [node.id, `n${i}`]));
  const kindOf = (node: SpecNode): FlowKind => {
    switch (spec.kind) {
      case "mindmap":
        return "branch";
      case "orgchart":
        return "person";
      case "timeline":
      case "kanban":
        return "note";
      default:
        return ROLE_KIND[node.role ?? "step"];
    }
  };
  let items: Item[] = spec.nodes.map((node) => {
    const kind = kindOf(node);
    return { key: keyOf.get(node.id)!, spec: node, kind, ...fitSize(kind, node.label) };
  });

  let laid: Pick<Template, "nodes" | "links"> & { paths?: Template["paths"] };
  switch (spec.kind) {
    case "swimlanes":
      laid = swimlanes(spec, items, keyOf);
      break;
    case "orgchart":
      laid = orgchart(spec, items, keyOf);
      break;
    case "mindmap": {
      // The big idea is the one item nothing links to.
      const targets = new Set(spec.links.map((link) => keyOf.get(link.to)));
      items = items.map((item) =>
        targets.has(item.key) ? item : { ...item, kind: "idea", ...fitSize("idea", item.spec.label) },
      );
      laid = mindmap(spec, items, keyOf);
      break;
    }
    case "kanban":
      laid = kanban(spec);
      break;
    case "timeline":
      laid = timeline(items);
      break;
    default:
      laid = flowchart(spec, items, keyOf);
  }

  const template: Template = {
    id: "chart",
    name: spec.title ?? "Chart",
    description: "",
    category: spec.kind === "flowchart" || spec.kind === "swimlanes" ? "Flowcharts" : "Diagrams",
    ...laid,
  };
  if (!spec.title) return template;
  const xs = template.nodes.flatMap((node) => [node.x, node.x + (node.w ?? SIZE[node.kind].w)]);
  const top = Math.min(...template.nodes.map((node) => node.y));
  return {
    ...template,
    notes: [
      {
        text: spec.title,
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: top - TITLE_SIZE * 2.2,
        size: TITLE_SIZE,
      },
    ],
  };
}
