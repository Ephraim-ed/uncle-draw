import { restore } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { Json } from "../../lib/database.types";
import { DB_APP_STATE_KEYS, TOMBSTONE_TTL_MS } from "./constants";

export type DbAppState = Partial<Pick<AppState, (typeof DB_APP_STATE_KEYS)[number]>>;

export interface DbPayload {
  scene: { elements: ExcalidrawElement[] };
  app_state: DbAppState;
  /** UTF-16 length of the JSON, a close-enough byte estimate for the size limits. */
  bytes: number;
}

/** The board-level appState subset (what the "database" serializer keeps). */
export function pickDbAppState(appState: Partial<AppState> | Record<string, unknown>): DbAppState {
  const out: Record<string, unknown> = {};
  for (const key of DB_APP_STATE_KEYS) {
    const value = (appState as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as DbAppState;
}

/** Cheap key for the appState subset, used in the no-op save check. */
export function appStateKey(appState: Partial<AppState>): string {
  return `${appState.viewBackgroundColor}|${appState.gridModeEnabled}|${appState.gridSize}|${appState.gridStep}`;
}

/**
 * Live elements, plus deleted ones for 24 h. Peers and stale tabs merge per
 * element, so a deletion must stay visible long enough to win (tech §15).
 */
export function isSyncable(element: ExcalidrawElement, now = Date.now()): boolean {
  return !element.isDeleted || now - element.updated < TOMBSTONE_TTL_MS;
}

/** 32-bit integer mix, so nearby inputs give unrelated outputs. */
function mix(n: number): number {
  let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Identifies the syncable elements at their current versions. Independent of
 * array order, so two collaborators holding the same scene always agree.
 */
export function elementsKey(elements: readonly ExcalidrawElement[], now = Date.now()): string {
  let sum = 0;
  let count = 0;
  for (const el of elements) {
    if (!isSyncable(el, now)) continue;
    sum = (sum + mix(el.versionNonce ^ Math.imul(el.version, 0x9e3779b1))) >>> 0;
    count++;
  }
  return `${count}:${sum}`;
}

/** Fingerprint of what a save would write: element versions + board-level appState. */
export function sceneFingerprint(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  now = Date.now(),
): string {
  return `${elementsKey(elements, now)}#${appStateKey(appState)}`;
}

/** Element as stored: in-progress drawing state is dropped, like Excalidraw's own serializer. */
function forStorage(element: ExcalidrawElement): ExcalidrawElement {
  return element.type === "line" || element.type === "arrow"
    ? ({ ...element, lastCommittedPoint: null } as ExcalidrawElement)
    : element;
}

/**
 * The DB payload (tech §7.2): syncable elements (tombstones included, v2) and
 * the board-level appState only, so personal UI state never reaches the board.
 */
export function toDbPayload(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  now = Date.now(),
): DbPayload {
  const kept = elements.filter((el) => isSyncable(el, now)).map(forStorage);
  const app_state = pickDbAppState(appState);
  const json = JSON.stringify({ elements: kept, appState: app_state });
  return { scene: { elements: kept }, app_state, bytes: json.length };
}

export function asJson(value: unknown): Json {
  return value as Json;
}

/**
 * Runs a stored scene through Excalidraw's restore(), which migrates old
 * element schemas and fills in missing fields. Always used on load (tech §4.3).
 */
export function restoreScene(rawElements: unknown[], rawAppState: Record<string, unknown> = {}) {
  const restored = restore(
    { elements: rawElements as ExcalidrawElement[], appState: pickDbAppState(rawAppState) },
    null,
    null,
    { repairBindings: true },
  );
  return { elements: restored.elements, dbAppState: pickDbAppState(rawAppState) };
}
