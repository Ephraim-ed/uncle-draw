import { siteOrigin } from "../../lib/site";
import { generateShareToken } from "../../lib/shareToken";
import { supabase } from "../../lib/supabase";

export interface ShareLink {
  id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
}

const COLUMNS = "id, token, created_at, expires_at";

// Lives in lib/ so the connector's server can use it without the browser client.
export { generateShareToken } from "../../lib/shareToken";

/** Always on the public domain, so viewers never hit a protected alias. */
export function shareUrl(token: string): string {
  return `${siteOrigin()}/s/${token}`;
}

/** The board's one active link, if any (SHARE-1). */
export async function getActiveShare(boardId: string): Promise<ShareLink | null> {
  const { data, error } = await supabase
    .from("board_shares")
    .select(COLUMNS)
    .eq("board_id", boardId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createShare(boardId: string): Promise<ShareLink> {
  const { data, error } = await supabase
    .from("board_shares")
    .insert({ board_id: boardId, token: generateShareToken() })
    .select(COLUMNS)
    .single();
  if (error) {
    // Another tab created one first: the unique index allows one active link.
    if (error.code === "23505") {
      const existing = await getActiveShare(boardId);
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

/** Revokes the old link and creates a new one in one transaction (SHARE-3). */
export async function rotateShare(boardId: string): Promise<ShareLink> {
  const { data, error } = await supabase.rpc("rotate_board_share", {
    p_board_id: boardId,
    p_token: generateShareToken(),
  });
  if (error) throw error;
  // Generated types describe the composite return as a row or a one-row set.
  const row = (Array.isArray(data) ? data[0] : data) as unknown as ShareLink | undefined;
  if (!row) throw new Error("No share link returned");
  return { id: row.id, token: row.token, created_at: row.created_at, expires_at: row.expires_at };
}

/** Stop sharing: the next viewer page load fails (SHARE-3). */
export async function revokeShare(boardId: string): Promise<void> {
  const { error } = await supabase
    .from("board_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("board_id", boardId)
    .is("revoked_at", null);
  if (error) throw error;
}
