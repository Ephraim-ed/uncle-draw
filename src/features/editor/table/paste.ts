/**
 * Pasted text → table cells (EDIT-7): one row per line, one column per tab
 * (what spreadsheets copy). List bullets are dropped, and "[x]" / "[ ]"
 * checklist items tick the row's checkbox.
 */

export interface PastedCells {
  rows: string[][];
  /** Per row: ticked, unticked, or not a checklist item. */
  ticks: (boolean | undefined)[];
}

const CHECK_ITEM = /^\s*(?:[-*+•]\s+)?\[( |x|X)\]\s*/;
const BULLET = /^\s*[-*+•]\s+/;

export function parseCells(raw: string): PastedCells | null {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  const rows: string[][] = [];
  const ticks: (boolean | undefined)[] = [];
  for (const line of lines) {
    let text = line;
    let tick: boolean | undefined;
    const item = CHECK_ITEM.exec(text);
    if (item) {
      tick = item[1] !== " ";
      text = text.slice(item[0].length);
    } else {
      text = text.replace(BULLET, "");
    }
    rows.push(text.split("\t").map((v) => v.trim()));
    ticks.push(tick);
  }
  return { rows, ticks };
}

/** More than one cell's worth: several lines, or tab-separated values. */
export function spansCells(raw: string): boolean {
  return /[\n\t]/.test(raw.trim());
}
