import { z } from "zod";
import { appStateSubsetSchema, elementSchema } from "../../../lib/schemas";

/**
 * Messages on the private Realtime channel `board:{boardId}` (tech §15).
 * Everything from the channel is untrusted until it passes these schemas;
 * elements then go through restoreElements() like any other scene data.
 */

export const COLLAB_EVENTS = [
  "tick",
  "hello",
  "saved",
  "files",
  "follow",
  "rtc",
  "comments",
  "pointer",
] as const;
export type CollabEvent = (typeof COLLAB_EVENTS)[number];

/** Presence (one entry per open editor tab, keyed by session id). */
export const presenceSchema = z.object({
  sessionId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  name: z.string().max(80),
  avatarUrl: z.string().max(2048).nullable().optional(),
  state: z.enum(["active", "idle", "away"]).default("active"),
  /** In the voice chat, and whether muted (COLLAB-5). Older clients leave it out. */
  voice: z.enum(["off", "on", "muted"]).default("off"),
  /** When this tab started presenting (COLLAB-6); the earliest presenter wins. */
  presenting: z.number().int().positive().nullable().default(null),
  /** When this tab started sharing its screen (COLLAB-7); the earliest sharer wins. */
  sharing: z.number().int().positive().nullable().default(null),
});
export type PresenceMeta = z.infer<typeof presenceSchema>;

const sessionId = z.string().min(1).max(64);
const bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/**
 * Up to ~12 times a second: whatever changed since the last tick.
 * p = pointer, sel = selected element ids, e = changed elements,
 * b = board settings (background, grid), v = visible bounds for followers.
 */
export const tickSchema = z.object({
  s: sessionId,
  p: z
    .object({
      x: z.number(),
      y: z.number(),
      tool: z.enum(["pointer", "laser"]),
      button: z.enum(["up", "down"]),
    })
    .optional(),
  sel: z.array(z.string().max(64)).max(2000).optional(),
  e: z.array(elementSchema).max(20_000).optional(),
  b: appStateSubsetSchema.optional(),
  v: bounds.optional(),
});
export type TickPayload = z.infer<typeof tickSchema>;

/** A newcomer asks everyone for their scene (they loaded the last save). */
export const helloSchema = z.object({ s: sessionId });

/** I saved `version`, whose scene has fingerprint `fp`. */
export const savedSchema = z.object({ s: sessionId, version: z.number().int(), fp: z.string().max(200) });

/** These image files are now uploaded and can be fetched. */
export const filesSchema = z.object({ s: sessionId, ids: z.array(z.string().max(128)).max(500) });

/** I changed the board's comments (CMT-1): reload them. */
export const commentsSchema = z.object({ s: sessionId });

/** I started (on) or stopped following `target` (COLLAB-4). */
export const followSchema = z.object({ s: sessionId, target: sessionId, on: z.boolean() });

/**
 * WebRTC signaling for voice chat and screen sharing (COLLAB-5/7): an offer
 * or answer for `to`, with every ICE candidate already in its SDP. `m` says
 * which connections it's for; `id` names one connection attempt, and
 * messages for an older attempt are ignored.
 */
export const rtcSchema = z.object({
  s: sessionId,
  to: sessionId,
  m: z.enum(["voice", "screen"]),
  id: z.string().min(1).max(64),
  kind: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(32_000),
});
export type RtcPayload = z.infer<typeof rtcSchema>;

/**
 * A viewer's pointer on a shared screen (COLLAB-8), addressed to the sharer
 * (`request`, `stop`, `move`) or to the viewer (`allow`, `deny`). x and y are
 * fractions of the shared picture, so any window size lines up.
 */
export const pointerSchema = z.object({
  s: sessionId,
  to: sessionId,
  kind: z.enum(["request", "allow", "deny", "stop", "move"]),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});
export type PointerPayload = z.infer<typeof pointerSchema>;

/**
 * Splits elements into batches whose JSON stays under `maxBytes`, so each
 * fits in one broadcast. Every batch is self-contained: receivers merge each
 * one on its own.
 */
export function chunkElements<T>(elements: readonly T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const el of elements) {
    const bytes = JSON.stringify(el).length + 1;
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(el);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
