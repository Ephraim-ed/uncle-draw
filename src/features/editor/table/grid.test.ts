import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { restoreScene } from "../serialize";
import {
  DEFAULT_HEADER_FILL,
  buildTable,
  commit,
  DIM_OPACITY,
  deleteCol,
  deleteCols,
  deleteRow,
  deleteRows,
  edgeAt,
  fill,
  insertCol,
  highlight,
  insertRow,
  moveRow,
  readPlan,
  resizeCol,
  resizeRow,
  setCheckCol,
  setHeader,
  setLook,
  slotAt,
  sortRows,
  tidy,
  type Plan,
  type TableLook,
  type TextEngine,
} from "./grid";
import {
  BOX_SIZE,
  CELL_WIDTH,
  CHECK_COLUMN_WIDTH,
  ROW_HEIGHT,
  isTicked,
  tablePart,
  toggleCheckbox,
} from "./table";

type El = ExcalidrawElement;

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
const AT = { x: 100, y: 200 };

/** 10 px per character, 25 px per line, wrapping at the container's width minus padding. */
const fakeText: TextEngine = {
  create(o) {
    const [el] = convertToExcalidrawElements([{ type: "text", text: o.text, x: 0, y: 0 }]);
    return {
      ...(el as ExcalidrawTextElement),
      containerId: o.containerId,
      groupIds: [...o.groupIds],
      frameId: o.frameId,
      textAlign: o.textAlign,
      verticalAlign: "middle",
      index: null,
    };
  },
  rewrap(texts, containers) {
    return texts.map((t) => {
      const max = containers.find((c) => c.id === t.containerId)!.width - 10;
      const width = t.originalText.length * 10;
      return { ...t, text: t.originalText, width: Math.min(width, max), height: Math.ceil(width / max) * 25 };
    });
  },
};

const todo = (o: Partial<{ rows: number; cols: number; header: boolean; checkboxes: boolean }> = {}) =>
  buildTable({ rows: 2, cols: 2, header: true, checkboxes: true, ...o }, AT, LOOK, FONT, "t1");

const plan = (els: readonly El[]) => readPlan(els, "t1", FONT)!;
const live = (els: readonly El[], part: string) =>
  els.filter((el) => !el.isDeleted && tablePart(el) === part);
const texts = (els: readonly El[]) =>
  els.filter((el): el is ExcalidrawTextElement => !el.isDeleted && el.type === "text");
const cellIn = (els: readonly El[], row: number, col: number) => plan(els).slots[row]![col]!.cell!;

/** Applies an edit to the table and commits it. */
function edit(els: readonly El[], change: (p: Plan) => unknown): El[] {
  const p = plan(els);
  change(p);
  return commit(els, p, fakeText) ?? [...els];
}

