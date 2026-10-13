import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { boardRowSchema } from "../../lib/schemas";
import { supabase } from "../../lib/supabase";
import { SCENE_MAX_BYTES } from "./constants";
import { blobToDataUrl, prepareImage, type UploadOutcome } from "./fileSync";
import { asJson, type DbPayload } from "./serialize";
import type { SaveResult } from "./saveQueue";

export interface BoardRow {
  id: string;
  owner_id: string;
  title: string;
  scene: { elements: Array<Record<string, unknown>> };
  app_state: Record<string, unknown>;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  thumbnail_path: string | null;
}

export interface BoardFileRow {
  file_id: string;
  storage_path: string;
  mime_type: string;
  created_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBoardId(id: string | undefined): id is string {
  return !!id && UUID_RE.test(id);
}

export class BoardDataError extends Error {}

/** The board row, validated before it reaches restore(); null if missing or not shared with me. */
export async function fetchBoard(boardId: string): Promise<BoardRow | null> {
  const { data, error } = await supabase
    .from("boards")
    .select("id, owner_id, title, scene, app_state, version, updated_at, deleted_at, thumbnail_path")
    .eq("id", boardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const parsed = boardRowSchema.safeParse(data);
  if (!parsed.success) throw new BoardDataError("This board's data couldn't be read.");
  return parsed.data as BoardRow;
}

export async function fetchBoardFiles(boardId: string): Promise<BoardFileRow[]> {
  const { data, error } = await supabase
    .from("board_files")
    .select("file_id, storage_path, mime_type, created_at")
    .eq("board_id", boardId);
  if (error) throw error;
  return data;
}

/** Rows for specific files (images a collaborator just added). */
export async function fetchBoardFilesByIds(boardId: string, fileIds: string[]): Promise<BoardFileRow[]> {
  if (fileIds.length === 0) return [];
  const { data, error } = await supabase
    .from("board_files")
    .select("file_id, storage_path, mime_type, created_at")
    .eq("board_id", boardId)
    .in("file_id", fileIds);
  if (error) throw error;
  return data;
}

export function looksOffline(status: number, message: string | undefined): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return (
    status === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(message ?? "")
  );
}

/** One call to save_board, classified for the save queue (tech §7.2). */
export async function saveBoard(
  boardId: string,
  expectedVersion: number,
  payload: DbPayload,
): Promise<SaveResult> {
  if (payload.bytes > SCENE_MAX_BYTES) return { kind: "tooLarge" };
  try {
    const { data, error, status } = await supabase.rpc("save_board", {
      p_board_id: boardId,
      p_expected_version: expectedVersion,
      p_scene: asJson(payload.scene),
      p_app_state: asJson(payload.app_state),
    });
    if (error) {
      if (looksOffline(status, error.message)) return { kind: "offline" };
      if (status === 413) return { kind: "tooLarge" };
      return { kind: "error", message: error.message };
    }
    if (typeof data !== "number") return { kind: "conflict" };
    return { kind: "ok", version: data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return looksOffline(0, message) ? { kind: "offline" } : { kind: "error", message };
  }
}

/** Uploads one image and records it in board_files (tech §7.4). */
export async function uploadBoardFile(
  userId: string,
  boardId: string,
  file: BinaryFileData,
  replaceDataUrl: (file: BinaryFileData) => void,
): Promise<UploadOutcome> {
  const prepared = await prepareImage(file);
  if (prepared.kind === "tooLarge") return "tooLarge";
  if (prepared.replacedDataUrl) {
    replaceDataUrl({ ...file, mimeType: "image/webp", dataURL: prepared.replacedDataUrl as DataURL });
  }

  const path = `${userId}/${boardId}/${file.id}`;
  const { error: uploadError } = await supabase.storage
    .from("board-files")
    .upload(path, prepared.blob, { contentType: prepared.mimeType, upsert: false });
  // "Already exists" means an earlier attempt got this far: carry on.
  if (
    uploadError &&
    !/exist|duplicate|409/i.test(
      `${uploadError.message} ${"statusCode" in uploadError ? String(uploadError.statusCode) : ""}`,
    )
  ) {
    return "error";
  }

  const { error: rowError } = await supabase.from("board_files").upsert(
    {
      board_id: boardId,
      file_id: file.id,
      storage_path: path,
      mime_type: prepared.mimeType,
      size_bytes: prepared.blob.size,
    },
    { onConflict: "board_id,file_id", ignoreDuplicates: true },
  );
  return rowError ? "error" : "ok";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Downloads files from signed URLs as data URLs for api.addFiles(). Failures are skipped. */
export async function downloadFiles(
  files: Array<{ id: string; mimeType: string; url: string; created?: number }>,
): Promise<BinaryFileData[]> {
  const results = await mapLimit(files, 4, async (f) => {
    try {
      const res = await fetch(f.url);
      if (!res.ok) return null;
      const dataURL = await blobToDataUrl(await res.blob());
      return {
        id: f.id as FileId,
        mimeType: f.mimeType as BinaryFileData["mimeType"],
        dataURL: dataURL as DataURL,
        created: f.created ?? Date.now(),
      } satisfies BinaryFileData;
    } catch {
      return null;
    }
  });
  return results.filter((r): r is BinaryFileData => r !== null);
}

/** Signs this board's files (1 h) and downloads them. */
export async function loadBoardFiles(rows: BoardFileRow[]): Promise<BinaryFileData[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.storage.from("board-files").createSignedUrls(
    rows.map((r) => r.storage_path),
    60 * 60,
  );
  if (error) return [];
  const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
  const signed = rows.flatMap((r) => {
    const url = byPath.get(r.storage_path);
    return url ? [{ id: r.file_id, mimeType: r.mime_type, url, created: Date.parse(r.created_at) }] : [];
  });
  return downloadFiles(signed);
}

/**
 * Uploads the preview to my own folder and points the board at it. Editors
 * render previews too, so this goes through set_board_thumbnail().
 */
export async function uploadThumbnail(userId: string, boardId: string, blob: Blob): Promise<void> {
  const path = `${userId}/${boardId}.webp`;
  const { error } = await supabase.storage
    .from("thumbnails")
    .upload(path, blob, { contentType: "image/webp", upsert: true, cacheControl: "60" });
  if (error) throw error;
  const { error: rowError } = await supabase.rpc("set_board_thumbnail", {
    p_board_id: boardId,
    p_path: path,
  });
  if (rowError) throw rowError;
}

export async function clearThumbnail(boardId: string): Promise<void> {
  const { error } = await supabase.rpc("set_board_thumbnail", { p_board_id: boardId });
  if (error) throw error;
}
