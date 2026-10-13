import { getNonDeletedElements, hashElementsVersion, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { Json } from "../../lib/database.types";
import { DB_APP_STATE_KEYS } from "./constants";

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

/** Fingerprint of what a save would write: element versions + board-level appState. */
export function sceneFingerprint(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
): string {
  return `${hashElementsVersion(elements)}#${appStateKey(appState)}`;
}

/**
 * The DB payload (tech §7.2): non-deleted elements only (v1), serialized with
 * the "database" flavor so personal UI state never reaches the board.
 */
export function toDbPayload(elements: readonly ExcalidrawElement[], appState: Partial<AppState>): DbPayload {
  const json = serializeAsJSON(getNonDeletedElements(elements), appState, {}, "database");
  const parsed = JSON.parse(json) as { elements: ExcalidrawElement[]; appState: Record<string, unknown> };
  return {
    scene: { elements: parsed.elements },
    app_state: pickDbAppState(parsed.appState),
    bytes: json.length,
  };
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
