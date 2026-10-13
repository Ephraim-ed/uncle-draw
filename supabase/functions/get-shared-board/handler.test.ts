// Deno tests for get-shared-board (tech §14): valid, revoked, expired and
// unknown tokens; deleted board. Run: deno test supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import { handle, type Deps, type ShareRecord } from "./handler.ts";

const VALID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = new Date("2026-10-13T12:00:00Z");

function share(overrides: Partial<ShareRecord> = {}, board: Partial<ShareRecord["board"]> = {}): ShareRecord {
  return {
    board_id: "b1",
    expires_at: null,
    ...overrides,
    board: {
      title: "Sprint map",
      scene: { elements: [{ id: "r1", type: "rectangle" }] },
      app_state: { viewBackgroundColor: "#ffffff" },
      updated_at: "2026-10-13T11:00:00Z",
      deleted_at: null,
      ...board,
    },
  };
}

/** In-memory store standing in for the service-role client. Revoked shares are simply absent. */
function deps(active: Record<string, ShareRecord>, opts: { failSign?: boolean } = {}): Deps {
  return {
    findActiveShare: (token) => Promise.resolve(active[token] ?? null),
    listFiles: (boardId) =>
      Promise.resolve(
        boardId === "b1"
          ? [
              { file_id: "f1", mime_type: "image/png", storage_path: "u1/b1/f1" },
              { file_id: "f2", mime_type: "image/webp", storage_path: "u1/b1/f2" },
            ]
          : [],
      ),
    signUrls: (paths) =>
      opts.failSign
        ? Promise.reject(new Error("storage down"))
        : Promise.resolve(
            Object.fromEntries(paths.filter((p) => p !== "u1/b1/f2").map((p) => [p, `https://signed/${p}`])),
          ),
    now: () => NOW,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/get-shared-board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("valid token returns the board with signed file URLs", async () => {
  const res = await handle(post({ token: VALID }), deps({ [VALID]: share() }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assertEquals(body.title, "Sprint map");
  assertEquals(body.scene.elements[0].id, "r1");
  assertEquals(body.app_state, { viewBackgroundColor: "#ffffff" });
  assertEquals(body.updated_at, "2026-10-13T11:00:00Z");
  // f2 couldn't be signed (e.g. missing object): it's left out, never a broken URL.
  assertEquals(body.files, [{ id: "f1", mimeType: "image/png", url: "https://signed/u1/b1/f1" }]);
});

Deno.test("unknown token is a 404", async () => {
  const res = await handle(post({ token: VALID }), deps({}));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("revoked token is the same 404 (revoked shares aren't active)", async () => {
  const res = await handle(post({ token: VALID }), deps({}));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("expired token is the same 404", async () => {
  const res = await handle(
    post({ token: VALID }),
    deps({ [VALID]: share({ expires_at: "2026-10-13T11:59:59Z" }) }),
  );
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("a link that hasn't expired yet still works", async () => {
  const res = await handle(
    post({ token: VALID }),
    deps({ [VALID]: share({ expires_at: "2026-10-14T00:00:00Z" }) }),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("a trashed board is the same 404", async () => {
  const res = await handle(
    post({ token: VALID }),
    deps({ [VALID]: share({}, { deleted_at: "2026-10-13T10:00:00Z" }) }),
  );
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("malformed tokens never reach the database", async () => {
  let looked = false;
  const d = deps({});
  d.findActiveShare = () => {
    looked = true;
    return Promise.resolve(null);
  };
  for (const body of [{ token: "short" }, { token: 42 }, {}, "not json"]) {
    const res = await handle(post(body), d);
    assertEquals(res.status, 404);
    await res.body?.cancel();
  }
  assertEquals(looked, false);
});

Deno.test("OPTIONS answers CORS preflight; other methods are rejected", async () => {
  const pre = await handle(new Request("http://localhost/x", { method: "OPTIONS" }), deps({}));
  assertEquals(pre.status, 200);
  assertEquals(pre.headers.get("Access-Control-Allow-Origin"), "*");
  await pre.body?.cancel();
  const get = await handle(new Request("http://localhost/x", { method: "GET" }), deps({}));
  assertEquals(get.status, 405);
  await get.body?.cancel();
});

Deno.test("storage failures are a 500, not a leak", async () => {
  const res = await handle(post({ token: VALID }), deps({ [VALID]: share() }, { failSign: true }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal" });
});
