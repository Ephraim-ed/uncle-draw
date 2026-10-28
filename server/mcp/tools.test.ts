import { convertToExcalidrawElements, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Change } from "../../src/features/connector/place";
import { ConnectorError } from "../../src/features/connector/types";
import { describeUnits } from "../../src/features/connector/units";
import type { BoardInfo, BoardStore, SnapshotInfo } from "./boardStore";
import { handle } from "./handler";
import { registerTools } from "./tools";

type El = ExcalidrawElement;

/** Boards in memory, with the same contract as the Supabase store. */
class FakeStore implements BoardStore {
  boards = new Map<
    string,
    { info: BoardInfo; elements: El[]; snapshots: (SnapshotInfo & { elements: El[] })[] }
  >();
  writes = 0;
  private board(id: string) {
    const b = this.boards.get(id);
    if (!b) throw new ConnectorError("Board not found, or you don't have access to it.");
    return b;
  }
  add(title: string, elements: El[] = []) {
    const id = crypto.randomUUID();
    const info = { id, title, updatedAt: new Date().toISOString(), url: `https://draw.example/b/${id}` };
    this.boards.set(id, { info, elements: restoreElements(elements, null), snapshots: [] });
    return info;
  }
  async list(query?: string) {
    return [...this.boards.values()].map((b) => b.info).filter((b) => !query || b.title.includes(query));
  }
  async create(title: string) {
    return this.add(title);
  }
  async read(id: string) {
    const b = this.board(id);
    return { info: b.info, elements: b.elements };
  }
  async mutate(id: string, fn: (els: El[]) => Change | Promise<Change>, opts: { snapshot?: string } = {}) {
    const b = this.board(id);
    if (opts.snapshot) {
      b.snapshots.unshift({
        id: crypto.randomUUID(),
        reason: opts.snapshot,
        createdAt: new Date().toISOString(),
        elements: b.elements,
      });
    }
    const change = await fn(b.elements);
    b.elements = change.elements;
    this.writes++;
    return { info: b.info, change };
  }
  async snapshots(id: string) {
    return this.board(id).snapshots.map(({ id: sid, reason, createdAt }) => ({ id: sid, reason, createdAt }));
  }
  async snapshot(id: string, snapshotId: string) {
    const s = this.board(id).snapshots.find((x) => x.id === snapshotId);
    if (!s) throw new ConnectorError("That snapshot isn't on this board.");
    return s.elements;
  }
  async shareLink(id: string, kind: "view" | "edit") {
    this.board(id);
    return `https://draw.example/${kind === "view" ? "s" : "join"}/token`;
  }
}

const text = (id: string, x: number, y: number, value: string) =>
  convertToExcalidrawElements([{ type: "text", id, x, y, text: value }], { regenerateIds: false })[0]!;

