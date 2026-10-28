import { describe, expect, test } from "vitest";
import { SIZE, templateBounds, type Template } from "../editor/templates/templates";
import { chartTemplate } from "./layout";
import { ConnectorError, LIMITS, type ChartSpec, type NodeRole } from "./types";

type SpecNode = ChartSpec["nodes"][number];
type SpecLink = ChartSpec["links"][number];

const n = (id: string, role?: NodeRole, more: Partial<SpecNode> = {}): SpecNode => ({
  id,
  label: id.toUpperCase(),
  role,
  ...more,
});
const l = (from: string, to: string, more: Partial<SpecLink> = {}): SpecLink => ({ from, to, ...more });

/** The template node made for spec node `label` (labels are unique in these tests). */
function byLabel(t: Template, label: string) {
  const node = t.nodes.find((x) => x.label === label);
  if (!node) throw new Error(`no node labelled ${label}`);
  return node;
}
const box = (t: Template, label: string) => {
  const node = byLabel(t, label);
  const size = SIZE[node.kind];
  return { x: node.x, y: node.y, w: node.w ?? size.w, h: node.h ?? size.h };
};
const y = (t: Template, id: string) => box(t, id.toUpperCase()).y;
const x = (t: Template, id: string) => box(t, id.toUpperCase()).x;

/** Pairs of nodes whose boxes overlap; lane and column bodies hold other nodes by design. */
function overlaps(t: Template): string[] {
  const boxes = t.nodes
    .filter((node) => node.kind !== "lane" && node.kind !== "column")
    .map((node) => {
      const size = SIZE[node.kind];
      return { id: node.id, x: node.x, y: node.y, w: node.w ?? size.w, h: node.h ?? size.h };
    });
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        out.push(`${a.id}/${b.id}`);
    }
  }
  return out;
}

