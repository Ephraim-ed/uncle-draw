import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, test } from "vitest";
import { chartTemplate } from "../../src/features/connector/layout";
import { MEASURE_KEY } from "../../src/features/connector/marks";
import { addTemplate } from "../../src/features/connector/place";
import { ConnectorError } from "../../src/features/connector/types";
import type { Database } from "../../src/lib/database.types";
import { supabaseBoardStore } from "./boardStore";

/**
 * Runs against the local Supabase stack:
 *   export $(npx supabase status -o env | xargs) && npm run test:server -- boardStore
 * Users are created with the service-role key here only (never in server code).
 */
// Only `supabase status` values: Vitest also loads .env.local, which points at a hosted project.
const URL = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const local = !!URL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL);
const ready = local && !!(ANON && SERVICE);
if (ready) {
  process.env.VITE_SUPABASE_URL = URL;
  process.env.VITE_SUPABASE_ANON_KEY = ANON;
  process.env.VITE_SITE_URL = "https://draw.example";
}

type Db = SupabaseClient<Database>;
const NOT_FOUND = "Board not found, or you don't have access to it.";
const flow = chartTemplate({
  kind: "flowchart",
  nodes: [
    { id: "a", label: "Start" },
    { id: "b", label: "Finish" },
  ],
  links: [{ from: "a", to: "b" }],
});

