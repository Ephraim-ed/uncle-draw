/**
 * Validates a `next` redirect target (AUTH-4): only same-origin relative
 * paths are allowed, so `?next=` can never become an open redirect.
 */
export function safeNext(
  next: string | null | undefined,
  origin: string = window.location.origin,
): string | null {
  if (!next) return null;
  // Must be a path, not protocol-relative ("//evil") or a backslash variant
  // that browsers normalize to one ("/\evil").
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return null;
    // Never bounce back into the auth flow.
    if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Builds `/login?next=<path>` for the route guard. `next` is re-checked when read. */
export function loginPathFor(path: string): string {
  return path && path !== "/" ? `/login?next=${encodeURIComponent(path)}` : "/login";
}
