import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { tablePart } from "../editor/table/table";

/**
 * A board as Claude reads it (AI-3): units that move as one when tidying —
 * charts (shapes joined by arrows), tables, groups, loose text, images and
 * single shapes — plus the frames they sit in.
 */

export type UnitKind = "chart" | "table" | "frame" | "text" | "shape" | "group" | "image";

export interface Unit {
  /** `${kind}:${smallest element id}`: the same while the unit doesn't change. */
  id: string;
  kind: UnitKind;
  elementIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
  text: string;
  locked: boolean;
  /** The name of the frame it sits in. */
  frame?: string;
}

type El = ExcalidrawElement;

/** A unit's text is cut here, so one huge note can't crowd out the rest. */
const UNIT_TEXT_MAX = 2000;
const DEFAULT_MAX_CHARS = 100_000;

const textOf = (el: El | undefined) => (el?.type === "text" ? el.originalText : "");
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

function unionFind(ids: readonly string[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  return { find, join };
}

/** The board's units, top to bottom then left to right. */
export function describeUnits(elements: readonly El[]): Unit[] {
  const present = elements.filter((el) => !el.isDeleted);
  const byId = new Map(present.map((el) => [el.id, el]));
  const frames = present.filter((el) => el.type === "frame" || el.type === "magicframe");
  const members = present.filter((el) => el.type !== "frame" && el.type !== "magicframe");
  const { find, join } = unionFind(members.map((el) => el.id));

  const labelOf = new Map<string, El>();
  const byOuterGroup = new Map<string, string>();
  for (const el of members) {
    // Labels go with their shape, arrows with what they're bound to.
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) {
      join(el.id, el.containerId);
      labelOf.set(el.containerId, el);
    }
    if (el.type === "arrow") {
      for (const binding of [el.startBinding, el.endBinding]) if (binding) join(el.id, binding.elementId);
    }
    // Groups (tables included) move together; the outermost group decides.
    const outer = el.groupIds.at(-1);
    if (outer) {
      const first = byOuterGroup.get(outer);
      if (first) join(el.id, first);
      else byOuterGroup.set(outer, el.id);
    }
  }

  const components = new Map<string, El[]>();
  for (const el of members) components.set(find(el.id), [...(components.get(find(el.id)) ?? []), el]);
  const frameName = new Map(
    frames.map((f) => [f.id, f.type === "frame" || f.type === "magicframe" ? (f.name ?? "") : ""]),
  );

  const units: Unit[] = [...components.values()].map((els) => describe(els, labelOf));
  for (const unit of units) {
    const frameId = byId.get(unit.elementIds[0]!)?.frameId;
    if (frameId && frameName.has(frameId)) unit.frame = frameName.get(frameId)!;
  }
  for (const f of frames) units.push(unit("frame", [f], frameName.get(f.id)!));
  return units.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || (a.id < b.id ? -1 : 1));
}

function unit(kind: UnitKind, els: readonly El[], text: string): Unit {
  const [x1, y1, x2, y2] = getCommonBounds(els);
  const ids = els.map((el) => el.id);
  return {
    id: `${kind}:${[...ids].sort()[0]}`,
    kind,
    elementIds: ids,
    bounds: { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) },
    text: text.length > UNIT_TEXT_MAX ? `${text.slice(0, UNIT_TEXT_MAX)}…` : text,
    locked: els.some((el) => el.locked),
  };
}

function describe(els: El[], labelOf: Map<string, El>): Unit {
  const main = els.filter(
    (el) => !(el.type === "text" && el.containerId && labelOf.get(el.containerId) === el),
  );
  const tableGroup = els.find((el) => tablePart(el))?.groupIds[0];
  if (tableGroup && els.every((el) => el.groupIds[0] === tableGroup))
    return unit("table", els, tableText(els));

  if (main.length === 1) {
    const el = main[0]!;
    if (el.type === "text") return unit("text", els, el.originalText);
    if (el.type === "image") return unit("image", els, "");
    return unit("shape", els, textOf(labelOf.get(el.id)));
  }

  const name = (id: string | undefined) => {
    const label = id ? oneLine(textOf(labelOf.get(id))) : "";
    return label || "(no label)";
  };
  const arrows = els.filter(
    (el): el is Extract<El, { type: "arrow" }> => el.type === "arrow" && !!(el.startBinding || el.endBinding),
  );
  if (arrows.length > 0) {
    const linked = new Set(arrows.flatMap((a) => [a.startBinding?.elementId, a.endBinding?.elementId]));
    const lines = arrows.map((a) => {
      const label = oneLine(textOf(labelOf.get(a.id)));
      return `${name(a.startBinding?.elementId)} → ${name(a.endBinding?.elementId)}${label ? ` (${label})` : ""}`;
    });
    const alone = main
      .filter((el) => el.type !== "arrow" && !linked.has(el.id))
      .map((el) => (el.type === "text" ? oneLine(el.originalText) : name(el.id)));
    return unit("chart", els, [...lines, ...alone].join("\n"));
  }
  const parts = main
    .map((el) => oneLine(el.type === "text" ? el.originalText : textOf(labelOf.get(el.id))))
    .filter(Boolean);
  return unit("group", els, parts.join("; "));
}

/** Rows of cell text, top to bottom, cells left to right. */
function tableText(els: readonly El[]): string {
  const cells = els.filter((el) => tablePart(el) === "cell");
  const labels = new Map(
    els.flatMap((el) =>
      el.type === "text" && el.containerId ? [[el.containerId, oneLine(el.originalText)]] : [],
    ),
  );
  const rows = new Map<number, El[]>();
  for (const cell of cells) {
    const key = [...rows.keys()].find((y) => Math.abs(y - cell.y) <= 2) ?? cell.y;
    rows.set(key, [...(rows.get(key) ?? []), cell]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((cell) => labels.get(cell.id) ?? "")
        .join(" | "),
    )
    .join("\n");
}

/** The units as text for Claude, cut at a unit boundary to stay under `maxChars`. */
export function outline(units: readonly Unit[], maxChars = DEFAULT_MAX_CHARS): string {
  if (units.length === 0) return "The board is empty.";
  const footerRoom = 80;
  const blocks: string[] = [];
  let length = 0;
  for (const u of units) {
    const { x, y, width, height } = u.bounds;
    const head = `[${u.id}] ${u.kind} @${x},${y} ${width}×${height}${u.locked ? " (locked)" : ""}${u.frame ? ` in "${u.frame}"` : ""}`;
    const body =
      u.kind === "frame" || !u.text
        ? ""
        : `\n${u.text
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")}`;
    const block = head + body;
    if (length + block.length + 1 > maxChars - footerRoom) {
      const rest = units.length - blocks.length;
      return `${blocks.join("\n")}\n… ${rest} more units not shown. Ask for a smaller area.`;
    }
    blocks.push(block);
    length += block.length + 1;
  }
  return blocks.join("\n");
}
