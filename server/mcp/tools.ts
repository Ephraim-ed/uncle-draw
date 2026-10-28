import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notesTemplate, tableTemplate } from "../../src/features/connector/blocks";
import { deleteUnits, restoreSnapshot } from "../../src/features/connector/history";
import { chartTemplate } from "../../src/features/connector/layout";
import { addTemplate, type Change } from "../../src/features/connector/place";
import { applyTidy } from "../../src/features/connector/tidy";
import { ConnectorError, LIMITS } from "../../src/features/connector/types";
import { describeUnits, outline } from "../../src/features/connector/units";
import type { BoardInfo, BoardStore } from "./boardStore";

/**
 * The connector's tools (AI-1…5): thin wrappers that read or change a board
 * through the store and say what happened in plain text.
 */

export const INSTRUCTIONS = `Uncle Draw is a hand-drawn whiteboard. These tools make flowchart-style charts, tables and notes on the user's boards, and tidy messy boards.
- Charts are laid out automatically: give nodes and links, never coordinates.
- To tidy a board: call read_board, group its units into topics, then show the user the topics (which units go in each, and how loose text becomes notes or a table) and wait for their OK. Only then call apply_tidy. Keep the user's own wording.
- Tidying, deleting and restoring save a snapshot first; list_snapshots and restore_board put a board back.
- Changes show up live for anyone with the board open.`;

const GENERIC_ERROR = "Something went wrong on Uncle Draw's side. Try again in a moment.";
/** Ids listed in a reply; the rest are counted. */
const MAX_IDS_SHOWN = 60;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const reply = (text: string, isError = false): Result => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError } : {}),
});

/** Runs a tool body; problems with the request go back to Claude, anything else is logged. */
function safely<A>(body: (args: A) => Promise<string>): (args: A) => Promise<Result> {
  return async (args) => {
    try {
      return reply(await body(args));
    } catch (e) {
      if (e instanceof ConnectorError) return reply(e.message, true);
      console.error("Connector tool failed", e);
      return reply(GENERIC_ERROR, true);
    }
  };
}

function idList(ids: readonly string[]) {
  const shown = ids.slice(0, MAX_IDS_SHOWN).join(", ");
  return ids.length > MAX_IDS_SHOWN ? `${shown} … and ${ids.length - MAX_IDS_SHOWN} more` : shown;
}

function done(what: string, info: BoardInfo, change: Change) {
  const lines = [`${what} on "${info.title}": ${info.url}`];
  if (change.createdIds.length > 0)
    lines.push(`Created ${change.createdIds.length} elements: ${idList(change.createdIds)}`);
  const updated = change.changed.length - change.createdIds.length;
  if (updated > 0) lines.push(`Changed ${updated} elements.`);
  return lines.join("\n");
}

// --- input schemas -------------------------------------------------------------------

const boardId = z.string().describe("The board's id, from list_boards or create_board.");
const area = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    "Put it inside the frame with this name, made if it doesn't exist. Leave out to place it in free space.",
  );
const label = z.string().max(LIMITS.label);
const text = z.string().max(LIMITS.text);
const itemId = z.string().min(1).max(100);

const chart = z.object({
  kind: z
    .enum(["flowchart", "swimlanes", "mindmap", "orgchart", "timeline", "kanban"])
    .describe(
      "flowchart: steps and decisions. swimlanes: steps in lanes (who does what). mindmap and orgchart: trees from links (parent → child). timeline: items in order. kanban: cards in columns (lanes).",
    ),
  direction: z.enum(["down", "right"]).optional().describe("Flowcharts only. Default down."),
  title: label.optional(),
  lanes: z.array(label).max(LIMITS.lanes).optional().describe("Swimlane rows or kanban columns, in order."),
  nodes: z
    .array(
      z.object({
        id: itemId,
        label,
        role: z
          .enum(["step", "decision", "terminal", "note"])
          .optional()
          .describe("Flowcharts: terminal for start/end, decision for questions. Default step."),
        lane: label.optional().describe("Swimlanes and kanban: which lane or column."),
      }),
    )
    .min(1)
    .max(LIMITS.nodes),
  links: z
    .array(
      z.object({
        from: itemId,
        to: itemId,
        label: label.optional().describe("Shown on the arrow, e.g. Yes or No."),
        arrow: z.boolean().optional().describe("false for a plain line. Default true."),
      }),
    )
    .max(LIMITS.links)
    .default([]),
});

