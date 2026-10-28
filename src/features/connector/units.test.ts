import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, test } from "vitest";
import { buildTemplate, TEMPLATES } from "../editor/templates/templates";
import { tableTemplate } from "./blocks";
import { addTemplate, DEFAULT_STYLE } from "./place";
import { describeUnits, fitsOutline, outline } from "./units";

const template = (id: string) => TEMPLATES.find((t) => t.id === id)!;
const build = (id: string, x = 0, y = 0) => buildTemplate(template(id), { x, y }, DEFAULT_STYLE);
const text = (id: string, x: number, y: number, value: string) =>
  convertToExcalidrawElements([{ type: "text", id, x, y, text: value }], { regenerateIds: false })[0]!;
const rect = (id: string, x: number, y: number, more: Partial<ExcalidrawElement> = {}) =>
  ({
    ...convertToExcalidrawElements([{ type: "rectangle", id, x, y, width: 100, height: 60 }], {
      regenerateIds: false,
    })[0]!,
    ...more,
  }) as ExcalidrawElement;

describe("describeUnits", () => {
  test("a template flowchart is one chart unit with its arrows and labels", () => {
    const els = build("process");
    const units = describeUnits(els);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe("chart");
    expect([...units[0]!.elementIds].sort()).toEqual(els.map((el) => el.id).sort());
  });

  test("chart text lists links as 'Start → Gather what you need'", () => {
    const [chart] = describeUnits(build("process"));
    expect(chart!.text.split("\n")).toEqual([
      "Start → Gather what you need",
      "Gather what you need → Do the work",
      "Do the work → Check the result",
      "Check the result → Done",
    ]);
  });

  test("link labels show in brackets", () => {
    const [chart] = describeUnits(build("decision"));
    expect(chart!.text).toContain("Is it OK? → Carry on (Yes)");
    expect(chart!.text).toContain("Is it OK? → Fix it (No)");
  });

  test("a template table is one table unit with header and rows", () => {
    const els = buildTemplate(
      tableTemplate(
        ["Plan", "Price"],
        [
          ["Free", "$0"],
          ["Pro", "$12"],
        ],
      ),
      { x: 0, y: 0 },
      DEFAULT_STYLE,
    );
    const units = describeUnits(els);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe("table");
    expect(units[0]!.text).toBe("Plan | Price\nFree | $0\nPro | $12");
    expect(units[0]!.elementIds).toHaveLength(els.length);
  });

  test("loose text items are separate text units", () => {
    const units = describeUnits([text("t1", 0, 0, "call Sam re: pricing"), text("t2", 300, 40, "$12/mo?")]);
    expect(units.map((u) => [u.kind, u.text])).toEqual([
      ["text", "call Sam re: pricing"],
      ["text", "$12/mo?"],
    ]);
    expect(units.map((u) => u.id)).toEqual(["text:t1", "text:t2"]);
  });

  test("a shape with a label is one shape unit, not a group", () => {
    const els = convertToExcalidrawElements(
      [{ type: "rectangle", id: "box", x: 0, y: 0, width: 120, height: 60, label: { text: "Ideas" } }],
      { regenerateIds: false },
    );
    const units = describeUnits(els);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      kind: "shape",
      text: "Ideas",
      id: `shape:${els.map((el) => el.id).sort()[0]}`,
    });
  });

  test("grouped elements are one group unit; locked flag carries through", () => {
    const units = describeUnits([
      rect("a", 0, 0, { groupIds: ["g1"] }),
      rect("b", 200, 0, { groupIds: ["g1"], locked: true }),
      rect("c", 600, 0),
    ]);
    expect(units.map((u) => [u.id, u.kind, u.locked])).toEqual([
      ["group:a", "group", true],
      ["shape:c", "shape", false],
    ]);
  });

  test("an image is an image unit", () => {
    const image = {
      ...rect("img", 0, 0),
      type: "image",
      fileId: "f1",
      status: "saved",
      scale: [1, 1],
      crop: null,
    } as unknown as ExcalidrawElement;
    expect(describeUnits([image]).map((u) => u.kind)).toEqual(["image"]);
  });

  test("elements inside a frame report the frame name; the frame is its own unit", () => {
    const { elements } = addTemplate([], template("process"), { area: "Sign-up" });
    const units = describeUnits(elements);
    expect(units.map((u) => u.kind).sort()).toEqual(["chart", "frame"]);
    const frame = units.find((u) => u.kind === "frame")!;
    expect(frame.text).toBe("Sign-up");
    expect(frame.elementIds).toHaveLength(1);
    expect(units.find((u) => u.kind === "chart")!.frame).toBe("Sign-up");
  });

  test("deleted elements are left out", () => {
    expect(describeUnits([rect("a", 0, 0, { isDeleted: true }), rect("b", 0, 0)]).map((u) => u.id)).toEqual([
      "shape:b",
    ]);
  });

  test("unit ids are stable across calls and unaffected by element order", () => {
    const els = [...build("process"), ...build("kanban", 800), text("t", 0, 900, "note")];
    const ids = describeUnits(els)
      .map((u) => u.id)
      .sort();
    expect(
      describeUnits([...els].reverse())
        .map((u) => u.id)
        .sort(),
    ).toEqual(ids);
    expect(
      describeUnits(els)
        .map((u) => u.id)
        .sort(),
    ).toEqual(ids);
  });
});

