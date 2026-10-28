import { convertToExcalidrawElements, getCommonBounds, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, test } from "vitest";
import { tablePart } from "../editor/table/table";
import { buildTemplate, TEMPLATES } from "../editor/templates/templates";
import { addTemplate, DEFAULT_STYLE } from "./place";
import { applyTidy, type TidyPlan, type TidyTopic } from "./tidy";
import { ConnectorError } from "./types";
import { describeUnits } from "./units";

type El = ExcalidrawElement;
const template = (id: string) => TEMPLATES.find((t) => t.id === id)!;
const build = (id: string, x = 0, y = 0) => buildTemplate(template(id), { x, y }, DEFAULT_STYLE);
const text = (id: string, x: number, y: number, value: string) =>
  convertToExcalidrawElements([{ type: "text", id, x, y, text: value }], { regenerateIds: false })[0]!;
const rect = (id: string, x: number, y: number, more: Partial<El> = {}) =>
  ({
    ...convertToExcalidrawElements([{ type: "rectangle", id, x, y, width: 100, height: 60 }], {
      regenerateIds: false,
    })[0]!,
    ...more,
  }) as El;

const live = (els: readonly El[]) => els.filter((el) => !el.isDeleted);
const byId = (els: readonly El[], id: string) => els.find((el) => el.id === id)!;
const framesOf = (els: readonly El[]) => live(els).filter((el) => el.type === "frame");
const frameNamed = (els: readonly El[], name: string) =>
  framesOf(els).find((f) => f.type === "frame" && f.name === name)!;
const box = (els: readonly El[]) => {
  const [x1, y1, x2, y2] = getCommonBounds(live(els));
  return { x1, y1, x2, y2 };
};
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const frameBox = (f: El) => ({ x1: f.x, y1: f.y, x2: f.x + f.width, y2: f.y + f.height });

/** Two overlapping charts, two loose notes, a loose shape. */
const chartA = build("process", 0, 0);
const chartB = build("timeline", 60, 80);
const notes = [text("t1", 900, 40, "$12/mo?"), text("t2", 1200, 300, "annual 20% off")];
/** Like a saved board: valid indices and bindings. */
const board = (els: El[]) => restoreElements(els, null, { repairBindings: true });
const scene: El[] = board([...chartA, ...chartB, ...notes, rect("loose", 700, 700)]);
const unitOf = (els: readonly El[], id: string) =>
  describeUnits(els).find((u) => u.elementIds.includes(id))!.id;
const A = unitOf(scene, chartA[0]!.id);
const B = unitOf(scene, chartB[0]!.id);
const topic = (name: string, more: Partial<TidyTopic> = {}): TidyTopic => ({ name, units: [], ...more });
const plan = (...topics: TidyTopic[]): TidyPlan => ({ topics });

