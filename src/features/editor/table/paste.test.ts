import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { parseCells, spansCells } from "./paste";
import { excalidrawText } from "./textEngine";

describe("parseCells", () => {
  it("splits lines into rows and tabs into columns, skipping blank lines", () => {
    expect(parseCells("Milk\t2\r\n\r\nEggs\t12\n")).toEqual({
      rows: [
        ["Milk", "2"],
        ["Eggs", "12"],
      ],
      ticks: [undefined, undefined],
    });
  });

  it("drops list bullets and reads checklist items", () => {
    expect(parseCells("- [x] Done\n* [ ] Todo\n[X] Also done\n• Plain\n- Dash")).toEqual({
      rows: [["Done"], ["Todo"], ["Also done"], ["Plain"], ["Dash"]],
      ticks: [true, false, true, undefined, undefined],
    });
  });

  it("returns null for blank text", () => {
    expect(parseCells(" \n\n ")).toBeNull();
  });

  it("tells one cell's worth from many", () => {
    expect(spansCells("just one\n")).toBe(false);
    expect(spansCells("a\nb")).toBe(true);
    expect(spansCells("a\tb")).toBe(true);
  });
});

describe("excalidrawText", () => {
  it("creates bound text and re-wraps from what was typed, not the old line breaks", () => {
    const [cell] = convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: 400, height: 48 }]);
    const text = excalidrawText.create({
      text: "Buy milk",
      fontSize: 20,
      fontFamily: 5,
      strokeColor: "#1e1e1e",
      containerId: cell!.id,
      groupIds: ["t1"],
      frameId: null,
      textAlign: "left",
    });
    expect([text.containerId, text.groupIds, text.textAlign, text.index]).toEqual([
      cell!.id,
      ["t1"],
      "left",
      null,
    ]);

    const squeezed: ExcalidrawTextElement = { ...text, text: "Buy\nmilk", originalText: "Buy milk" };
    const [wrapped] = excalidrawText.rewrap([squeezed], [cell!]);
    expect(wrapped!.text).toBe("Buy milk");
    expect(wrapped!.height).toBeGreaterThan(0);
  });
});