describe("chartTemplate", () => {
  test("flowchart goes top-down, no overlaps", () => {
    const t = chartTemplate({
      kind: "flowchart",
      nodes: [n("a"), n("b"), n("c", "decision")],
      links: [l("a", "b"), l("b", "c")],
    });
    expect(y(t, "a")).toBeLessThan(y(t, "b"));
    expect(y(t, "b")).toBeLessThan(y(t, "c"));
    expect(overlaps(t)).toEqual([]);
    expect(t.links.map((k) => [k.fromSide, k.toSide])).toEqual([
      ["bottom", "top"],
      ["bottom", "top"],
    ]);
  });

  test("direction right lays out left to right with right/left sides", () => {
    const t = chartTemplate({
      kind: "flowchart",
      direction: "right",
      nodes: [n("a"), n("b"), n("c")],
      links: [l("a", "b"), l("b", "c")],
    });
    expect(x(t, "a")).toBeLessThan(x(t, "b"));
    expect(x(t, "b")).toBeLessThan(x(t, "c"));
    expect(t.links.map((k) => [k.fromSide, k.toSide])).toEqual([
      ["right", "left"],
      ["right", "left"],
    ]);
  });

  test("a link back up the chart goes around the side instead of through other steps", () => {
    const t = chartTemplate({
      kind: "flowchart",
      nodes: [n("a"), n("b"), n("c", "decision")],
      links: [l("a", "b"), l("b", "c"), l("c", "b", { label: "No" })],
    });
    const back = t.links[2]!;
    expect([back.fromSide, back.toSide]).toEqual(["left", "left"]);
    const leftmost = Math.min(...t.nodes.map((node) => node.x));
    expect(back.via!.every(([vx]) => vx < leftmost)).toBe(true);
    expect(back.label).toBe("No");
  });

  test("roles map to kinds: terminal→terminal, decision→decision, note→note, default→step", () => {
    const t = chartTemplate({
      kind: "flowchart",
      nodes: [n("t", "terminal"), n("d", "decision"), n("o", "note"), n("s", "step"), n("u")],
      links: [l("t", "d"), l("d", "s"), l("s", "u")],
    });
    expect(["T", "D", "O", "S", "U"].map((label) => byLabel(t, label).kind)).toEqual([
      "terminal",
      "decision",
      "note",
      "step",
      "step",
    ]);
  });

  test("swimlanes: one row per lane in order, laneHead + lane nodes, steps inside their lane's row", () => {
    const t = chartTemplate({
      kind: "swimlanes",
      lanes: ["Customer", "Sales", "Warehouse"],
      nodes: [
        n("order", "step", { lane: "Customer" }),
        n("confirm", "step", { lane: "Sales" }),
        n("ship", "step", { lane: "Warehouse" }),
        n("receive", "step", { lane: "Customer" }),
      ],
      links: [l("order", "confirm"), l("confirm", "ship"), l("ship", "receive")],
    });
    const heads = t.nodes.filter((node) => node.kind === "laneHead");
    const lanes = t.nodes.filter((node) => node.kind === "lane");
    expect(heads.map((h) => h.label)).toEqual(["Customer", "Sales", "Warehouse"]);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((lane) => lane.y)).toEqual([...lanes.map((lane) => lane.y)].sort((a, b) => a - b));
    const rowOf = (label: string) => {
      const b = box(t, label);
      return lanes.findIndex((lane) => b.y >= lane.y && b.y + b.h <= lane.y + (lane.h ?? SIZE.lane.h));
    };
    expect(["ORDER", "CONFIRM", "SHIP", "RECEIVE"].map(rowOf)).toEqual([0, 1, 2, 0]);
    expect(x(t, "order")).toBeLessThan(x(t, "confirm"));
    expect(x(t, "ship")).toBeLessThan(x(t, "receive"));
    // Every step fits inside its lane's width.
    for (const label of ["ORDER", "CONFIRM", "SHIP", "RECEIVE"]) {
      const b = box(t, label);
      const lane = lanes[rowOf(label)]!;
      expect(b.x + b.w).toBeLessThanOrEqual(lane.x + (lane.w ?? SIZE.lane.w));
    }
    expect(overlaps(t)).toEqual([]);
  });

  test("swimlanes: a lane missing from lanes is an error", () => {
    expect(() =>
      chartTemplate({ kind: "swimlanes", lanes: ["A"], nodes: [n("x", "step", { lane: "B" })], links: [] }),
    ).toThrow(ConnectorError);
  });

  test("mindmap: root is idea, children branch, tree has no overlaps, links have head: false", () => {
    const t = chartTemplate({
      kind: "mindmap",
      nodes: ["root", "a", "b", "c", "d", "a1", "a2", "c1"].map((id) => n(id)),
      links: [
        l("root", "a"),
        l("root", "b"),
        l("root", "c"),
        l("root", "d"),
        l("a", "a1"),
        l("a", "a2"),
        l("c", "c1"),
      ],
    });
    expect(byLabel(t, "ROOT").kind).toBe("idea");
    expect(["A", "B", "C", "D", "A1", "A2", "C1"].every((label) => byLabel(t, label).kind === "branch")).toBe(
      true,
    );
    expect(overlaps(t)).toEqual([]);
    expect(t.links.every((k) => k.head === false)).toBe(true);
    // Branches spread to both sides of the big idea.
    const root = box(t, "ROOT");
    const sides = ["A", "B", "C", "D"].map((label) => Math.sign(box(t, label).x - root.x));
    expect(sides).toContain(1);
    expect(sides).toContain(-1);
  });

  test("mindmap: an item with two parents is an error", () => {
    expect(() =>
      chartTemplate({
        kind: "mindmap",
        nodes: [n("r"), n("a"), n("b")],
        links: [l("r", "a"), l("r", "b"), l("a", "b")],
      }),
    ).toThrow(ConnectorError);
  });

  test("orgchart: person nodes, elbow links, children below parent", () => {
    const t = chartTemplate({
      kind: "orgchart",
      nodes: ["lead", "design", "eng", "front", "back"].map((id) => n(id)),
      links: [l("lead", "design"), l("lead", "eng"), l("eng", "front"), l("eng", "back")],
    });
    expect(t.nodes.every((node) => node.kind === "person")).toBe(true);
    expect(
      t.links.every(
        (k) => k.elbow === true && k.head === false && k.fromSide === "bottom" && k.toSide === "top",
      ),
    ).toBe(true);
    expect(y(t, "design")).toBeGreaterThan(y(t, "lead"));
    expect(y(t, "front")).toBeGreaterThan(y(t, "eng"));
    // A parent sits centered over its children.
    const eng = box(t, "ENG");
    const front = box(t, "FRONT");
    const back = box(t, "BACK");
    expect(eng.x + eng.w / 2).toBeCloseTo((front.x + back.x + back.w) / 2, 0);
    expect(overlaps(t)).toEqual([]);
  });

  test("kanban: colHead/column per lane, notes stacked in their column, no links", () => {
    const t = chartTemplate({
      kind: "kanban",
      lanes: ["To do", "Doing", "Done"],
      nodes: [
        n("a", undefined, { lane: "To do" }),
        n("b", undefined, { lane: "To do" }),
        n("c", undefined, { lane: "Doing" }),
        n("d", undefined, { lane: "Done" }),
        n("e", undefined, { lane: "To do" }),
        n("f", undefined, { lane: "To do" }),
      ],
      links: [l("a", "b")],
    });
    expect(t.nodes.filter((node) => node.kind === "colHead").map((h) => h.label)).toEqual([
      "To do",
      "Doing",
      "Done",
    ]);
    expect(t.nodes.filter((node) => node.kind === "column")).toHaveLength(3);
    expect(t.links).toEqual([]);
    const cards = ["A", "B", "E", "F"].map((label) => box(t, label));
    expect(cards.map((c) => c.x)).toEqual([cards[0]!.x, cards[0]!.x, cards[0]!.x, cards[0]!.x]);
    expect(cards.map((c) => c.y)).toEqual([...cards.map((c) => c.y)].sort((p, q) => p - q));
    // The column grows to hold four cards.
    const column = t.nodes.find((node) => node.kind === "column")!;
    const last = cards[3]!;
    expect(column.y + (column.h ?? SIZE.column.h)).toBeGreaterThanOrEqual(last.y + last.h);
    expect(overlaps(t)).toEqual([]);
  });

  test("timeline: nodes left to right in given order, milestone dots on one axis path", () => {
    const t = chartTemplate({ kind: "timeline", nodes: ["k", "d", "b", "s"].map((id) => n(id)), links: [] });
    const xs = ["K", "D", "B", "S"].map((label) => box(t, label).x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    const dots = t.nodes.filter((node) => node.kind === "milestone");
    expect(dots).toHaveLength(4);
    expect(t.paths).toHaveLength(1);
    const axisY = t.paths![0]!.points[0]![1];
    for (const dot of dots) expect(dot.y + SIZE.milestone.h / 2).toBe(axisY);
  });

  test("long labels grow the node (w/h) so the label fits, at most 2x the default width", () => {
    const label = "A very long step label that keeps going ".repeat(3).trim();
    const t = chartTemplate({ kind: "flowchart", nodes: [{ id: "a", label }], links: [] });
    const node = t.nodes[0]!;
    expect(node.w).toBeGreaterThan(SIZE.step.w);
    expect(node.w).toBeLessThanOrEqual(2 * SIZE.step.w);
    expect(node.h).toBeGreaterThan(SIZE.step.h);
    // At 0.6em of 20px per character, the wrapped lines fit the box.
    const perLine = Math.floor((node.w! - 20) / 12);
    expect(Math.ceil(label.length / perLine) * 25).toBeLessThanOrEqual(node.h!);
  });

  test("a title sits above the chart as free text", () => {
    const t = chartTemplate({
      kind: "flowchart",
      title: "Sign-up",
      nodes: [n("a"), n("b")],
      links: [l("a", "b")],
    });
    expect(t.notes?.map((note) => note.text)).toEqual(["Sign-up"]);
    const top = Math.min(...t.nodes.map((node) => node.y));
    expect(t.notes![0]!.y).toBeLessThan(top);
    expect(templateBounds(t).height).toBeGreaterThan(0);
  });

  test("throws ConnectorError for unknown link target / duplicate id / too many nodes", () => {
    expect(() => chartTemplate({ kind: "flowchart", nodes: [n("a")], links: [l("a", "zz")] })).toThrow(
      ConnectorError,
    );
    expect(() => chartTemplate({ kind: "flowchart", nodes: [n("a"), n("a")], links: [] })).toThrow(
      ConnectorError,
    );
    const many = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => n(`n${i}`));
    expect(() => chartTemplate({ kind: "flowchart", nodes: many, links: [] })).toThrow(ConnectorError);
    expect(() => chartTemplate({ kind: "flowchart", nodes: [], links: [] })).toThrow(ConnectorError);
    expect(() =>
      chartTemplate({
        kind: "flowchart",
        nodes: [{ id: "a", label: "x".repeat(LIMITS.label + 1) }],
        links: [],
      }),
    ).toThrow(ConnectorError);
  });

  test("unicode and emoji labels are kept verbatim", () => {
    const labels = ["Café ☕", "日本語のステップ", "Ship it 🚀"];
    const t = chartTemplate({
      kind: "flowchart",
      nodes: labels.map((label, i) => ({ id: `n${i}`, label })),
      links: [l("n0", "n1"), l("n1", "n2")],
    });
    expect(t.nodes.map((node) => node.label)).toEqual(labels);
  });
});
