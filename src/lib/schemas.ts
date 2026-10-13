import { z } from "zod";

/**
 * Shape checks for everything loaded from the DB, the share function, local
 * cache and imported files before it reaches Excalidraw's restore() (tech §6.7).
 * They check structure only; restore() migrates and fills in element fields.
 */

export const elementSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number().optional(),
  versionNonce: z.number().optional(),
  isDeleted: z.boolean().optional(),
});

export const sceneSchema = z.looseObject({
  elements: z.array(elementSchema),
});

/** The appState subset that `serializeAsJSON(..., "database")` keeps. */
export const appStateSubsetSchema = z.looseObject({
  viewBackgroundColor: z.string().optional(),
  gridModeEnabled: z.boolean().optional(),
  gridSize: z.number().nullable().optional(),
  gridStep: z.number().optional(),
});

export const boardRowSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  title: z.string(),
  scene: sceneSchema,
  app_state: appStateSubsetSchema,
  version: z.number().int(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  thumbnail_path: z.string().nullable(),
});

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const sharedBoardSchema = z.object({
  title: z.string(),
  scene: sceneSchema,
  app_state: appStateSubsetSchema,
  files: z.array(
    z.object({
      id: z.string().min(1),
      mimeType: z.enum(IMAGE_MIME_TYPES),
      url: z.url(),
    }),
  ),
  updated_at: z.string(),
});
export type SharedBoard = z.infer<typeof sharedBoardSchema>;

/** IndexedDB `ud:{userId}:board:{boardId}` (tech §7.6). */
export const localBackupSchema = z.object({
  elements: z.array(elementSchema),
  appState: z.record(z.string(), z.unknown()),
  localSavedAt: z.number(),
  serverVersion: z.number().int(),
});
export type LocalBackup = z.infer<typeof localBackupSchema>;

/** IndexedDB `ud:{userId}:viewport:{boardId}`. */
export const viewportSchema = z.object({
  scrollX: z.number(),
  scrollY: z.number(),
  zoom: z.number().positive(),
});
export type Viewport = z.infer<typeof viewportSchema>;

/** IndexedDB `ud:{userId}:prefs`: last-used style (EDIT-5). */
export const prefsSchema = z.looseObject({
  currentItemStrokeColor: z.string().optional(),
  currentItemBackgroundColor: z.string().optional(),
  currentItemFillStyle: z.string().optional(),
  currentItemStrokeWidth: z.number().optional(),
  currentItemStrokeStyle: z.string().optional(),
  currentItemRoughness: z.number().optional(),
  currentItemOpacity: z.number().optional(),
  currentItemFontFamily: z.number().optional(),
  currentItemFontSize: z.number().optional(),
  currentItemTextAlign: z.string().optional(),
  currentItemStartArrowhead: z.string().nullable().optional(),
  currentItemEndArrowhead: z.string().nullable().optional(),
  currentItemRoundness: z.string().optional(),
});
export type Prefs = z.infer<typeof prefsSchema>;

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
