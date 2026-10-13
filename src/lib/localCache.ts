import { createStore, del, delMany, get, keys, set, type UseStore } from "idb-keyval";
import type { z } from "zod";

/**
 * IndexedDB key-value cache (tech §7.6). Every read and write is wrapped in
 * try/catch: without IndexedDB (e.g. private browsing) the editor still works,
 * we only lose the offline backup.
 */

export const cacheKeys = {
  board: (userId: string, boardId: string) => `ud:${userId}:board:${boardId}`,
  viewport: (userId: string, boardId: string) => `ud:${userId}:viewport:${boardId}`,
  prefs: (userId: string) => `ud:${userId}:prefs`,
  userPrefix: (userId: string) => `ud:${userId}:`,
};

let store: UseStore | null = null;
let availability: Promise<boolean> | null = null;

function getStore(): UseStore {
  if (!store) store = createStore("uncle-draw", "kv");
  return store;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("IndexedDB timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Probes IndexedDB once per page load. */
export function isCacheAvailable(): Promise<boolean> {
  if (!availability) {
    availability = (async () => {
      try {
        if (typeof indexedDB === "undefined") return false;
        const probe = "ud:__probe__";
        await withTimeout(set(probe, 1, getStore()), 2000);
        await withTimeout(del(probe, getStore()), 2000);
        return true;
      } catch {
        return false;
      }
    })();
  }
  return availability;
}

/** Reads a key; returns undefined when missing, invalid or unavailable. */
export async function readCache<T>(key: string, schema?: z.ZodType<T>): Promise<T | undefined> {
  try {
    if (!(await isCacheAvailable())) return undefined;
    const value: unknown = await get(key, getStore());
    if (value === undefined) return undefined;
    if (!schema) return value as T;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a key; resolves false if the write failed. */
export async function writeCache(key: string, value: unknown): Promise<boolean> {
  try {
    if (!(await isCacheAvailable())) return false;
    await set(key, value, getStore());
    return true;
  } catch {
    return false;
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    if (!(await isCacheAvailable())) return;
    await del(key, getStore());
  } catch {
    // ignore
  }
}

/** Deletes every key under `ud:{userId}:` (sign-out, AUTH-3). */
export async function clearUserCache(userId: string): Promise<void> {
  try {
    if (!(await isCacheAvailable())) return;
    const prefix = cacheKeys.userPrefix(userId);
    const all = await keys(getStore());
    const mine = all.filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
    if (mine.length > 0) await delMany(mine, getStore());
  } catch {
    // ignore
  }
}

/** Test hook: forget the availability probe and store handle. */
export function __resetCacheForTests() {
  store = null;
  availability = null;
}