const unitIds = z.array(z.string()).max(2000);
const tidyPlan = z.object({
  topics: z
    .array(
      z.object({
        name: label.describe("The topic; its frame gets this name."),
        units: unitIds.default([]).describe("Unit ids from read_board to move into this topic."),
        notes: z
          .object({
            replaces: unitIds.describe("Loose text units these notes replace."),
            title: label.optional(),
            items: z.array(text).min(1).max(LIMITS.items).describe("One bullet each, in the user's words."),
          })
          .optional(),
        table: z
          .object({
            replaces: unitIds.describe("Loose text units this table replaces."),
            header: z.array(text).max(LIMITS.cols),
            rows: z.array(z.array(text).max(LIMITS.cols)).max(LIMITS.rows),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(30),
});

// --- tools ----------------------------------------------------------------------------

export function registerTools(server: McpServer, store: BoardStore): void {
  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "The user's boards and boards shared with them, newest first. Optionally filter by title.",
      inputSchema: { query: z.string().max(200).optional().describe("Part of a board title.") },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ query }) => {
      const boards = await store.list(query);
      if (boards.length === 0) return query ? `No boards match "${query}".` : "No boards yet.";
      return boards
        .map((b) => `- ${b.title} (board_id ${b.id}, updated ${b.updatedAt}): ${b.url}`)
        .join("\n");
    }),
  );

  server.registerTool(
    "create_board",
    {
      title: "Create a board",
      description: "A new, empty board.",
      inputSchema: { title: z.string().min(1).max(200) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ title }) => {
      const b = await store.create(title);
      return `Created "${b.title}" (board_id ${b.id}): ${b.url}`;
    }),
  );

  server.registerTool(
    "read_board",
    {
      title: "Read a board",
      description:
        "What's on a board, as units: charts (with their links as text), tables, frames, loose text, shapes, groups and images. Each has an id, position, size and text. Use the ids with apply_tidy and delete_elements.",
      inputSchema: { board_id: boardId },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ board_id }) => {
      const { info, elements } = await store.read(board_id);
      return `"${info.title}": ${info.url}\n\n${outline(describeUnits(elements))}`;
    }),
  );

  server.registerTool(
    "draw_chart",
    {
      title: "Draw a chart",
      description:
        "Draws a flowchart-style chart from nodes and links, laid out automatically, in free space or in a named area. The shapes are ordinary, editable Uncle Draw shapes.",
      inputSchema: { board_id: boardId, chart, area },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ board_id, chart: spec, area: name }) => {
      const t = chartTemplate(spec);
      const { info, change } = await store.mutate(board_id, (els) => addTemplate(els, t, { area: name }));
      return done("Drew the chart", info, change);
    }),
  );

  server.registerTool(
    "add_table",
    {
      title: "Add a table",
      description: "Adds an editable table with a header row. Cells are kept exactly as given.",
      inputSchema: {
        board_id: boardId,
        header: z.array(text).min(1).max(LIMITS.cols),
        rows: z.array(z.array(text).max(LIMITS.cols)).max(LIMITS.rows),
        title: label.optional().describe("A line of text above the table."),
        area,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ board_id, header, rows, title, area: name }) => {
      const t = tableTemplate(header, rows);
      const titled = title
        ? {
            ...t,
            notes: [{ text: title, x: t.table!.widths.reduce((a, b) => a + b, 0) / 2, y: -56, size: 24 }],
          }
        : t;
      const { info, change } = await store.mutate(board_id, (els) =>
        addTemplate(els, titled, { area: name }),
      );
      return done("Added the table", info, change);
    }),
  );

  server.registerTool(
    "add_notes",
    {
      title: "Add notes",
      description: "Adds a sticky note with an optional title and a bullet per item, in the user's words.",
      inputSchema: {
        board_id: boardId,
        title: label.optional(),
        items: z.array(text).min(1).max(LIMITS.items),
        area,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ board_id, title, items, area: name }) => {
      const t = notesTemplate(title, items);
      const { info, change } = await store.mutate(board_id, (els) => addTemplate(els, t, { area: name }));
      return done("Added the notes", info, change);
    }),
  );

  server.registerTool(
    "apply_tidy",
    {
      title: "Tidy a board",
      description:
        "Rearranges a board into one frame per topic: charts down the left, notes beside them, tables below, nothing overlapping. Loose text listed in notes.replaces or table.replaces is replaced by those notes or that table. Units left out go in a Misc frame; locked things stay put. Only call after you have shown the user the topics, which units go in each, and how loose text becomes notes or a table, and the user has agreed. Keep the user's wording in notes; never reword chart labels or table cells. A snapshot is saved first.",
      inputSchema: { board_id: boardId, plan: tidyPlan },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    safely(async ({ board_id, plan }) => {
      const { info, change } = await store.mutate(board_id, (els) => applyTidy(els, plan), {
        snapshot: "Before tidying",
      });
      return done("Tidied the board", info, change);
    }),
  );

  server.registerTool(
    "delete_elements",
    {
      title: "Delete units",
      description:
        "Deletes units (ids from read_board), e.g. something drawn by mistake. Deleting a frame deletes what's in it. A snapshot is saved first.",
      inputSchema: { board_id: boardId, unit_ids: unitIds.min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    safely(async ({ board_id, unit_ids }) => {
      const { info, change } = await store.mutate(board_id, (els) => deleteUnits(els, unit_ids), {
        snapshot: "Before deleting",
      });
      return `Deleted ${change.changed.length} elements on "${info.title}": ${info.url}`;
    }),
  );

  server.registerTool(
    "list_snapshots",
    {
      title: "List snapshots",
      description:
        "Saved versions of a board from before it was tidied, deleted from or restored, newest first.",
      inputSchema: { board_id: boardId },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ board_id }) => {
      const snaps = await store.snapshots(board_id);
      if (snaps.length === 0) return "No snapshots yet.";
      return snaps.map((s) => `- ${s.id}: ${s.reason} (${s.createdAt})`).join("\n");
    }),
  );

  server.registerTool(
    "restore_board",
    {
      title: "Put a board back",
      description:
        "Puts a board back the way it was in a snapshot (from list_snapshots). Anything added since is removed. The current state is saved as a snapshot first, so this can be undone too.",
      inputSchema: { board_id: boardId, snapshot_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    safely(async ({ board_id, snapshot_id }) => {
      const saved = await store.snapshot(board_id, snapshot_id);
      const { info } = await store.mutate(board_id, (els) => restoreSnapshot(els, saved), {
        snapshot: "Before restoring",
      });
      return `Put "${info.title}" back as it was in that snapshot: ${info.url}`;
    }),
  );

  server.registerTool(
    "get_share_link",
    {
      title: "Get a share link",
      description:
        "The board's view link (anyone with it can look) or edit link (anyone with it can edit after signing in), made if there isn't one. Only the board's owner can do this.",
      inputSchema: { board_id: boardId, kind: z.enum(["view", "edit"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    safely(async ({ board_id, kind }) => {
      const url = await store.shareLink(board_id, kind);
      return kind === "view"
        ? `Anyone with this link can view the board: ${url}`
        : `Anyone with this link can edit after signing in: ${url}`;
    }),
  );
}
