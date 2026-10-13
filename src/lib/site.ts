import { env } from "./env";

/**
 * The address for links people open later (magic links, share links). On
 * production this is the public domain, so a link made while visiting another
 * alias (e.g. a Vercel-protected one) still works for everyone.
 */
export function siteOrigin(): string {
  return env.siteUrl ?? window.location.origin;
}

type LocationLike = Pick<Location, "origin" | "hostname" | "pathname" | "search" | "hash">;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Where to send a visitor who opened the app on another host, or null to stay.
 * Local hosts (dev, E2E) never redirect.
 */
export function canonicalRedirect(location: LocationLike, siteUrl: string | undefined): string | null {
  if (!siteUrl || location.origin === siteUrl || LOCAL_HOSTS.has(location.hostname)) return null;
  return `${siteUrl}${location.pathname}${location.search}${location.hash}`;
}
