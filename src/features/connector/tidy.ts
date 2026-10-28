import { getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { buildTemplate, templateBounds, type Template } from "../editor/templates/templates";
import { notesTemplate, tableTemplate } from "./blocks";
import { markForMeasure } from "./marks";
import { DEFAULT_STYLE, finish, FRAME_PAD, newFrame, STACK_GAP, type Change } from "./place";
import { ConnectorError } from "./types";
import { describeUnits, type Unit } from "./units";

/**
 * Tidying a board (AI-4): one frame per topic holding its charts, notes and
 * tables, frames in rows, nothing overlapping. Claude shows the topics to the
 * user and gets an OK before calling this; a plan that doesn't fit the board
 * is refused whole, so nothing moves on a bad guess.
 */

export interface TidyTopic {
  name: string;
  /** Unit ids (from read_board) to move into this topic. */
  units: string[];
  /** Loose text turned into one note of bullets. */
  notes?: { replaces: string[]; title?: string; items: string[] };
  /** Loose text turned into a table. */
  table?: { replaces: string[]; header: string[]; rows: string[][] };
}

export interface TidyPlan {
  topics: TidyTopic[];
}

type El = ExcalidrawElement;

const MAX_TOPICS = 30;
const MISC = "Misc";
/** Frames wrap to a new row past this width. */
const ROW_WIDTH = 2400;
const FRAME_GAP = 120;
/** "Other" units flow in rows at least this wide. */
const MIN_FLOW_WIDTH = 600;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Something placed inside a topic's frame, relative to its inner top-left corner. */
type Placed = { x: number; y: number } & ({ unit: Unit } | { template: Template });

function check(plan: TidyPlan, units: Map<string, Unit>) {
  if (plan.topics.length > MAX_TOPICS)
    throw new ConnectorError(`A tidy plan can have at most ${MAX_TOPICS} topics.`);
  const names = new Set<string>();
  const seen = new Set<string>();
  const claim = (id: string, replacing: boolean) => {
    const unit = units.get(id);
    if (!unit)
      throw new ConnectorError(
        `There's no unit "${id}" on the board. Read the board again; it may have changed.`,
      );
    if (seen.has(id)) throw new ConnectorError(`"${id}" is in more than one place in the plan.`);
    seen.add(id);
    if (unit.locked)
      throw new ConnectorError(
        `"${id}" is locked, so tidying leaves it where it is. Leave it out of the plan.`,
      );
    if (unit.kind === "frame") {
      throw new ConnectorError(
        `"${id}" is a frame. Tidying makes new frames, so assign what's inside it instead.`,
      );
    }
    if (replacing && unit.kind !== "text") {
      throw new ConnectorError(`Only loose text can become notes or a table; "${id}" is a ${unit.kind}.`);
    }
    if (replacing && unit.cut) {
      throw new ConnectorError(
        `"${id}" is longer than read_board shows, so rewriting it would lose text. Move it as a unit instead.`,
      );
    }
  };
  for (const topic of plan.topics) {
    const name = topic.name.trim();
    if (!name) throw new ConnectorError("Every topic needs a name.");
    if (names.has(name)) throw new ConnectorError(`Two topics are both called "${name}".`);
    names.add(name);
    if (topic.units.length === 0 && !topic.notes && !topic.table) {
      throw new ConnectorError(`Topic "${name}" is empty: give it units, notes or a table.`);
    }
    topic.units.forEach((id) => claim(id, false));
    topic.notes?.replaces.forEach((id) => claim(id, true));
    topic.table?.replaces.forEach((id) => claim(id, true));
  }
}

const sizeOf = (p: Placed) => {
  if ("unit" in p) return { w: p.unit.bounds.width, h: p.unit.bounds.height };
  const b = templateBounds(p.template);
  return { w: b.width, h: b.height };
};

/** Mockup C: charts down the left, notes beside the first, tables below, the rest after. */
function arrange(
  units: Unit[],
  notes: Template | null,
  table: Template | null,
): { placed: Placed[]; w: number; h: number } {
  const placed: Placed[] = [];
  const put = (item: Placed) => {
    placed.push(item);
    return sizeOf(item);
  };
  let y = 0;
  let chartsW = 0;
  for (const unit of units.filter((u) => u.kind === "chart")) {
    const { w, h } = put({ unit, x: 0, y });
    chartsW = Math.max(chartsW, w);
    y += h + STACK_GAP;
  }
  let bottom = y;
  if (notes) {
    const { h } = put({ template: notes, x: chartsW > 0 ? chartsW + STACK_GAP : 0, y: 0 });
    bottom = Math.max(bottom, h + STACK_GAP);
  }
  y = bottom;
  const tables: Placed[] = [
    ...units.filter((u) => u.kind === "table").map((unit) => ({ unit, x: 0, y: 0 })),
    ...(table ? [{ template: table, x: 0, y: 0 }] : []),
  ];
  for (const item of tables) y += put({ ...item, y }).h + STACK_GAP;

  const widthSoFar = () => Math.max(MIN_FLOW_WIDTH, ...placed.map((p) => p.x + sizeOf(p).w));
  const flowW = widthSoFar();
  let x = 0;
  let rowH = 0;
  for (const unit of units.filter((u) => u.kind !== "chart" && u.kind !== "table")) {
    const { w, h } = { w: unit.bounds.width, h: unit.bounds.height };
    if (x > 0 && x + w > flowW) {
      y += rowH + STACK_GAP;
      x = 0;
      rowH = 0;
    }
    put({ unit, x, y });
    x += w + STACK_GAP;
    rowH = Math.max(rowH, h);
  }
  return {
    placed,
    w: Math.max(...placed.map((p) => p.x + sizeOf(p).w)),
    h: Math.max(...placed.map((p) => p.y + sizeOf(p).h)),
  };
}

/** Frames in rows from `origin`, each row moved down past anything locked it would cover. */
function rows(sizes: { w: number; h: number }[], origin: { x: number; y: number }, obstacles: Box[]): Box[] {
  const lines: number[][] = [];
  let x = 0;
  sizes.forEach((s, i) => {
    if (lines.length === 0 || (x > 0 && x + s.w > ROW_WIDTH)) {
      lines.push([]);
      x = 0;
    }
    lines.at(-1)!.push(i);
    x += s.w + FRAME_GAP;
  });
  const out: Box[] = [];
  let y = origin.y;
  for (const line of lines) {
    const at = (top: number) => {
      let left = origin.x;
      return line.map((i) => {
        const b = { x: left, y: top, w: sizes[i]!.w, h: sizes[i]!.h };
        left += b.w + FRAME_GAP;
        return b;
      });
    };
    let boxes = at(y);
    for (let hit = boxes.flatMap((b) => obstacles.filter((o) => overlaps(b, o))); hit.length > 0;) {
      y = Math.max(...hit.map((o) => o.y + o.h)) + FRAME_GAP;
      boxes = at(y);
      hit = boxes.flatMap((b) => obstacles.filter((o) => overlaps(b, o)));
    }
    line.forEach((i, k) => (out[i] = boxes[k]!));
    y += Math.max(...boxes.map((b) => b.h)) + FRAME_GAP;
  }
  return out;
}

/**
 * The tidied board. Throws ConnectorError, changing nothing, if the plan
 * doesn't fit the board. With `leaveUnassigned` (a board too big for Claude
 * to read in one go), units the plan leaves out stay where they are instead
 * of going in "Misc", and new frames keep clear of them.
 */
export function applyTidy(
  elements: readonly El[],
  plan: TidyPlan,
  opts: { leaveUnassigned?: boolean } = {},
): Change {
  const units = describeUnits(elements);
  const byUnit = new Map(units.map((u) => [u.id, u]));
  check(plan, byUnit);

  const topics = plan.topics.map((t) => ({ ...t, name: t.name.trim(), units: [...t.units] }));
  const claimed = new Set(
    topics.flatMap((t) => [...t.units, ...(t.notes?.replaces ?? []), ...(t.table?.replaces ?? [])]),
  );
  const leftovers = units
    .filter((u) => u.kind !== "frame" && !u.locked && !claimed.has(u.id))
    .map((u) => u.id);
  if (leftovers.length > 0 && !opts.leaveUnassigned) {
    const misc = topics.find((t) => t.name === MISC);
    if (misc) misc.units.push(...leftovers);
    else topics.push({ name: MISC, units: leftovers });
  }

  const layouts = topics.map((t) =>
    arrange(
      t.units.map((id) => byUnit.get(id)!),
      t.notes ? notesTemplate(t.notes.title, t.notes.items) : null,
      t.table ? tableTemplate(t.table.header, t.table.rows) : null,
    ),
  );

  const byId = new Map(elements.map((el) => [el.id, el]));
  const present = elements.filter((el) => !el.isDeleted);
  const staying = units.filter(
    (u) => u.kind !== "frame" && (u.locked || (opts.leaveUnassigned && leftovers.includes(u.id))),
  );
  const stayingIds = new Set(staying.flatMap((u) => u.elementIds));
  // Frames that keep contents (locked, or left in place) or are locked stay, and new frames avoid them.
  const keptFrames = units.filter(
    (u) =>
      u.kind === "frame" &&
      (u.locked || present.some((el) => el.frameId === u.elementIds[0] && stayingIds.has(el.id))),
  );
  const obstacles = [...staying, ...keptFrames].map((u) => ({
    x: u.bounds.x,
    y: u.bounds.y,
    w: u.bounds.width,
    h: u.bounds.height,
  }));
  const [ox, oy] = getCommonBounds(present);
  const frames = rows(
    layouts.map((l) => ({ w: l.w + 2 * FRAME_PAD, h: l.h + 2 * FRAME_PAD })),
    { x: Math.round(ox), y: Math.round(oy) },
    obstacles,
  );

  const updated: El[] = [];
  const created: El[] = [];
  topics.forEach((t, i) => {
    const f = frames[i]!;
    const frame = newFrame(t.name, f.x, f.y, f.w, f.h);
    for (const p of layouts[i]!.placed) {
      const x = f.x + FRAME_PAD + p.x;
      const y = f.y + FRAME_PAD + p.y;
      if ("unit" in p) {
        const dx = x - p.unit.bounds.x;
        const dy = y - p.unit.bounds.y;
        for (const id of p.unit.elementIds) {
          const el = byId.get(id)!;
          updated.push(newElementWith(el, { x: el.x + dx, y: el.y + dy, frameId: frame.id } as Partial<El>));
        }
      } else {
        const built = markForMeasure(buildTemplate(p.template, { x, y }, DEFAULT_STYLE));
        created.push(...built.map((el) => ({ ...el, frameId: frame.id })));
      }
    }
    created.push(frame);
  });

  const replaced = topics.flatMap((t) => [...(t.notes?.replaces ?? []), ...(t.table?.replaces ?? [])]);
  for (const id of replaced.flatMap((u) => byUnit.get(u)!.elementIds)) {
    updated.push(newElementWith(byId.get(id)!, { isDeleted: true }));
  }
  const kept = new Set(keptFrames.map((u) => u.elementIds[0]));
  for (const old of units.filter((u) => u.kind === "frame" && !kept.has(u.elementIds[0]))) {
    updated.push(newElementWith(byId.get(old.elementIds[0]!)!, { isDeleted: true }));
  }
  return finish(elements, updated, created);
}
