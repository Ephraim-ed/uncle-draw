/**
 * New-board canvas defaults that keep the hand-drawn feel (VISUAL_DESIGN.md
 * §7, EDIT-2). A user's last-used style from IndexedDB overrides them.
 */
export const HAND_DRAWN_DEFAULTS = {
  currentItemRoughness: 1, // Artist
  currentItemFontFamily: 5, // Excalifont
  currentItemFillStyle: "hachure",
  currentItemStrokeWidth: 2,
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  viewBackgroundColor: "#ffffff",
} as const;

/** appState keys kept by `serializeAsJSON(..., "database")` and stored in boards.app_state. */
export const DB_APP_STATE_KEYS = ["viewBackgroundColor", "gridModeEnabled", "gridSize", "gridStep"] as const;

/** Personal style keys remembered per device (EDIT-5). Never saved to the board. */
export const PREF_KEYS = [
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemRoundness",
] as const;

/** Autosave timing (tech §7.2). */
export const SAVE_DEBOUNCE_MS = 1500;
export const SAVE_MAX_WAIT_MS = 10_000;
export const RETRY_MIN_MS = 2000;
export const RETRY_MAX_MS = 30_000;
/**
 * A collaborator's change is saved by them; we save it ourselves only if
 * their save hasn't shown up by then (it must outlast SAVE_MAX_WAIT_MS).
 */
export const REMOTE_SAVE_DELAY_MS = 15_000;

/** Deleted elements are kept this long so a stale peer can't bring them back (tech §15). */
export const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Live collaboration (COLLAB-2/3). One message per tick carries pointer,
 * selection and changed elements, which keeps two busy editors well inside
 * Supabase Realtime's free-plan message rate.
 */
export const COLLAB_TICK_MS = 80;
/** Broadcast payloads are capped at 256 KB; big batches are split well below that. */
export const COLLAB_CHUNK_BYTES = 100_000;
/** No pointer or keyboard activity for this long shows a collaborator as idle. */
export const COLLAB_IDLE_MS = 60_000;

/** Local writes are throttled so freehand drawing stays within budget (tech §10). */
export const LOCAL_WRITE_THROTTLE_MS = 250;
export const VIEWPORT_WRITE_THROTTLE_MS = 500;

/** Scene payload limits (SAVE-6, tech §10). */
export const SCENE_WARN_BYTES = 5 * 1024 * 1024;
export const SCENE_MAX_BYTES = 20 * 1024 * 1024;

/** Images (SAVE-5). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 2048;

/** Thumbnails (tech §7.5). */
export const THUMBNAIL_INTERVAL_MS = 60_000;
export const THUMBNAIL_MAX_SIDE = 480;

/** Embeds: only these sites (tech §6.8). */
export const EMBED_ALLOW_LIST: RegExp[] = [
  /^https:\/\/(www\.)?youtube\.com\//,
  /^https:\/\/youtu\.be\//,
  /^https:\/\/(player\.)?vimeo\.com\//,
  /^https:\/\/(www\.)?figma\.com\//,
  /^https:\/\/gist\.github\.com\//,
];
