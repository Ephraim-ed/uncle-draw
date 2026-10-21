import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { buildTable, DEFAULT_HEADER_FILL, type TableLook } from "./grid";
import { cellAt, checkboxAt, hasCheckbox, isTicked, tablePart, toggleCheckbox } from "./table";

const LOOK: TableLook = {
  headerFill: DEFAULT_HEADER_FILL,
  cellFill: "#ffffff",
  border: "#1e1e1e",
  borderWidth: 1,
  align: "center",
  roughness: 1,
  dimDone: false,
};
const FONT = { fontSize: 20, fontFamily: 5, strokeColor: "#1e1e1e" };

function todoTable(at = { x: 100, y: 200 }) {
  return buildTable({ rows: 2, cols: 2, header: true, checkboxes: true }, at, LOOK, FONT, "table-1");
}

const byPart = (els: readonly ExcalidrawElement[], part: string) =>
  els.filter((el) => !el.isDeleted && tablePart(el) === part);

const centerOf = (el: ExcalidrawElement) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

describe("checkboxAt", () => {
  const els = todoTable();
  const box = byPart(els, "checkbox")[0]!;

  it("finds the box under the point, with optional slop", () => {
    expect(checkboxAt(els, centerOf(box))?.id).toBe(box.id);
    const justOutside = { x: box.x - 3, y: box.y + 5 };
    expect(checkboxAt(els, justOutside)).toBeNull();
    expect(checkboxAt(els, justOutside, 4)?.id).toBe(box.id);
  });

  it("misses ordinary cells", () => {
    const cell = byPart(els, "cell").find((c) => c.x > 100 && c.y > 200)!;
    expect(checkboxAt(els, centerOf(cell))).toBeNull();
    expect(cellAt(els, centerOf(cell))?.id).toBe(cell.id);
  });

  it("is blocked by a filled shape drawn over the box, not by outlines or text", () => {
    const over = (...top: ExcalidrawElement[]) => [...els, ...top];
    const cover = (backgroundColor: string) =>
      convertToExcalidrawElements([
        { type: "rectangle", x: box.x - 10, y: box.y - 10, width: 60, height: 60, backgroundColor },
      ])[0]!;
    const note = convertToExcalidrawElements([{ type: "text", text: "note", x: box.x, y: box.y }])[0]!;
    expect(checkboxAt(over(cover("#ffec99")), centerOf(box))).toBeNull();
    expect(checkboxAt(over(cover("transparent")), centerOf(box))?.id).toBe(box.id);
    expect(checkboxAt(over(note), centerOf(box))?.id).toBe(box.id);
  });

  it("ignores deleted boxes", () => {
    const gone = els.map((el) => (el.id === box.id ? newElementWith(el, { isDeleted: true }) : el));
    expect(checkboxAt(gone, centerOf(box))).toBeNull();
  });

  it("honors rotation", () => {
    const turned = els.map((el) =>
      el.id === box.id ? { ...el, width: 40, height: 10, angle: (Math.PI / 2) as typeof el.angle } : el,
    );
    const c = centerOf(turned.find((el) => el.id === box.id)!);
    expect(checkboxAt(turned, { x: c.x, y: c.y + 15 })?.id).toBe(box.id); // along the rotated long side
    expect(checkboxAt(turned, { x: c.x + 15, y: c.y })).toBeNull();
  });

  it("knows which cells hold a box", () => {
    const cells = byPart(els, "cell");
    expect(cells.filter((c) => hasCheckbox(els, c))).toHaveLength(2);
  });
});

describe("toggleCheckbox", () => {
  it("adds a tick right above the box, in the table's group", () => {
    const els = todoTable();
    const box = byPart(els, "checkbox")[0]!;
    expect(isTicked(els, box)).toBe(false);

    const ticked = toggleCheckbox(els, box.id);
    const [tick] = byPart(ticked, "tick");
    expect(tick!.type).toBe("line");
    expect(tick!.groupIds).toEqual(box.groupIds);
    expect(tick!.strokeColor).toBe(box.strokeColor);
    expect(ticked.indexOf(tick!)).toBe(ticked.indexOf(box) + 1);
    expect(isTicked(ticked, box)).toBe(true);
    expect(isTicked(ticked, byPart(els, "checkbox")[1]!)).toBe(false);
  });

  it("unticks by deleting the tick, so the deletion syncs", () => {
    const els = todoTable();
    const box = byPart(els, "checkbox")[0]!;
    const ticked = toggleCheckbox(els, box.id);
    const tick = byPart(ticked, "tick")[0]!;

    const unticked = toggleCheckbox(ticked, box.id);
    expect(isTicked(unticked, box)).toBe(false);
    const tombstone = unticked.find((el) => el.id === tick.id)!;
    expect(tombstone.isDeleted).toBe(true);
    expect(tombstone.version).toBeGreaterThan(tick.version);
  });

  it("clears every tick in the box at once (two people ticked together)", () => {
    const els = todoTable();
    const box = byPart(els, "checkbox")[0]!;
    const once = toggleCheckbox(els, box.id);
    const theirs = toggleCheckbox(els, box.id).filter((el) => tablePart(el) === "tick");
    const both = [...once, ...theirs];
    expect(byPart(both, "tick")).toHaveLength(2);
    expect(byPart(toggleCheckbox(both, box.id), "tick")).toHaveLength(0);
  });

  it("returns the scene unchanged for an unknown box", () => {
    const els = todoTable();
    expect(toggleCheckbox(els, "nope")).toEqual(els);
  });
});