describe("buildTable / readPlan", () => {
  it("builds a tagged grid that reads back the same", () => {
    const els = todo();
    expect(live(els, "cell")).toHaveLength(9);
    expect(live(els, "checkbox")).toHaveLength(2);
    expect(els.every((el) => el.groupIds[0] === "t1" && el.index === null)).toBe(true);

    const p = plan(els);
    expect(p.colW).toEqual([CHECK_COLUMN_WIDTH, CELL_WIDTH, CELL_WIDTH]);
    expect(p.rowH).toEqual([ROW_HEIGHT, ROW_HEIGHT, ROW_HEIGHT]);
    expect([p.x, p.y, p.header, p.checkCol]).toEqual([100, 200, true, true]);
    expect(p.look).toEqual(LOOK);
    // Boxes sit centered in the body rows of the first column, above the cells.
    expect(p.slots.map((row) => row[0]!.box !== null)).toEqual([false, true, true]);
    const box = p.slots[1]![0]!.box!;
    expect([box.x + BOX_SIZE / 2, box.y + BOX_SIZE / 2]).toEqual([100 + 28, 200 + 48 + 24]);
    expect(els.indexOf(box)).toBeGreaterThan(els.indexOf(p.slots[2]![2]!.cell!));
  });

  it("uses the chosen look: header and cell fills, border, width", () => {
    const look = { ...LOOK, headerFill: "#a5d8ff", cellFill: "#ffec99", border: "#1971c2", borderWidth: 2 };
    const els = buildTable({ rows: 1, cols: 1, header: true, checkboxes: false }, AT, look, FONT, "t1");
    const [header, body] = live(els, "cell").sort((a, b) => a.y - b.y);
    expect([header!.backgroundColor, body!.backgroundColor]).toEqual(["#a5d8ff", "#ffec99"]);
    expect([body!.strokeColor, body!.strokeWidth]).toEqual(["#1971c2", 2]);
    expect(plan(els).look).toEqual(look);
  });

  it("reads back after restore(), like a reload or a collaborator's copy", () => {
    const restored = restoreScene(todo() as unknown[]).elements as El[];
    const p = plan(restored);
    expect([p.rowH.length, p.colW.length, p.header, p.checkCol]).toEqual([3, 3, true, true]);
  });

  it("leaves a cell dragged out of the grid alone", () => {
    const els = todo({ rows: 3 });
    const stray = cellIn(els, 2, 2);
    const moved = els.map((el) => (el.id === stray.id ? { ...el, x: 900, y: 900 } : el));
    const p = plan(moved);
    expect([p.rowH.length, p.colW.length]).toEqual([4, 3]);
    expect(p.slots.flat().some((s) => s.cell?.id === stray.id)).toBe(false);
  });

  it("finds slots and grid lines under a point", () => {
    const p = plan(todo());
    expect(slotAt(p, { x: 100 + 56 + 10, y: 200 + 48 + 10 })).toEqual({ row: 1, col: 1 });
    expect(slotAt(p, { x: 50, y: 250 })).toBeNull();
    expect(edgeAt(p, { x: 100 + 56 + 2, y: 260 }, 5, 10)).toEqual({ kind: "col", index: 0 });
    expect(edgeAt(p, { x: 200, y: 200 + 96 - 3 }, 5, 10)).toEqual({ kind: "row", index: 1 });
    expect(edgeAt(p, { x: 100 + 376, y: 200 + 144 - 4 }, 5, 10)).toBeNull(); // corner: Excalidraw's handle
    expect(edgeAt(p, { x: 200, y: 260 }, 5, 10)).toBeNull();
  });

  it("commits nothing when nothing changes", () => {
    const els = todo();
    expect(commit(els, plan(els), fakeText)).toBeNull();
  });
});

describe("rows and columns", () => {
  it("inserts a row below, pushes the rest down, and only touches what moved", () => {
    const els = todo();
    const header = cellIn(els, 0, 1);
    const next = edit(els, (p) => insertRow(p, 2));
    const p = plan(next);
    expect(p.rowH).toHaveLength(4);
    expect(live(next, "checkbox")).toHaveLength(3);
    expect(p.slots[3]![1]!.cell!.y).toBe(200 + 3 * 48);
    expect(next.find((el) => el.id === header.id)).toBe(header); // unchanged → same object, same version
  });

  it("never inserts above the header", () => {
    const p = plan(todo());
    insertRow(p, 0);
    expect(p.slots[0]![0]!.cell).not.toBeNull(); // the header stays on top
    expect(p.slots[1]![0]!.cell).toBeNull();
  });

  it("deletes a row with its text, box and tick, and closes the gap", () => {
    let els = todo({ rows: 3 });
    els = toggleCheckbox(els, plan(els).slots[1]![0]!.box!.id);
    els = edit(els, (p) => fill(p, 1, 1, [["Buy milk"]]));
    const doomed = plan(els).slots[1]!;
    const ids = [doomed[1]!.cell!.id, doomed[1]!.text!.id, doomed[0]!.box!.id, doomed[0]!.ticks[0]!.id];

    const next = edit(els, (p) => deleteRow(p, 1));
    for (const id of ids) expect(next.find((el) => el.id === id)!.isDeleted).toBe(true);
    const p = plan(next);
    expect(p.rowH).toHaveLength(3);
    expect(p.slots[1]![1]!.cell!.y).toBe(200 + 48);
  });

  it("keeps at least one body row and one text column", () => {
    const p = plan(todo({ rows: 1, cols: 1 }));
    expect(deleteRow(p, 1)).toBe(false);
    expect(deleteCol(p, 1)).toBe(false);
  });

  it("inserts a column next to the active one, never left of the checkboxes", () => {
    const els = todo();
    const next = edit(els, (p) => {
      insertCol(p, 0);
      insertCol(p, 3);
    });
    const p = plan(next);
    expect(p.colW).toEqual([CHECK_COLUMN_WIDTH, CELL_WIDTH, CELL_WIDTH, CELL_WIDTH, CELL_WIDTH]);
    expect(p.checkCol).toBe(true);
    expect(p.slots[1]![0]!.box).not.toBeNull();
  });

  it("deletes a column and closes the gap", () => {
    const els = edit(todo({ cols: 3 }), (p) => fill(p, 1, 1, [["a", "b", "c"]]));
    const next = edit(els, (p) => deleteCol(p, 2));
    expect(
      texts(next)
        .map((t) => t.originalText)
        .sort(),
    ).toEqual(["a", "c"]);
    const p = plan(next);
    expect(p.colW).toHaveLength(3);
    expect(p.slots[1]![2]!.text!.originalText).toBe("c");
    expect(p.slots[1]![2]!.cell!.x).toBe(100 + 56 + 160);
  });

  it("turns the header and checkbox column on and off without moving the body", () => {
    const els = edit(todo(), (p) => fill(p, 1, 1, [["Buy milk"]]));
    const milk = () =>
      plan(next)
        .slots.flat()
        .find((s) => s.text?.originalText === "Buy milk")!.cell!;
    const before = plan(els).slots[1]![1]!.cell!;

    let next = edit(els, (p) => {
      setHeader(p, false);
      setCheckCol(p, false);
    });
    let p = plan(next);
    expect([p.header, p.checkCol, p.rowH.length, p.colW.length]).toEqual([false, false, 2, 2]);
    expect(live(next, "checkbox")).toHaveLength(0);
    expect([milk().x, milk().y]).toEqual([before.x, before.y]);

    next = edit(next, (q) => {
      setHeader(q, true);
      setCheckCol(q, true);
    });
    p = plan(next);
    expect([p.header, p.checkCol, p.rowH.length, p.colW.length]).toEqual([true, true, 3, 3]);
    expect(live(next, "checkbox")).toHaveLength(2);
    expect(p.slots[0]![1]!.cell!.backgroundColor).toBe(DEFAULT_HEADER_FILL);
    expect([milk().x, milk().y]).toEqual([before.x, before.y]);
  });
});