describe("outline", () => {
  test("one block per unit with id, kind, position, size and indented text", () => {
    const units = describeUnits([rect("a", 10, 20, { locked: true }), text("t", 0, 200, "hello\nworld")]);
    expect(outline(units)).toBe(
      [
        "[shape:a] shape @10,20 100×60 (locked)",
        "[text:t] text @0,200 " + `${units[1]!.bounds.width}×${units[1]!.bounds.height}`,
        "  hello",
        "  world",
      ].join("\n"),
    );
  });

  test("an empty board says so", () => {
    expect(outline([])).toBe("The board is empty.");
  });

  test("outline of 5000 text units stays under maxChars and says how many were cut", () => {
    const els = Array.from({ length: 5000 }, (_, i) =>
      text(`t${i}`, (i % 50) * 300, Math.floor(i / 50) * 80, `Loose note number ${i} with a few words`),
    );
    const units = describeUnits(els);
    const out = outline(units);
    expect(out.length).toBeLessThanOrEqual(100_000);
    const cut = /… (\d+) more units not shown\. Call read_board again with from: (\d+)\.$/.exec(out);
    expect(cut).not.toBeNull();
    const shown = out.split("\n").filter((line) => line.startsWith("[")).length;
    expect(shown + Number(cut![1])).toBe(5000);
  });
});

describe("reading a big board in parts", () => {
  const many = () =>
    describeUnits(
      Array.from({ length: 5000 }, (_, i) =>
        text(
          `t${String(i).padStart(4, "0")}`,
          (i % 50) * 300,
          Math.floor(i / 50) * 80,
          `Loose note number ${i} with a few words`,
        ),
      ),
    );

  test("from picks up where the last outline stopped", () => {
    const units = many();
    const first = outline(units);
    const next = Number(/with from: (\d+)\.$/.exec(first)![1]);
    const second = outline(units, undefined, next);
    expect(second.split("\n")[0]).toContain(`[${units[next]!.id}]`);
    expect(first).not.toContain(`[${units[next]!.id}]`);
  });

  test("fitsOutline says whether one outline shows everything", () => {
    expect(fitsOutline(many())).toBe(false);
    expect(fitsOutline(describeUnits([text("a", 0, 0, "hello")]))).toBe(true);
  });

  test("a text cut short in the outline is marked as cut", () => {
    const [long] = describeUnits([text("long", 0, 0, "word ".repeat(600))]);
    expect(long!.cut).toBe(true);
    expect(long!.text.endsWith("…")).toBe(true);
    expect(describeUnits([text("short", 0, 0, "hi")])[0]!.cut).toBeUndefined();
  });
});
