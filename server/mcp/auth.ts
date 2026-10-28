import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

/**
 * Sign-in for the connector (AI-1). Supabase Auth's OAuth server issues the
 * tokens; this server only checks them and, when one is missing or bad,
 * points the client at where to get one (RFC 9728 protected-resource metadata).
 */

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [`${serverEnv.supabaseUrl}/auth/v1`],
    bearer_methods_supported: ["header"] as ["header"],
    resource_name: "Uncle Draw" as const,
  };
}

export function unauthorized(origin: string, error?: "invalid_token"): Response {
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${
    error ? `, error="${error}"` : ""
  }`;
  return Response.json(
    { error: error ?? "unauthorized", error_description: "Sign in to Uncle Draw to use this connector." },
    { status: 401, headers: { "WWW-Authenticate": challenge } },
  );
}

/** The user id in a valid Supabase access token, or null. */
export async function verifyWithSupabase(token: string): Promise<string | null> {
  const auth = createClient(serverEnv.supabaseUrl, serverEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth;
  const { data, error } = await auth.getClaims(token);
  const sub = data?.claims?.sub;
  return !error && typeof sub === "string" && sub ? sub : null;
}

/** The caller's token and user id, or the 401 to send back. */
export async function authenticate(
  req: Request,
  verify: (token: string) => Promise<string | null> = verifyWithSupabase,
  origin = new URL(req.url).origin,
): Promise<{ token: string; userId: string } | Response> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return unauthorized(origin);
  const token = match[1]!;
  const userId = await verify(token).catch(() => null);
  return userId ? { token, userId } : unauthorized(origin, "invalid_token");
}