describe("resizing", () => {
  it("re-wraps text when a column narrows, and the row grows to fit", () => {
    // 15 chars = 150 px: fits a 160 px column on one line.
    const els = edit(todo(), (p) => fill(p, 1, 1, [["Call the plumb."]]));
    expect(plan(els).rowH[1]).toBe(48);

    const narrow = edit(els, (p) => resizeCol(p, 1, 80)); // 70 px of text room → 3 lines
    const p = plan(narrow);
    expect(p.colW[1]).toBe(80);
    expect(p.slots[1]![1]!.text!.height).toBe(75);
    expect(p.rowH[1]).toBe(85);
    expect(p.slots[2]![1]!.cell!.y).toBe(200 + 48 + 85); // the next row moved down
    expect(p.slots[1]![0]!.box!.y).toBe(200 + 48 + (85 - BOX_SIZE) / 2); // box re-centered

    const wide = edit(narrow, (q) => resizeCol(q, 1, 200)); // back on one line
    expect(plan(wide).rowH[1]).toBe(48);
  });

  it("never squeezes a column below its minimum", () => {
    const p = plan(todo());
    resizeCol(p, 1, 3);
    expect(p.colW[1]).toBe(40);
  });

  it("lets a row grow freely but not shrink below its text", () => {
    const els = edit(todo(), (p) => fill(p, 1, 1, [["Call the plumber about it"]])); // 2 lines → 60 px
    const tall = edit(els, (p) => resizeRow(p, 1, 120));
    expect(plan(tall).rowH[1]).toBe(120);
    const short = edit(tall, (p) => resizeRow(p, 1, 10));
    expect(plan(short).rowH[1]).toBe(60);
  });
});

describe("styling", () => {
  it("applies fills, borders and alignment to the whole table", () => {
    const els = edit(todo(), (p) => fill(p, 1, 1, [["Milk"]]));
    const next = edit(els, (p) =>
      setLook(p, {
        headerFill: "#ffc9c9",
        cellFill: "#b2f2bb",
        border: "#e03131",
        borderWidth: 4,
        align: "left",
      }),
    );
    const p = plan(next);
    expect(p.look).toMatchObject({
      headerFill: "#ffc9c9",
      cellFill: "#b2f2bb",
      border: "#e03131",
      borderWidth: 4,
    });
    expect(live(next, "checkbox").every((b) => b.strokeColor === "#e03131" && b.strokeWidth === 4)).toBe(
      true,
    );
    const text = p.slots[1]![1]!.text!;
    expect(text.textAlign).toBe("left");
    expect(text.x).toBe(100 + 56 + 5);
  });

  it("re-colors ticks with their boxes", () => {
    let els = todo();
    els = toggleCheckbox(els, plan(els).slots[1]![0]!.box!.id);
    const next = edit(els, (p) => setLook(p, { border: "#2f9e44" }));
    expect(live(next, "tick")[0]!.strokeColor).toBe("#2f9e44");
  });
});

