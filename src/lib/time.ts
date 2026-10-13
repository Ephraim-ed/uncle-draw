const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Short relative time for card metadata: "just now", "5 min ago", "2h ago",
 * "Yesterday", "3 days ago", "Sep 2", "Sep 2, 2025" (VISUAL_DESIGN.md §6.2).
 */
export function formatRelative(iso: string | Date, now: Date = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return `${Math.floor(diff / HOUR)}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "Oct 13" / "Oct 13, 2025" for share-link metadata. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "3:42 PM" for the local recovery prompt. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}
