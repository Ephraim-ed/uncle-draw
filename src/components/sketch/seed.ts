/**
 * Deterministic Rough.js seeds (VISUAL_DESIGN.md §5.2). A given key always
 * yields the same wobble, so shapes never re-randomize on re-render.
 */
export function hashSeed(key: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Rough.js treats seed 0 as "random", so never return it.
  return (h >>> 0) % 2147483646 || 1;
}

/** The three fixed seeds a "boiling" shape cycles through (§8). */
export function boilSeeds(seed: number): [number, number, number] {
  return [seed, (seed + 7919) % 2147483646 || 1, (seed + 15838) % 2147483646 || 1];
}