describe("filling cells", () => {
  it("puts one line per row and one tab-separated value per column, adding rows and columns", () => {
    const next = edit(todo({ rows: 1, cols: 1 }), (p) =>
      fill(p, 1, 0, [["Milk", "2"], ["Eggs", "12"], ["Bread"]], [true, false, undefined]),
    );
    const p = plan(next);
    expect([p.rowH.length, p.colW.length]).toEqual([4, 3]); // header + 3 rows, checkbox + 2 columns
    const values = p.slots.slice(1).map((row) => row.slice(1).map((s) => s.text?.originalText ?? ""));
    expect(values).toEqual([
      ["Milk", "2"],
      ["Eggs", "12"],
      ["Bread", ""],
    ]);
    const boxes = p.slots.slice(1).map((row) => isTicked(next, row[0]!.box!));
    expect(boxes).toEqual([true, false, false]);
  });

  it("replaces and clears existing text", () => {
    const els = edit(todo(), (p) => fill(p, 1, 1, [["Milk", "Eggs"]]));
    const milk = plan(els).slots[1]![1]!.text!;
    const next = edit(els, (p) => fill(p, 1, 1, [["Oat milk", ""]]));
    const p = plan(next);
    expect(p.slots[1]![1]!.text!.id).toBe(milk.id); // same element, new words
    expect(p.slots[1]![1]!.text!.originalText).toBe("Oat milk");
    expect(p.slots[1]![2]!.text).toBeNull();
  });
});

describe("tidy (after typing in a cell)", () => {
  it("grows the row to the edited cell, pushes rows down and aligns the new text", () => {
    let els = edit(todo(), (p) => setLook(p, { align: "left" }));
    els = edit(els, (p) => fill(p, 1, 2, [["Other"]]));
    const cell = cellIn(els, 1, 1);
    // Excalidraw made the cell 88 px tall for three lines of centered text.
    const [typed] = convertToExcalidrawElements([{ type: "text", text: "Long\ntask\nhere", x: 0, y: 0 }]);
    const text = {
      ...(typed as ExcalidrawTextElement),
      containerId: cell.id,
      groupIds: ["t1"],
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      width: 40,
      height: 75,
    };
    els = els.map((el) => (el.id === cell.id ? { ...el, height: 88 } : el));
    els = [...els, text];

    const next = tidy(els, "t1", text.id, FONT, fakeText)!;
    const p = plan(next);
    expect(p.slots[1]!.map((s) => s.cell!.height)).toEqual([88, 88, 88]);
    expect(p.slots[2]![1]!.cell!.y).toBe(200 + 48 + 88);
    const edited = p.slots[1]![1]!.text!;
    expect([edited.textAlign, edited.x]).toEqual(["left", 100 + 56 + 5]);
    expect(p.slots[1]![2]!.text!.textAlign).toBe("left"); // it was already left
  });
});

describe("bindings", () => {
  it("keeps arrows bound to a cell through edits", () => {
    const els = todo();
    const cell = cellIn(els, 1, 1);
    const bound = els.map((el) =>
      el.id === cell.id ? { ...el, boundElements: [{ type: "arrow" as const, id: "arrow-1" }] } : el,
    );
    const next = edit(bound, (p) => fill(p, 1, 1, [["Milk"]]));
    const after = next.find((el) => el.id === cell.id)!;
    expect(after.boundElements?.map((b) => b.type).sort()).toEqual(["arrow", "text"]);
  });
});

describe("several rows and columns at once", () => {
  it("deletes the rows and columns a selection spans, keeping one of each", () => {
    const els = edit(todo({ rows: 4, cols: 3 }), (p) => fill(p, 1, 1, [["a"], ["b"], ["c"], ["d"]]));
    const next = edit(els, (p) => deleteRows(p, [2, 3, 2]));
    expect(
      texts(next)
        .map((t) => t.originalText)
        .sort(),
    ).toEqual(["a", "d"]);
    const p = plan(next);
    expect(p.rowH).toHaveLength(3);
    // Can't delete every body row or text column.
    const q = plan(next);
    deleteRows(q, [1, 2]);
    expect(q.rowH).toHaveLength(2);
    deleteCols(q, [1, 2, 3]);
    expect(q.colW).toHaveLength(2);
  });
});

