import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, test } from "vitest";
import { authenticate, protectedResourceMetadata, unauthorized, verifyWithSupabase } from "./auth";

const ORIGIN = "https://draw.example";
const METADATA = `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
const request = (authorization?: string) =>
  new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });

beforeAll(() => {
  process.env.VITE_SUPABASE_URL ??= "https://project.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY ??= "anon";
});

describe("authenticate", () => {
  const verify = async (token: string) => (token === "good" ? "user-1" : null);

  test("no Authorization header → 401 with resource_metadata", async () => {
    const res = (await authenticate(request(), verify, ORIGIN)) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer ${METADATA}`);
  });

  test("non-Bearer scheme → 401", async () => {
    const res = (await authenticate(request("Basic Zm9vOmJhcg=="), verify, ORIGIN)) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(METADATA);
  });

  test('verify returns null (expired/forged) → 401 with error="invalid_token"', async () => {
    const res = (await authenticate(request("Bearer forged"), verify, ORIGIN)) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer ${METADATA}, error="invalid_token"`);
  });

  test("valid token → { token, userId }", async () => {
    expect(await authenticate(request("Bearer good"), verify, ORIGIN)).toEqual({
      token: "good",
      userId: "user-1",
    });
    expect(await authenticate(request("bearer   good  "), verify, ORIGIN)).toEqual({
      token: "good",
      userId: "user-1",
    });
  });

  test("a verifier that throws counts as an invalid token, not a crash", async () => {
    const res = (await authenticate(
      request("Bearer good"),
      async () => {
        throw new Error("network down");
      },
      ORIGIN,
    )) as Response;
    expect(res.status).toBe(401);
  });
});

test("unauthorized() says why in JSON as well", async () => {
  const res = unauthorized(ORIGIN, "invalid_token");
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toMatchObject({ error: "invalid_token" });
});

test("metadata points at <supabaseUrl>/auth/v1 and <origin>/api/mcp", () => {
  expect(protectedResourceMetadata(ORIGIN)).toEqual({
    resource: `${ORIGIN}/api/mcp`,
    authorization_servers: [`${process.env.VITE_SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "Uncle Draw",
  });
});

// The default verifier against the local stack (see boardStore.int.test.ts for how to run).
const URL = process.env.API_URL;
const local = !!URL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL);
describe.skipIf(!local || !process.env.SERVICE_ROLE_KEY)("verifyWithSupabase (local Supabase)", () => {
  test("a real session token gives its user id; junk gives null", async () => {
    process.env.VITE_SUPABASE_URL = URL;
    process.env.VITE_SUPABASE_ANON_KEY = process.env.ANON_KEY;
    const admin = createClient(URL!, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const email = `auth-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: "pw-123456",
      email_confirm: true,
    });
    const anon = createClient(URL!, process.env.ANON_KEY!, { auth: { persistSession: false } });
    const { data } = await anon.auth.signInWithPassword({ email, password: "pw-123456" });
    expect(await verifyWithSupabase(data.session!.access_token)).toBe(created.user!.id);
    expect(await verifyWithSupabase("not.a.jwt")).toBeNull();
  });
});
