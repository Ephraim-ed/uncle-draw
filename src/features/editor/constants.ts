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

/**
 * Voice chat (COLLAB-5) is a peer-to-peer mesh: everyone sends their audio to
 * everyone else, so the call is capped to keep each person's upload small.
 */
export const VOICE_MAX_PEOPLE = 8;
/** Screen sharing (COLLAB-7) sends one video per viewer, so it's capped too. */
export const SCREEN_MAX_VIEWERS = 8;
/** A viewer's pointer on a shared screen vanishes after this long without moving (COLLAB-8). */
export const SCREEN_POINTER_IDLE_MS = 3000;
/** WebRTC connections: how long to wait for ICE candidates before sending an offer or answer anyway. */
export const PEER_GATHER_MS = 2500;
/** A connection that isn't up by then is started over (by whoever offered it). */
export const PEER_CONNECT_TIMEOUT_MS = 15_000;
export const PEER_RETRY_MIN_MS = 2000;
export const PEER_RETRY_MAX_MS = 30_000;
/** An offer can arrive before presence says its sender is in the call or sharing. */
export const PEER_PRESENCE_GRACE_MS = 5000;
/** Speaking: loudness (RMS, 0–1) above this level, polled this often, held this long. */
export const VOICE_SPEAKING_LEVEL = 0.03;
export const VOICE_METER_MS = 100;
export const VOICE_SPEAKING_HOLD_MS = 400;

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