async function connect(store: BoardStore) {
  const server = new McpServer({ name: "uncle-draw-test", version: "0.0.0" });
  registerTools(server, store);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

const flowchart = {
  kind: "flowchart",
  nodes: [
    { id: "a", label: "Start", role: "terminal" },
    { id: "b", label: "Do it" },
  ],
  links: [{ from: "a", to: "b" }],
};

describe("tools", () => {
  let store: FakeStore;
  let client: Client;
  let board: BoardInfo;
  beforeEach(async () => {
    store = new FakeStore();
    board = store.add("Plan", [text("t1", 0, 0, "call Sam"), text("t2", 300, 300, "write FAQ")]);
    client = await connect(store);
  });

  test("lists all 11 tools with destructiveHint on apply_tidy, delete_elements, restore_board", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_notes",
        "add_table",
        "apply_tidy",
        "create_board",
        "delete_elements",
        "draw_chart",
        "get_share_link",
        "list_boards",
        "list_snapshots",
        "read_board",
        "restore_board",
      ].sort(),
    );
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(destructive.sort()).toEqual(["apply_tidy", "delete_elements", "restore_board"]);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual(["list_boards", "list_snapshots", "read_board"]);
    const tidy = tools.find((t) => t.name === "apply_tidy")!;
    expect(tidy.description).toContain("the user has agreed");
  });

  test("draw_chart adds elements to the board and returns the link and created ids", async () => {
    const result = await client.callTool({
      name: "draw_chart",
      arguments: { board_id: board.id, chart: flowchart },
    });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain(board.url);
    const els = store.boards.get(board.id)!.elements;
    const created = els.filter((el) => el.customData?.udFlow);
    expect(created.length).toBe(2);
    for (const el of created) expect(out).toContain(el.id);
  });

  test("draw_chart with a bad chart explains the problem", async () => {
    const result = await client.callTool({
      name: "draw_chart",
      arguments: { board_id: board.id, chart: { ...flowchart, links: [{ from: "a", to: "zz" }] } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`"zz"`);
    expect(store.writes).toBe(0);
  });

  test("add_table and add_notes put things in a named area", async () => {
    await client.callTool({
      name: "add_table",
      arguments: {
        board_id: board.id,
        header: ["Plan", "Price"],
        rows: [["Pro", "$12"]],
        title: "Prices",
        area: "Pricing",
      },
    });
    await client.callTool({
      name: "add_notes",
      arguments: { board_id: board.id, items: ["$12/mo?"], area: "Pricing" },
    });
    const units = describeUnits(store.boards.get(board.id)!.elements);
    expect(units.filter((u) => u.kind === "frame").map((u) => u.text)).toEqual(["Pricing"]);
    // The table, its title line, and the note.
    expect(
      units
        .filter((u) => u.frame === "Pricing")
        .map((u) => u.kind)
        .sort(),
    ).toEqual(["shape", "table", "text"]);
  });

  test("read_board returns the outline text", async () => {
    const out = textOf(await client.callTool({ name: "read_board", arguments: { board_id: board.id } }));
    expect(out).toContain("[text:t1] text");
    expect(out).toContain("  call Sam");
    expect(out).toContain(board.url);
  });

  test("apply_tidy with a bad plan returns isError and leaves the store untouched", async () => {
    const before = store.boards.get(board.id)!.elements;
    const result = await client.callTool({
      name: "apply_tidy",
      arguments: { board_id: board.id, plan: { topics: [{ name: "X", units: ["chart:nope"] }] } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("chart:nope");
    expect(store.boards.get(board.id)!.elements).toBe(before);
  });

  test("apply_tidy asks the store for a 'Before tidying' snapshot", async () => {
    const result = await client.callTool({
      name: "apply_tidy",
      arguments: {
        board_id: board.id,
        plan: {
          topics: [
            {
              name: "To-do",
              units: [],
              notes: { replaces: ["text:t1", "text:t2"], items: ["call Sam", "write FAQ"] },
            },
          ],
        },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(store.boards.get(board.id)!.snapshots.map((s) => s.reason)).toEqual(["Before tidying"]);
    const units = describeUnits(store.boards.get(board.id)!.elements);
    expect(units.filter((u) => u.kind === "frame").map((u) => u.text)).toEqual(["To-do"]);
  });

  test("restore_board writes the snapshot back", async () => {
    await client.callTool({
      name: "delete_elements",
      arguments: { board_id: board.id, unit_ids: ["text:t1"] },
    });
    const snaps = textOf(
      await client.callTool({ name: "list_snapshots", arguments: { board_id: board.id } }),
    );
    const snapshotId = store.boards.get(board.id)!.snapshots[0]!.id;
    expect(snaps).toContain("Before deleting");
    expect(snaps).toContain(snapshotId);
    const result = await client.callTool({
      name: "restore_board",
      arguments: { board_id: board.id, snapshot_id: snapshotId },
    });
    expect(result.isError).toBeFalsy();
    const live = store.boards
      .get(board.id)!
      .elements.filter((el) => !el.isDeleted)
      .map((el) => el.id);
    expect(live.sort()).toEqual(["t1", "t2"]);
    expect(store.boards.get(board.id)!.snapshots[0]!.reason).toBe("Before restoring");
  });

  test("list_boards, create_board and get_share_link", async () => {
    const created = textOf(await client.callTool({ name: "create_board", arguments: { title: "Roadmap" } }));
    expect(created).toContain("Roadmap");
    expect(textOf(await client.callTool({ name: "list_boards", arguments: {} }))).toContain("Roadmap");
    expect(
      textOf(
        await client.callTool({ name: "get_share_link", arguments: { board_id: board.id, kind: "edit" } }),
      ),
    ).toContain("/join/");
  });

  test("an unexpected error is reported without details", async () => {
    store.read = async () => {
      throw new Error("db password is hunter2");
    };
    const result = await client.callTool({ name: "read_board", arguments: { board_id: board.id } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Something went wrong on Uncle Draw's side. Try again in a moment.");
  });
});

describe("handle", () => {
  beforeAll(() => {
    process.env.VITE_SUPABASE_URL ??= "https://project.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY ??= "anon";
  });

  test("no token → 401; metadata path → 200 JSON without auth", async () => {
    const unauth = await handle(new Request("https://draw.example/api/mcp", { method: "POST", body: "{}" }));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("resource_metadata=");
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/api/mcp?resource-metadata",
    ]) {
      const res = await handle(new Request(`https://draw.example${path}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: "https://draw.example/api/mcp" });
    }
  });

  test("GET on the MCP endpoint is not offered (no server-sent stream)", async () => {
    const res = await handle(
      new Request("https://draw.example/api/mcp", { headers: { authorization: "Bearer x" } }),
    );
    expect(res.status).toBe(405);
  });
});

// The whole request path with a real local token (see boardStore.int.test.ts for how to run).
const URL = process.env.API_URL;
const local = !!URL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL);
describe.skipIf(!local || !process.env.SERVICE_ROLE_KEY)("handle (local Supabase)", () => {
  test("initialize and tools/list over Streamable HTTP", async () => {
    process.env.VITE_SUPABASE_URL = URL;
    process.env.VITE_SUPABASE_ANON_KEY = process.env.ANON_KEY;
    const admin = createClient(URL!, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const email = `mcp-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await admin.auth.admin.createUser({ email, password: "pw-123456", email_confirm: true });
    const anon = createClient(URL!, process.env.ANON_KEY!, { auth: { persistSession: false } });
    const { data } = await anon.auth.signInWithPassword({ email, password: "pw-123456" });
    const post = (body: unknown) =>
      handle(
        new Request("https://draw.example/api/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${data.session!.access_token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(body),
        }),
      );
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { instructions: string } }).result.instructions).toContain(
      "read_board",
    );
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(11);
    const boards = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_boards", arguments: {} },
    });
    expect(((await boards.json()) as { result: { isError?: boolean } }).result.isError).toBeFalsy();
  });
});