async function signUp(name: string): Promise<{ token: string; db: Db; id: string }> {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const email = `${name}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: "pw-123456",
    email_confirm: true,
  });
  if (error) throw error;
  const anon = createClient<Database>(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error: signInError } = await anon.auth.signInWithPassword({ email, password: "pw-123456" });
  if (signInError) throw signInError;
  return { token: data.session!.access_token, db: anon, id: created.user!.id };
}

const ids = (els: readonly ExcalidrawElement[]) => els.filter((el) => !el.isDeleted).map((el) => el.id);
const userRect = (id: string) =>
  convertToExcalidrawElements([{ type: "rectangle", id, x: -500, y: -500, width: 80, height: 40 }], {
    regenerateIds: false,
  })[0]!;

/** A user's own save, as the editor makes it. */
async function userSave(db: Db, boardId: string, add: ExcalidrawElement) {
  const { data } = await db.from("boards").select("scene, version").eq("id", boardId).single();
  const scene = data!.scene as unknown as { elements: ExcalidrawElement[] };
  const { data: version } = await db.rpc("save_board", {
    p_board_id: boardId,
    p_expected_version: data!.version,
    p_scene: { elements: [...scene.elements, add] } as never,
    p_app_state: {},
  });
  expect(typeof version).toBe("number");
}

describe.skipIf(!ready)("supabaseBoardStore (local Supabase)", () => {
  let alice: Awaited<ReturnType<typeof signUp>>;
  let bob: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    alice = await signUp("alice");
    bob = await signUp("bob");
  });

  test("create → read → mutate round trip bumps version and stores udMeasure elements", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Launch plan");
    expect(board).toMatchObject({ title: "Launch plan", url: `https://draw.example/b/${board.id}` });
    expect((await store.read(board.id)).elements).toEqual([]);

    const { change, info } = await store.mutate(board.id, (els) => addTemplate(els, flow));
    expect(info.id).toBe(board.id);
    const { data } = await alice.db.from("boards").select("version, scene").eq("id", board.id).single();
    expect(data!.version).toBe(2);
    const stored = (data!.scene as unknown as { elements: ExcalidrawElement[] }).elements;
    expect(ids(stored).sort()).toEqual([...change.createdIds].sort());
    expect(stored.some((el) => el.customData?.[MEASURE_KEY] === true)).toBe(true);
    expect((await store.list()).map((b) => b.id)).toContain(board.id);
    expect((await store.list("launch")).map((b) => b.id)).toContain(board.id);
    expect((await store.list("nothing like it")).map((b) => b.id)).not.toContain(board.id);
  });

  test("concurrent editor save between read and save: retry keeps the editor's element and ours", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Busy board");
    let calls = 0;
    const { change } = await store.mutate(board.id, async (els) => {
      // The first time, the user saves from the editor while Claude is working.
      if (calls++ === 0) await userSave(alice.db, board.id, userRect("user-rect"));
      return addTemplate(els, flow);
    });
    expect(calls).toBe(2);
    const final = (await store.read(board.id)).elements;
    expect(ids(final)).toEqual(expect.arrayContaining(["user-rect", ...change.createdIds]));
  });

  test("a board that keeps changing gives up after 3 tries", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Very busy board");
    let calls = 0;
    await expect(
      store.mutate(board.id, async (els) => {
        await userSave(alice.db, board.id, userRect(`user-${calls++}`));
        return addTemplate(els, flow);
      }),
    ).rejects.toThrow(new ConnectorError("The board kept changing; try again."));
    expect(calls).toBe(3);
  });

  test("another user's board, a trashed board, a random uuid and a bad id all give the same not-found error", async () => {
    const mine = supabaseBoardStore(alice.token);
    const theirs = await supabaseBoardStore(bob.token).create("Bob's board");
    const trashed = await mine.create("Old board");
    await alice.db.from("boards").update({ deleted_at: new Date().toISOString() }).eq("id", trashed.id);
    for (const id of [theirs.id, trashed.id, crypto.randomUUID(), "not-a-board"]) {
      await expect(mine.read(id)).rejects.toThrow(new ConnectorError(NOT_FOUND));
      await expect(mine.mutate(id, (els) => addTemplate(els, flow))).rejects.toThrow(
        new ConnectorError(NOT_FOUND),
      );
    }
    expect((await mine.list()).map((b) => b.id)).not.toContain(trashed.id);
  });

  test("opts.snapshot writes exactly one snapshot even when the save retries", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Snapshot board");
    await store.mutate(board.id, (els) => addTemplate(els, flow));
    let calls = 0;
    await store.mutate(
      board.id,
      async (els) => {
        if (calls++ === 0) await userSave(alice.db, board.id, userRect("racer"));
        return addTemplate(els, flow);
      },
      { snapshot: "Before tidying" },
    );
    const snaps = await store.snapshots(board.id);
    expect(snaps.map((x) => x.reason)).toEqual(["Before tidying"]);
    // It holds the board as it was before this change: the first chart, not the racer or the second chart.
    const saved = await store.snapshot(board.id, snaps[0]!.id);
    expect(ids(saved)).not.toContain("racer");
    expect(ids(saved).length).toBeGreaterThan(0);
    await expect(store.snapshot(board.id, crypto.randomUUID())).rejects.toThrow(ConnectorError);
  });

  test("tick reaches a subscribed client on board:{id}", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Live board");
    const watcher = createClient<Database>(URL!, ANON!, {
      accessToken: async () => alice.token,
      auth: { persistSession: false },
    });
    await watcher.realtime.setAuth(alice.token);
    const channel = watcher.channel(`board:${board.id}`, { config: { private: true } });
    const received = new Promise<{ s: string; e: ExcalidrawElement[] }>((resolve) =>
      channel.on("broadcast", { event: "tick" }, ({ payload }) =>
        resolve(payload as { s: string; e: ExcalidrawElement[] }),
      ),
    );
    await new Promise<void>((resolve, reject) =>
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
      }),
    );
    const { change } = await store.mutate(board.id, (els) => addTemplate(els, flow));
    const tick = await received;
    expect(tick.s.startsWith("claude-")).toBe(true);
    expect(tick.e.map((el) => el.id).sort()).toEqual(change.changed.map((el) => el.id).sort());
    await watcher.removeAllChannels();
  });

  test("shareLink returns the same view link twice and an edit link under /join/; editors get a clear refusal", async () => {
    const store = supabaseBoardStore(alice.token);
    const board = await store.create("Shared board");
    const view = await store.shareLink(board.id, "view");
    expect(view).toMatch(/^https:\/\/draw\.example\/s\/[A-Za-z0-9_-]{43}$/);
    expect(await store.shareLink(board.id, "view")).toBe(view);
    const edit = await store.shareLink(board.id, "edit");
    expect(edit).toMatch(/^https:\/\/draw\.example\/join\/[A-Za-z0-9_-]{43}$/);

    await bob.db.rpc("join_board", { p_token: edit.split("/join/")[1]! });
    const asEditor = supabaseBoardStore(bob.token);
    expect((await asEditor.read(board.id)).info.title).toBe("Shared board");
    await expect(asEditor.shareLink(board.id, "view")).rejects.toThrow(ConnectorError);
  });
});
