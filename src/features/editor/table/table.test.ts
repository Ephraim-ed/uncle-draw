import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { restoreScene } from "../serialize";
import {
  BOX_SIZE,
  CELL_WIDTH,
  CHECK_COLUMN_WIDTH,
  ROW_HEIGHT,
  buildTable,
  checkboxAt,
  fitRow,
  hasCheckbox,
  isTicked,
  tablePart,
  tableSize,
  toggleCheckbox,
} from "./table";

const STYLE = { strokeColor: "#1e1e1e", roughness: 1, fill: "#ffffff" };
const TODO = { rows: 2, cols: 2, header: true, checkboxes: true };

function todoTable(at = { x: 100, y: 200 }) {
  return buildTable(TODO, at, STYLE, "table-1");
}

const byPart = (els: readonly ExcalidrawElement[], part: string) =>
  els.filter((el) => !el.isDeleted && tablePart(el) === part);

const centerOf = (el: ExcalidrawElement) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/**
 * A text element shaped like Excalidraw's (convertToExcalidrawElements needs
 * real fonts for text, which jsdom lacks).
 */
function textAt(
  x: number,
  y: number,
  height: number,
  extra: Record<string, unknown> = {},
): ExcalidrawElement {
  const [base] = convertToExcalidrawElements([{ type: "rectangle", x, y, width: 70, height }]);
  return {
    ...base!,
    type: "text",
    text: "Buy milk",
    originalText: "Buy milk",
    fontSize: 20,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    ...extra,
  } as unknown as ExcalidrawElement;
}

/** Puts text in `cell` as bound text, the way Excalidraw does when you type in it. */
function withText(els: ExcalidrawElement[], cellId: string, height: number): ExcalidrawElement[] {
  const cell = els.find((el) => el.id === cellId)!;
  const text = textAt(cell.x + 10, cell.y + (cell.height - height) / 2, height, {
    containerId: cell.id,
    groupIds: [...cell.groupIds],
  });
  return [
    ...els.map((el) =>
      el.id === cellId ? { ...el, boundElements: [{ type: "text" as const, id: text.id }] } : el,
    ),
    text,
  ];
}

describe("buildTable", () => {
  it("lays out a header row, a checkbox column and body cells in one group", () => {
    const els = todoTable();
    const cells = byPart(els, "cell");
    const boxes = byPart(els, "checkbox");

    expect(cells).toHaveLength(3 * 3); // (header + 2 rows) × (checkbox column + 2)
    expect(boxes).toHaveLength(2); // body rows only
    expect(els.every((el) => el.groupIds[0] === "table-1")).toBe(true);
    expect(els.every((el) => el.index === null)).toBe(true);

    const size = tableSize(TODO);
    expect(size).toEqual({ width: CHECK_COLUMN_WIDTH + 2 * CELL_WIDTH, height: 3 * ROW_HEIGHT });
    const right = Math.max(...cells.map((c) => c.x + c.width));
    const bottom = Math.max(...cells.map((c) => c.y + c.height));
    expect([right - 100, bottom - 200]).toEqual([size.width, size.height]);

    // Header cells are shaded; body cells take the canvas color so clicks inside hit them.
    const header = cells.filter((c) => c.y === 200);
    expect(new Set(header.map((c) => c.backgroundColor))).toEqual(new Set(["#e9ecef"]));
    expect(cells.filter((c) => c.y > 200).every((c) => c.backgroundColor === "#ffffff")).toBe(true);

    // Each box is centered in the first cell of its row and drawn above the cells.
    const firstBody = cells.find((c) => c.x === 100 && c.y === 200 + ROW_HEIGHT)!;
    expect(centerOf(boxes[0]!)).toEqual(centerOf(firstBody));
    expect(boxes[0]!.width).toBe(BOX_SIZE);
    expect(els.indexOf(boxes[0]!)).toBeGreaterThan(els.indexOf(cells[cells.length - 1]!));
    expect(hasCheckbox(els, firstBody)).toBe(true);
    expect(hasCheckbox(els, header[0]!)).toBe(false);
  });

  it("can skip the header and the checkboxes", () => {
    const els = buildTable({ rows: 3, cols: 4, header: false, checkboxes: false }, { x: 0, y: 0 }, STYLE);
    expect(byPart(els, "cell")).toHaveLength(12);
    expect(byPart(els, "checkbox")).toHaveLength(0);
    expect(new Set(els.map((el) => el.groupIds[0])).size).toBe(1);
  });

  it("keeps its tags through restore(), like a reload or a collaborator's copy", () => {
    const restored = restoreScene(todoTable() as unknown[]).elements as ExcalidrawElement[];
    expect(byPart(restored, "cell")).toHaveLength(9);
    expect(byPart(restored, "checkbox")).toHaveLength(2);
  });
});

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
  });

  it("is blocked by a filled shape drawn over the box, not by outlines or text", () => {
    const over = (...top: ExcalidrawElement[]) => [...els, ...top];
    const cover = (backgroundColor: string) =>
      convertToExcalidrawElements([
        { type: "rectangle", x: box.x - 10, y: box.y - 10, width: 60, height: 60, backgroundColor },
      ])[0]!;
    expect(checkboxAt(over(cover("#ffec99")), centerOf(box))).toBeNull();
    expect(checkboxAt(over(cover("transparent")), centerOf(box))?.id).toBe(box.id);
    expect(checkboxAt(over(textAt(box.x, box.y, 25)), centerOf(box))?.id).toBe(box.id);
  });

  it("ignores deleted boxes", () => {
    const gone = els.map((el) => (el.id === box.id ? newElementWith(el, { isDeleted: true }) : el));
    expect(checkboxAt(gone, centerOf(box))).toBeNull();
  });

  it("honors rotation", () => {
    const turned = els.map((el) =>
      el.id === box.id ? { ...el, width: 40, height: 10, angle: (Math.PI / 2) as typeof el.angle } : el,
    );
    const b = turned.find((el) => el.id === box.id)!;
    const c = centerOf(b);
    expect(checkboxAt(turned, { x: c.x, y: c.y + 15 })?.id).toBe(box.id); // along the rotated long side
    expect(checkboxAt(turned, { x: c.x + 15, y: c.y })).toBeNull();
  });
});

