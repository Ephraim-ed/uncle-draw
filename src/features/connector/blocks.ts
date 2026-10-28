import { ROW_HEIGHT } from "../editor/table/table";
import type { Template } from "../editor/templates/templates";
import { fitSize, textUnits } from "./layout";
import { ConnectorError, LIMITS } from "./types";

/**
 * Notes and tables Claude adds (AI-2), as templates so they're built and
 * placed like charts. Text is kept as given: only a typed bullet is swapped
 * for ours.
 */

const CELL_FONT_PX = 20;
const CELL_PAD = 12;
const MIN_COL = 80;
const MAX_COL = 320;

function tooLong(text: string) {
  if (text.length > LIMITS.text) {
    throw new ConnectorError(`Text can be at most ${LIMITS.text} characters ("${text.slice(0, 40)}…").`);
  }
}

/** One sticky note: an optional title line, then a bullet per item. */
export function notesTemplate(title: string | undefined, items: string[]): Template {
  if (items.length === 0) throw new ConnectorError("Notes need at least one item.");
  if (items.length > LIMITS.items) throw new ConnectorError(`Notes can have at most ${LIMITS.items} items.`);
  [title ?? "", ...items].forEach(tooLong);
  const bullets = items.map((item) => `• ${item.trim().replace(/^[-*•]\s+/, "")}`);
  const label = [...(title ? [title] : []), ...bullets].join("\n");
  const { w, h } = fitSize("note", label);
  return {
    id: "notes",
    name: title ?? "Notes",
    description: "",
    category: "Planning",
    nodes: [{ id: "note", kind: "note", x: 0, y: 0, label, w, h, align: "left" }],
    links: [],
  };
}

/** Lines `text` wraps to in a column `width` wide. */
function linesIn(text: string, width: number) {
  const perLine = Math.max(1, Math.floor((width - 2 * CELL_PAD) / (0.6 * CELL_FONT_PX)));
  return text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(textUnits(line) / perLine)), 0);
}

const rowHeight = (cells: readonly string[], widths: readonly number[]) =>
  Math.max(
    ROW_HEIGHT,
    ...cells.map((cell, c) => linesIn(cell, widths[c]!) * CELL_FONT_PX * 1.25 + 2 * CELL_PAD),
  );

/** An EDIT-7 table with a header row; short rows are padded, columns fit their text. */
export function tableTemplate(header: string[], rows: string[][]): Template {
  const cols = Math.max(header.length, ...rows.map((row) => row.length));
  if (cols === 0) throw new ConnectorError("A table needs at least one column.");
  if (cols > LIMITS.cols) throw new ConnectorError(`A table can have at most ${LIMITS.cols} columns.`);
  if (rows.length > LIMITS.rows) throw new ConnectorError(`A table can have at most ${LIMITS.rows} rows.`);
  const pad = (row: readonly string[]) => Array.from({ length: cols }, (_, c) => row[c] ?? "");
  const head = pad(header);
  const body = rows.map(pad);
  [...head, ...body.flat()].forEach(tooLong);

  const widths = head.map((_, c) => {
    const longest = Math.max(...[head, ...body].map((row) => textUnits(row[c]!)));
    return Math.min(MAX_COL, Math.max(MIN_COL, Math.ceil(longest * 0.6 * CELL_FONT_PX + 2 * CELL_PAD)));
  });
  return {
    id: "table",
    name: "Table",
    description: "",
    category: "Planning",
    nodes: [],
    links: [],
    table: {
      x: 0,
      y: 0,
      widths,
      rowHeight: Math.max(ROW_HEIGHT, ...body.map((row) => rowHeight(row, widths))),
      headerHeight: rowHeight(head, widths),
      header: head,
      rows: body,
      firstColumn: false,
    },
  };
}
