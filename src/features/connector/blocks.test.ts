import { describe, expect, test } from "vitest";
import { buildTemplate, SIZE, type Template } from "../editor/templates/templates";
import { tablePart } from "../editor/table/table";
import { notesTemplate, tableTemplate } from "./blocks";
import { DEFAULT_STYLE } from "./place";
import { ConnectorError, LIMITS } from "./types";

const label = (t: Template) => t.nodes[0]?.label;

describe("notesTemplate", () => {
  test("puts title and bullets in one note", () => {
    expect(label(notesTemplate("Pricing", ["$12/mo?", "annual 20% off"]))).toBe(
      "Pricing\n• $12/mo?\n• annual 20% off",
    );
  });

  test("without a title it's just the bullets, left-aligned in a note", () => {
    const t = notesTemplate(undefined, ["fix login bug", "write FAQ"]);
    expect(t.nodes).toHaveLength(1);
    expect(t.nodes[0]).toMatchObject({ kind: "note", label: "• fix login bug\n• write FAQ", align: "left" });
  });

  test("doesn't double up bullets the user already typed", () => {
    expect(label(notesTemplate(undefined, ["- call Sam", "• ask design", "* icons"]))).toBe(
      "• call Sam\n• ask design\n• icons",
    );
  });

  test("a long list makes a taller note", () => {
    const t = notesTemplate(
      "To-do",
      Array.from({ length: 12 }, (_, i) => `Task number ${i + 1}`),
    );
    expect(t.nodes[0]!.h).toBeGreaterThan(SIZE.note.h);
  });

  test("throws ConnectorError with no items or too many", () => {
    expect(() => notesTemplate("x", [])).toThrow(ConnectorError);
    expect(() =>
      notesTemplate(
        "x",
        Array.from({ length: LIMITS.items + 1 }, () => "a"),
      ),
    ).toThrow(ConnectorError);
  });
});

describe("tableTemplate", () => {
  test("keeps cells verbatim and pads short rows", () => {
    const t = tableTemplate(
      ["Plan", "Price", "Users"],
      [
        ["Free", "$0", "1"],
        ["Pro", "$12"],
      ],
    );
    expect(t.nodes).toEqual([]);
    expect(t.table!.header).toEqual(["Plan", "Price", "Users"]);
    expect(t.table!.rows).toEqual([
      ["Free", "$0", "1"],
      ["Pro", "$12", ""],
    ]);
    const texts = buildTemplate(t, { x: 0, y: 0 }, DEFAULT_STYLE)
      .filter((el) => el.type === "text")
      .map((el) => (el as { originalText: string }).originalText);
    expect(texts).toEqual(
      expect.arrayContaining(["Plan", "Price", "Users", "Free", "$0", "1", "Pro", "$12"]),
    );
  });

  test("builds a real EDIT-7 table without shading the first column", () => {
    const els = buildTemplate(tableTemplate(["A", "B"], [["1", "2"]]), { x: 0, y: 0 }, DEFAULT_STYLE);
    const cells = els.filter((el) => tablePart(el) === "cell");
    expect(cells).toHaveLength(4);
    const body = cells.filter((el) => !el.customData?.udHeader);
    expect(new Set(body.map((el) => el.backgroundColor))).toEqual(new Set([DEFAULT_STYLE.paper]));
  });

  test("column widths fit their longest cell, within 80–320 px", () => {
    const t = tableTemplate(["Id", "A much longer column heading", "x".repeat(80)], [["1", "short", "y"]]);
    const [narrow, wide, widest] = t.table!.widths;
    expect(narrow).toBe(80);
    expect(wide).toBeGreaterThan(narrow!);
    expect(widest).toBe(320);
  });

  test("throws ConnectorError past LIMITS.rows/cols or with no columns", () => {
    expect(() =>
      tableTemplate(
        ["a"],
        Array.from({ length: LIMITS.rows + 1 }, () => ["x"]),
      ),
    ).toThrow(ConnectorError);
    expect(() =>
      tableTemplate(
        Array.from({ length: LIMITS.cols + 1 }, () => "h"),
        [],
      ),
    ).toThrow(ConnectorError);
    expect(() => tableTemplate([], [])).toThrow(ConnectorError);
  });
});