describe("applyTidy", () => {
  test("two overlapping charts end up in separate frames with no overlap", () => {
    const { elements } = applyTidy(
      scene,
      plan(topic("Sign-up", { units: [A] }), topic("Launch", { units: [B] })),
    );
    const signUp = frameNamed(elements, "Sign-up");
    const launch = frameNamed(elements, "Launch");
    const a = elements.filter((el) => chartA.some((c) => c.id === el.id));
    const b = elements.filter((el) => chartB.some((c) => c.id === el.id));
    expect(a.every((el) => el.frameId === signUp.id)).toBe(true);
    expect(b.every((el) => el.frameId === launch.id)).toBe(true);
    expect(overlaps(box(a), box(b))).toBe(false);
    expect(overlaps(frameBox(signUp), frameBox(launch))).toBe(false);
    // Each frame holds its chart with room to spare.
    expect(signUp.x).toBeLessThanOrEqual(box(a).x1 - 40);
    expect(signUp.y + signUp.height).toBeGreaterThanOrEqual(box(a).y2 + 40);
  });

  test("loose text in notes.replaces becomes one notes block; originals are tombstoned", () => {
    const { elements, changed } = applyTidy(
      scene,
      plan(
        topic("Pricing", {
          units: [A],
          notes: { replaces: ["text:t1", "text:t2"], title: "Pricing", items: ["$12/mo?", "annual 20% off"] },
        }),
      ),
    );
    for (const id of ["t1", "t2"]) {
      expect(byId(elements, id).isDeleted).toBe(true);
      expect(byId(elements, id).version).toBeGreaterThan(byId(scene, id).version);
      expect(changed.some((el) => el.id === id)).toBe(true);
    }
    const frame = frameNamed(elements, "Pricing");
    const label = live(elements).find(
      (el) => el.type === "text" && el.originalText === "Pricing\n• $12/mo?\n• annual 20% off",
    )!;
    expect(label).toBeDefined();
    expect(label.frameId).toBe(frame.id);
    // The notes sit to the right of the chart.
    const chart = elements.filter((el) => chartA.some((c) => c.id === el.id));
    expect(label.x).toBeGreaterThan(box(chart).x2);
  });

  test("text in table.replaces becomes a table with the given cells", () => {
    const { elements } = applyTidy(
      scene,
      plan(
        topic("Prices", {
          table: { replaces: ["text:t1", "text:t2"], header: ["Plan", "Price"], rows: [["Pro", "$12"]] },
        }),
      ),
    );
    const frame = frameNamed(elements, "Prices");
    const cells = live(elements).filter((el) => tablePart(el) === "cell");
    expect(cells).toHaveLength(4);
    expect(cells.every((el) => el.frameId === frame.id)).toBe(true);
    const texts = live(elements)
      .filter((el) => el.type === "text" && el.frameId === frame.id)
      .map((el) => (el.type === "text" ? el.originalText : ""));
    expect(texts.sort()).toEqual(["$12", "Plan", "Price", "Pro"]);
    expect(byId(elements, "t1").isDeleted).toBe(true);
  });

  test("unassigned units land in a Misc frame", () => {
    const { elements } = applyTidy(scene, plan(topic("Sign-up", { units: [A] })));
    const misc = frameNamed(elements, "Misc");
    for (const id of [chartB[0]!.id, "t1", "t2", "loose"]) expect(byId(elements, id).frameId).toBe(misc.id);
  });

  test("a chart's arrows and labels move with it (same delta, bindings intact)", () => {
    const { elements } = applyTidy(
      scene,
      plan(topic("Sign-up", { units: [A] }), topic("Launch", { units: [B] })),
    );
    const before = scene.filter((el) => chartA.some((c) => c.id === el.id));
    const deltas = before.map((el) =>
      [byId(elements, el.id).x - el.x, byId(elements, el.id).y - el.y].join(),
    );
    expect(new Set(deltas).size).toBe(1);
    for (const arrow of chartA.filter((el) => el.type === "arrow")) {
      const moved = byId(elements, arrow.id);
      expect(moved.type === "arrow" && moved.startBinding?.elementId).toBe(
        arrow.type === "arrow" && arrow.startBinding?.elementId,
      );
    }
    expect(before.every((el) => byId(elements, el.id).version > el.version)).toBe(true);
  });

  test("grouped elements and images move together as rigid blocks", () => {
    const image = {
      ...rect("img", 400, 900),
      type: "image",
      fileId: "f1",
      status: "saved",
      scale: [1, 1],
      crop: null,
    } as unknown as El;
    const grouped = [rect("g1", 0, 900, { groupIds: ["grp"] }), rect("g2", 150, 950, { groupIds: ["grp"] })];
    const els = board([...scene, ...grouped, image]);
    const { elements } = applyTidy(
      els,
      plan(topic("Bits", { units: [unitOf(els, "g1"), unitOf(els, "img")] })),
    );
    const d = (id: string) => [
      byId(elements, id).x - byId(els, id).x,
      byId(elements, id).y - byId(els, id).y,
    ];
    expect(d("g1")).toEqual(d("g2"));
    expect(byId(elements, "img").frameId).toBe(frameNamed(elements, "Bits").id);
  });

  test("locked units stay put and no frame overlaps them", () => {
    const locked = rect("pin", 300, 60, { locked: true });
    const els = board([...scene, locked]);
    const { elements } = applyTidy(
      els,
      plan(topic("Sign-up", { units: [A] }), topic("Launch", { units: [B] })),
    );
    const after = byId(elements, "pin");
    const before = byId(els, "pin");
    expect([after.x, after.y, after.version, after.frameId]).toEqual([
      before.x,
      before.y,
      before.version,
      null,
    ]);
    const pin = { x1: locked.x, y1: locked.y, x2: locked.x + locked.width, y2: locked.y + locked.height };
    for (const f of framesOf(elements)) expect(overlaps(frameBox(f), pin)).toBe(false);
  });

  test("an old frame emptied by the move is deleted", () => {
    const { elements: framed } = addTemplate(scene, template("kanban"), { area: "Old area" });
    const old = frameNamed(framed, "Old area");
    const kanban = describeUnits(framed).find((u) => u.frame === "Old area" && u.kind !== "frame")!.id;
    const { elements } = applyTidy(framed, plan(topic("Planning", { units: [kanban] })));
    expect(byId(elements, old.id).isDeleted).toBe(true);
    expect(framesOf(elements).map((f) => (f.type === "frame" ? f.name : ""))).not.toContain("Old area");
  });

  test("every frame is named after its topic", () => {
    const { elements } = applyTidy(
      scene,
      plan(
        topic("Sign-up", { units: [A] }),
        topic("Launch", { units: [B] }),
        topic("Notes", { units: ["text:t1"] }),
      ),
    );
    expect(
      framesOf(elements)
        .map((f) => (f.type === "frame" ? f.name : ""))
        .sort(),
    ).toEqual(["Launch", "Misc", "Notes", "Sign-up"]);
  });

  test("frames wrap into rows instead of one endless line", () => {
    const many = Array.from({ length: 6 }, (_, i) => build("timeline", i * 1500, 3000));
    const els = board(many.flat());
    const topics = many.map((chart, i) => topic(`T${i}`, { units: [unitOf(els, chart[0]!.id)] }));
    const { elements } = applyTidy(els, { topics });
    const frames = framesOf(elements);
    const left = Math.min(...frames.map((f) => f.x));
    const right = Math.max(...frames.map((f) => f.x + f.width));
    expect(right - left).toBeLessThanOrEqual(2400 + 1200);
    expect(new Set(frames.map((f) => f.y)).size).toBeGreaterThan(1);
  });

  const twoTopicsSameUnit = plan(topic("One", { units: [A] }), topic("Two", { units: [A] }));
  const replacesChart = plan(topic("One", { notes: { replaces: [A], items: ["x"] } }));
  const lockedScene = board([...scene, rect("pin", 300, 60, { locked: true })]);
  const assignsLocked = plan(topic("One", { units: ["shape:pin"] }));
  const dupNames = plan(topic("Same", { units: [A] }), topic("Same", { units: [B] }));
  test.each([
    ["unknown unit", plan(topic("One", { units: ["chart:nope"] })), scene],
    ["unit in two topics", twoTopicsSameUnit, scene],
    [
      "the same text in units and replaces",
      plan(topic("One", { units: ["text:t1"], notes: { replaces: ["text:t1"], items: ["x"] } })),
      scene,
    ],
    ["replaces a chart", replacesChart, scene],
    ["assigns a locked unit", assignsLocked, lockedScene],
    ["duplicate topic names", dupNames, scene],
    ["an empty topic name", plan(topic("  ", { units: [A] })), scene],
    ["an empty topic", plan(topic("Nothing")), scene],
    [
      "too many topics",
      { topics: Array.from({ length: 31 }, (_, i) => topic(`T${i}`, { units: i === 0 ? [A] : [] })) },
      scene,
    ],
  ] as [string, TidyPlan, El[]][])("rejects %s with ConnectorError and no change", (_, p, els) => {
    expect(() => applyTidy(els, p)).toThrow(ConnectorError);
  });
});