describe("sorting and moving rows", () => {
  const values = (els: readonly El[]) =>
    plan(els)
      .slots.slice(1)
      .map((row) => row[1]!.text?.originalText ?? "");

  it("sorts text naturally, numbers by value, empty cells last", () => {
    const els = edit(todo({ rows: 5 }), (p) =>
      fill(p, 1, 1, [["Item 10"], [""], ["item 2"], ["Apple"], ["Item 1"]]),
    );
    expect(values(edit(els, (p) => sortRows(p, 1, "asc")))).toEqual([
      "Apple",
      "Item 1",
      "item 2",
      "Item 10",
      "",
    ]);
    expect(values(edit(els, (p) => sortRows(p, 1, "desc")))).toEqual([
      "Item 10",
      "item 2",
      "Item 1",
      "Apple",
      "",
    ]);
    const nums = edit(todo({ rows: 3 }), (p) => fill(p, 1, 1, [["1,200"], ["30"], ["4"]]));
    expect(values(edit(nums, (p) => sortRows(p, 1, "asc")))).toEqual(["4", "30", "1,200"]);
  });

  it("sorts by the checkbox column: open items first", () => {
    let els = edit(todo({ rows: 3 }), (p) =>
      fill(p, 1, 1, [["done"], ["open"], ["also done"]], [true, false, true]),
    );
    els = edit(els, (p) => sortRows(p, 0, "asc"));
    expect(values(els)).toEqual(["open", "done", "also done"]);
    // The ticks moved with their rows.
    const p = plan(els);
    expect(p.slots.slice(1).map((row) => isTicked(els, row[0]!.box!))).toEqual([false, true, true]);
  });

  it("moves a row, never above the header", () => {
    const els = edit(todo({ rows: 3 }), (p) => fill(p, 1, 1, [["a"], ["b"], ["c"]]));
    expect(values(edit(els, (p) => moveRow(p, 3, 1)))).toEqual(["c", "a", "b"]);
    expect(values(edit(els, (p) => moveRow(p, 1, 4)))).toEqual(["b", "c", "a"]);
    expect(values(edit(els, (p) => moveRow(p, 2, 0)))).toEqual(["b", "a", "c"]);
    const p = plan(els);
    expect(moveRow(p, 0, 3)).toBe(false); // the header stays put
  });
});

describe("highlights and dimming", () => {
  it("gives cells their own fill, which survives table-wide recoloring and can be removed", () => {
    const els = edit(todo(), (p) => highlight(p, [{ row: 1, col: 1 }], "#ffc9c9"));
    expect(cellIn(els, 1, 1).backgroundColor).toBe("#ffc9c9");
    expect(plan(els).look.cellFill).toBe("#ffffff"); // the table's own color is unchanged
    const recolored = edit(els, (p) => setLook(p, { cellFill: "#ffec99" }));
    expect(cellIn(recolored, 1, 1).backgroundColor).toBe("#ffc9c9");
    expect(cellIn(recolored, 2, 1).backgroundColor).toBe("#ffec99");
    const cleared = edit(recolored, (p) => highlight(p, [{ row: 1, col: 1 }], null));
    expect(cellIn(cleared, 1, 1).backgroundColor).toBe("#ffec99");
  });

  it("fades ticked rows when the table dims them, and brings them back", () => {
    let els = edit(todo(), (p) => {
      setLook(p, { dimDone: true });
      fill(p, 1, 1, [["Milk"], ["Eggs"]], [true, false]);
    });
    const opacity = (text: string) => texts(els).find((t) => t.originalText === text)!.opacity;
    expect([opacity("Milk"), opacity("Eggs")]).toEqual([DIM_OPACITY, 100]);
    els = edit(els, (p) => setLook(p, { dimDone: false }));
    expect(opacity("Milk")).toBe(100);
    expect(plan(els).look.dimDone).toBe(false);
  });
});

describe("pasting spreadsheet text into a checklist", () => {
  it("reads a TRUE / FALSE first column as ticks", () => {
    const els = edit(todo(), (p) =>
      fill(p, 1, 1, [
        ["TRUE", "Milk"],
        ["false", "Eggs"],
      ]),
    );
    const p = plan(els);
    expect(p.slots.slice(1).map((row) => row[1]!.text?.originalText)).toEqual(["Milk", "Eggs"]);
    expect(p.slots.slice(1).map((row) => isTicked(els, row[0]!.box!))).toEqual([true, false]);
  });
});
