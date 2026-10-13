import { supabase } from "../../lib/supabase";

export const PAGE_SIZE = 24;
export const TITLE_MAX = 200;
export const DEFAULT_TITLE = "Untitled board";

export interface BoardSummary {
  id: string;
  title: string;
  thumbnail_path: string | null;
  updated_at: string;
  created_at: string;
}

const SUMMARY_COLUMNS = "id, title, thumbnail_path, updated_at, created_at";

/** My non-deleted boards, newest-edited first, 24 per page (DASH-1). RLS scopes rows to the owner. */
export async function listBoards(page: number): Promise<BoardSummary[]> {
  const from = page * PAGE_SIZE;
  const { data, error } = await supabase
    .from("boards")
    .select(SUMMARY_COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return data;
}

/** Creates "Untitled board" (DASH-2). Hand-drawn defaults are applied client-side (EDIT-2). */
export async function createBoard(): Promise<BoardSummary> {
  const { data, error } = await supabase.from("boards").insert({}).select(SUMMARY_COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Trims and validates a title; returns null when it should revert (DASH-3). */
export function normalizeTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length === 0) return null;
  return t.slice(0, TITLE_MAX);
}

/** Plain update: renames never bump `version`, so they never cause save conflicts. */
export async function renameBoard(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("boards").update({ title }).eq("id", id);
  if (error) throw error;
}

/** Soft delete (DASH-4). Share links stop working immediately (the share function checks deleted_at). */
export async function trashBoard(id: string): Promise<void> {
  const { error } = await supabase
    .from("boards")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreBoard(id: string): Promise<void> {
  const { error } = await supabase.from("boards").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}

/** Batch-signs thumbnail paths for 1 h (tech §7.5). */
export async function signThumbnails(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from("thumbnails").createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}