describe("toggleCheckbox", () => {
  it("adds a tick right above the box, in the table's group", () => {
    const els = todoTable();
    const box = byPart(els, "checkbox")[0]!;
    expect(isTicked(els, box)).toBe(false);

    const ticked = toggleCheckbox(els, box.id);
    const [tick] = byPart(ticked, "tick");
    expect(tick).toBeDefined();
    expect(tick!.type).toBe("line");
    expect(tick!.groupIds).toEqual(box.groupIds);
    expect(tick!.strokeColor).toBe(box.strokeColor);
    expect(ticked.indexOf(tick!)).toBe(ticked.indexOf(box) + 1);
    expect(isTicked(ticked, box)).toBe(true);
    // The other box is untouched.
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

describe("fitRow", () => {
  /** Row 1 (the first body row), column 2: a text cell. */
  function setup() {
    const els = todoTable();
    const cells = byPart(els, "cell");
    const cell = cells.find((c) => c.y === 200 + ROW_HEIGHT && c.x === 100 + CHECK_COLUMN_WIDTH)!;
    return { els: withText(els, cell.id, 25), cell };
  }

  it("does nothing while the row still fits", () => {
    const { els, cell } = setup();
    expect(fitRow(els, cell.id)).toBeNull();
  });

  it("grows the rest of the row and pushes the rows below down", () => {
    const { els: before, cell } = setup();
    // Excalidraw grew the cell to fit three wrapped lines of text.
    const grown = before.map((el) => (el.id === cell.id ? { ...el, height: 88 } : el));
    const next = fitRow(grown, cell.id)!;
    expect(next).not.toBeNull();

    const rowTop = 200 + ROW_HEIGHT;
    const cells = byPart(next, "cell");
    const row = cells.filter((c) => c.y === rowTop);
    expect(row.map((c) => c.height)).toEqual([88, 88, 88]);

    // The header is untouched; the last row starts where this one now ends.
    expect(cells.filter((c) => c.y === 200).every((c) => c.height === ROW_HEIGHT)).toBe(true);
    const last = cells.filter((c) => c.y > rowTop);
    expect(last).toHaveLength(3);
    expect(last.every((c) => c.y === rowTop + 88)).toBe(true);

    // This row's checkbox is re-centered in its taller cell; the next row's moved with it.
    const [box1, box2] = byPart(next, "checkbox");
    expect(centerOf(box1!).y).toBe(rowTop + 44);
    expect(centerOf(box2!).y).toBe(rowTop + 88 + ROW_HEIGHT / 2);
  });

  it("moves ticks with their boxes and keeps other text centered", () => {
    const { els: before, cell } = setup();
    const boxes = byPart(before, "checkbox");
    let els = toggleCheckbox(before, boxes[0]!.id);
    els = toggleCheckbox(els, boxes[1]!.id);
    const neighbor = byPart(els, "cell").find((c) => c.y === cell.y && c.x > cell.x)!;
    els = withText(els, neighbor.id, 25);
    const neighborText = els[els.length - 1]!;

    const grown = els.map((el) => (el.id === cell.id ? { ...el, height: 88 } : el));
    const next = fitRow(grown, cell.id)!;
    for (const box of byPart(next, "checkbox")) expect(isTicked(next, box)).toBe(true);
    const moved = next.find((el) => el.id === neighborText.id)!;
    expect(moved.y - neighborText.y).toBe(20); // half of the 40 px the row grew
  });

  it("leaves other tables alone", () => {
    const { els: before, cell } = setup();
    const other = buildTable(TODO, { x: 100, y: 300 }, STYLE, "table-2");
    const grown = [...before, ...other].map((el) => (el.id === cell.id ? { ...el, height: 88 } : el));
    const next = fitRow(grown, cell.id)!;
    for (const el of other) expect(next.find((n) => n.id === el.id)).toBe(el);
  });

  it("skips rotated tables and non-cells", () => {
    const { els, cell } = setup();
    const rotated = els.map((el) =>
      el.id === cell.id ? { ...el, height: 88, angle: 0.3 as typeof el.angle } : el,
    );
    expect(fitRow(rotated, cell.id)).toBeNull();
    expect(fitRow(els, byPart(els, "checkbox")[0]!.id)).toBeNull();
  });
});
