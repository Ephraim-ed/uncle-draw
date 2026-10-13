import { beforeEach, describe, expect, it } from "vitest";
import { hashSeed, boilSeeds } from "../components/sketch/seed";
import { roughPaths } from "../components/sketch/roughPaths";
import { generateShareToken, shareUrl } from "../features/share/shares.api";
import { normalizeTitle } from "../features/boards/boards.api";
import { fileNameFor } from "./download";
import {
  __resetCacheForTests,
  cacheKeys,
  clearUserCache,
  isCacheAvailable,
  readCache,
  writeCache,
} from "./localCache";
import { loginPathFor, safeNext } from "./safeNext";
import { SHARE_TOKEN_RE, localBackupSchema, sharedBoardSchema, viewportSchema } from "./schemas";
import { formatRelative, formatShortDate } from "./time";

const ORIGIN = "https://uncle.example";

describe("safeNext (AUTH-4: no open redirect)", () => {
  it.each([
    ["/boards", "/boards"],
    ["/b/123?x=1#y", "/b/123?x=1#y"],
  ])("accepts same-origin path %s", (input, expected) => {
    expect(safeNext(input, ORIGIN)).toBe(expected);
  });

  it.each([
    "https://evil.example/boards",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "boards",
    "",
    null,
    undefined,
    "/login?next=/boards",
    "/auth/callback",
  ])("rejects %s", (input) => {
    expect(safeNext(input as string | null | undefined, ORIGIN)).toBeNull();
  });

  it("builds the login redirect", () => {
    expect(loginPathFor("/b/123?x=1")).toBe("/login?next=%2Fb%2F123%3Fx%3D1");
    expect(loginPathFor("/")).toBe("/login");
  });
});

describe("stable wobble (VISUAL_DESIGN.md §5.2)", () => {
  it("hashSeed is deterministic, positive and never 0", () => {
    expect(hashSeed("board-1")).toBe(hashSeed("board-1"));
    expect(hashSeed("board-1")).not.toBe(hashSeed("board-2"));
    for (const key of ["", "a", "board", "x".repeat(500)]) expect(hashSeed(key)).toBeGreaterThan(0);
  });

  it("boil cycles through 3 distinct fixed seeds", () => {
    const seeds = boilSeeds(hashSeed("loading"));
    expect(new Set(seeds).size).toBe(3);
    expect(boilSeeds(hashSeed("loading"))).toEqual(seeds);
  });

  it("the same seed draws the same path", () => {
    const shape = { kind: "rect", x: 2, y: 2, w: 100, h: 40 } as const;
    const a = roughPaths(shape, { seed: 42, fillStyle: "solid" });
    const b = roughPaths({ ...shape }, { seed: 42, fillStyle: "solid" });
    expect(b).toEqual(a);
    expect(roughPaths(shape, { seed: 43, fillStyle: "solid" })).not.toEqual(a);
    expect(a.some((p) => p.role === "fill")).toBe(true);
    expect(a.some((p) => p.role === "stroke")).toBe(true);
  });
});

describe("share tokens (tech §6.5)", () => {
  it("are 43 base64url characters from 32 random bytes", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(SHARE_TOKEN_RE);
  });

  it("build /s/<token> URLs on this origin", () => {
    expect(shareUrl("abc")).toBe(`${window.location.origin}/s/abc`);
  });
});

describe("titles (DASH-3)", () => {
  it("trims, collapses whitespace and caps at 200 characters", () => {
    expect(normalizeTitle("  Sprint   map ")).toBe("Sprint map");
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("x".repeat(250))).toHaveLength(200);
  });

  it("file names drop characters that aren't allowed", () => {
    expect(fileNameFor('a/b:c*d?"e<f>g|h')).toBe("a b c d e f g h");
    expect(fileNameFor("tab\there")).toBe("tabhere");
    expect(fileNameFor("   ")).toBe("Untitled board");
  });
});

describe("schemas (tech §6.7)", () => {
  it("accepts a share-function response", () => {
    const ok = sharedBoardSchema.safeParse({
      title: "Sprint map",
      scene: { elements: [{ id: "r1", type: "rectangle", extra: true }] },
      app_state: { viewBackgroundColor: "#ffffff" },
      files: [{ id: "f1", mimeType: "image/png", url: "https://x.example/f1" }],
      updated_at: "2026-10-13T00:00:00Z",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects malformed scenes and unexpected file types", () => {
    expect(
      sharedBoardSchema.safeParse({ title: "x", scene: { elements: [{ type: "rectangle" }] } }).success,
    ).toBe(false);
    expect(
      sharedBoardSchema.safeParse({
        title: "x",
        scene: { elements: [] },
        app_state: {},
        files: [{ id: "f", mimeType: "text/html", url: "https://x.example" }],
        updated_at: "",
      }).success,
    ).toBe(false);
  });

  it("validates cache entries", () => {
    expect(viewportSchema.safeParse({ scrollX: 1, scrollY: 2, zoom: 0 }).success).toBe(false);
    expect(
      localBackupSchema.safeParse({ elements: [], appState: {}, localSavedAt: 1, serverVersion: 1 }).success,
    ).toBe(true);
  });
});

describe("localCache (tech §7.6)", () => {
  beforeEach(() => __resetCacheForTests());

  it("reads back what it wrote, validated by schema", async () => {
    expect(await isCacheAvailable()).toBe(true);
    const key = cacheKeys.viewport("u1", "b1");
    expect(await writeCache(key, { scrollX: 1, scrollY: 2, zoom: 1.5 })).toBe(true);
    expect(await readCache(key, viewportSchema)).toEqual({ scrollX: 1, scrollY: 2, zoom: 1.5 });
    await writeCache(key, { nope: true });
    expect(await readCache(key, viewportSchema)).toBeUndefined();
  });

  it("clears only the signed-out user's keys", async () => {
    await writeCache(cacheKeys.prefs("u1"), { a: 1 });
    await writeCache(cacheKeys.board("u1", "b1"), { b: 1 });
    await writeCache(cacheKeys.prefs("u2"), { c: 1 });
    await clearUserCache("u1");
    expect(await readCache(cacheKeys.prefs("u1"))).toBeUndefined();
    expect(await readCache(cacheKeys.board("u1", "b1"))).toBeUndefined();
    expect(await readCache(cacheKeys.prefs("u2"))).toEqual({ c: 1 });
  });
});

describe("time formatting (§6.2)", () => {
  const now = new Date("2026-10-13T15:00:00");
  it.each([
    ["2026-10-13T14:59:30", "just now"],
    ["2026-10-13T14:30:00", "30 min ago"],
    ["2026-10-13T13:00:00", "2h ago"],
    ["2026-10-12T09:00:00", "Yesterday"],
    ["2026-10-10T09:00:00", "3 days ago"],
    ["2026-09-02T09:00:00", "Sep 2"],
    ["2025-09-02T09:00:00", "Sep 2, 2025"],
  ])("%s → %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });

  it("formats share-link dates", () => {
    expect(formatShortDate("2026-10-13T10:00:00", now)).toBe("Oct 13");
  });
});
