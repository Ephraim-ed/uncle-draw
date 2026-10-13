import { safeNext } from "../../lib/safeNext";
import { siteOrigin } from "../../lib/site";

/**
 * Where to land after sign-in (AUTH-4). Kept in localStorage instead of the
 * redirect URL so the Supabase redirect allow-list only needs the exact
 * `/auth/callback` URL, and so it survives the magic link opening in a new tab.
 */
const NEXT_KEY = "ud:auth-next";
const EMAIL_KEY = "ud:last-email";
const MAX_AGE_MS = 60 * 60 * 1000;

export function rememberNext(next: string | null) {
  try {
    if (next) window.localStorage.setItem(NEXT_KEY, JSON.stringify({ path: next, at: Date.now() }));
    else window.localStorage.removeItem(NEXT_KEY);
  } catch {
    // storage blocked: fall back to /boards
  }
}

export function takeNext(): string | null {
  try {
    const raw = window.localStorage.getItem(NEXT_KEY);
    window.localStorage.removeItem(NEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.path !== "string" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return safeNext(parsed.path);
  } catch {
    return null;
  }
}

export function rememberEmail(email: string) {
  try {
    window.localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // ignore
  }
}

export function lastEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function callbackUrl(): string {
  return `${siteOrigin()}/auth/callback`;
}
