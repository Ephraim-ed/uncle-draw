import { isDone, type Plan } from "./grid";

/**
 * A table (or part of it) as text for other apps (EDIT-7): tab-separated
 * for spreadsheets, or a Markdown table. Checkboxes become TRUE / FALSE
 * (which pastes back into a checklist) or [x] / [ ].
 */

export interface Area {
  rows: readonly [number, number];
  cols: readonly [number, number];
}

const whole = (p: Plan): Area => ({ rows: [0, p.rowH.length - 1], cols: [0, p.colW.length - 1] });

function grid(p: Plan, area: Area, box: (done: boolean) => string, clean: (s: string) => string): string[][] {
  const out: string[][] = [];
  for (let r = area.rows[0]; r <= area.rows[1]; r++) {
    const line: string[] = [];
    for (let c = area.cols[0]; c <= area.cols[1]; c++) {
      const slot = p.slots[r]?.[c];
      if (p.checkCol && c === 0 && !(p.header && r === 0)) line.push(box(isDone(p, r)));
      else line.push(clean(slot?.text?.originalText ?? ""));
    }
    out.push(line);
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n\t]+\s*/g, " ").trim();

export function toSpreadsheet(p: Plan, area: Area = whole(p)): string {
  return grid(p, area, (done) => (done ? "TRUE" : "FALSE"), oneLine)
    .map((line) => line.join("\t"))
    .join("\n");
}

export function toMarkdown(p: Plan, area: Area = whole(p)): string {
  const cells = grid(
    p,
    area,
    (done) => (done ? "[x]" : "[ ]"),
    (s) => oneLine(s).replace(/\|/g, "\\|"),
  );
  // Markdown tables need a header; a table without one gets an empty header row.
  const hasHeader = p.header && area.rows[0] === 0;
  const head = hasHeader ? cells[0]! : cells[0]!.map(() => "");
  const body = hasHeader ? cells.slice(1) : cells;
  const row = (line: readonly string[]) => `| ${line.join(" | ")} |`;
  return [row(head), row(head.map(() => "---")), ...body.map(row)].join("\n");
}
