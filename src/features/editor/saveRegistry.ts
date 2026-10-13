/**
 * Open editors register their flush() here so sign-out can push pending
 * changes before the session goes away (AUTH-3).
 */
type Flush = () => Promise<void>;

const flushers = new Set<Flush>();

export function registerFlush(flush: Flush): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Flushes every open editor; never throws, never waits longer than `timeoutMs`. */
export async function flushAll(timeoutMs = 8000): Promise<void> {
  const all = Promise.allSettled([...flushers].map((f) => f()));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
