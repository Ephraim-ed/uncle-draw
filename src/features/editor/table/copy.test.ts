import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { toMarkdown, toSpreadsheet } from "./copy";
import { DEFAULT_HEADER_FILL, buildTable, commit, fill, readPlan, type TextEngine } from "./grid";

const LOOK = {
  headerFill: DEFAULT_HEADER_FILL,
  cellFill: "#ffffff",
  border: "#1e1e1e",
  borderWidth: 1,
  align: "center" as const,
  roughness: 1,
  dimDone: false,
};
const FONT = { fontSize: 20, fontFamily: 5, strokeColor: "#1e1e1e" };
const engine: TextEngine = {
  create: (o) =>
    ({
      ...convertToExcalidrawElements([{ type: "text", text: o.text, x: 0, y: 0 }])[0]!,
      containerId: o.containerId,
      groupIds: [...o.groupIds],
      index: null,
    }) as ExcalidrawTextElement,
  rewrap: (texts) => texts.map((t) => ({ ...t, height: 25 })),
};

function table(header: boolean, values: string[][], ticks: boolean[] = []) {
  let els: ExcalidrawElement[] = buildTable(
    { rows: values.length - (header ? 1 : 0), cols: values[0]!.length, header, checkboxes: ticks.length > 0 },
    { x: 0, y: 0 },
    LOOK,
    FONT,
    "t",
  );
  const p = readPlan(els, "t", FONT)!;
  fill(p, 0, 0, values, header ? [undefined, ...ticks] : ticks);
  els = commit(els, p, engine)!;
  return readPlan(els, "t", FONT)!;
}

describe("copying a table out", () => {
  it("makes tab-separated text with TRUE / FALSE for checkboxes", () => {
    const p = table(
      true,
      [
        ["Task", "Qty"],
        ["Milk", "2"],
        ["Eggs\nlarge", "12"],
      ],
      [true, false],
    );
    expect(toSpreadsheet(p)).toBe("\tTask\tQty\nTRUE\tMilk\t2\nFALSE\tEggs large\t12");
  });

  it("makes a Markdown table, escaping pipes", () => {
    const p = table(
      true,
      [
        ["Task", "Note"],
        ["A | B", "ok"],
      ],
      [true],
    );
    expect(toMarkdown(p)).toBe("|  | Task | Note |\n| --- | --- | --- |\n| [x] | A \\| B | ok |");
  });

  it("gives a header-less table an empty Markdown header, and copies just an area", () => {
    const p = table(false, [
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(toMarkdown(p)).toBe("|  |  |\n| --- | --- |\n| a | b |\n| c | d |");
    expect(toSpreadsheet(p, { rows: [1, 1], cols: [0, 1] })).toBe("c\td");
  });
});
