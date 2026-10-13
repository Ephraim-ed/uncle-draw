import { siteOrigin } from "../../lib/site";
import { supabase } from "../../lib/supabase";
import { generateShareToken, type ShareLink } from "./shares.api";

/** Edit links (COLLAB-1): opening one and signing in makes you an editor. */
export type EditLink = ShareLink;

const COLUMNS = "id, token, created_at";

export function editLinkUrl(token: string): string {
  return `${siteOrigin()}/join/${token}`;
}

export async function getActiveEditLink(boardId: string): Promise<EditLink | null> {
  const { data, error } = await supabase
    .from("board_edit_links")
    .select(COLUMNS)
    .eq("board_id", boardId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, expires_at: null } : null;
}

export async function createEditLink(boardId: string): Promise<EditLink> {
  const { data, error } = await supabase
    .from("board_edit_links")
    .insert({ board_id: boardId, token: generateShareToken() })
    .select(COLUMNS)
    .single();
  if (error) {
    // Another tab created one first: one active edit link per board.
    if (error.code === "23505") {
      const existing = await getActiveEditLink(boardId);
      if (existing) return existing;
    }
    throw error;
  }
  return { ...data, expires_at: null };
}

/** Replaces the link in one transaction; the old one stops working. People who joined stay. */
export async function rotateEditLink(boardId: string): Promise<EditLink> {
  const { data, error } = await supabase.rpc("rotate_board_edit_link", {
    p_board_id: boardId,
    p_token: generateShareToken(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as unknown as EditLink | undefined;
  if (!row) throw new Error("No edit link returned");
  return { id: row.id, token: row.token, created_at: row.created_at, expires_at: null };
}

export async function revokeEditLink(boardId: string): Promise<void> {
  const { error } = await supabase
    .from("board_edit_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("board_id", boardId)
    .is("revoked_at", null);
  if (error) throw error;
}

export interface Person {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: "owner" | "editor";
}

/** The owner first, then editors in the order they joined. */
export async function listPeople(boardId: string): Promise<Person[]> {
  const { data, error } = await supabase.rpc("board_people", { p_board_id: boardId });
  if (error) throw error;
  return data.map((row) => ({
    userId: row.user_id,
    name: row.display_name || "Someone",
    avatarUrl: row.avatar_url,
    role: row.role === "owner" ? "owner" : "editor",
  }));
}

/** The owner removing an editor, or an editor leaving (same row). */
export async function removePerson(boardId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("board_members")
    .delete()
    .eq("board_id", boardId)
    .eq("user_id", userId);
  if (error) throw error;
}

export type JoinResult = { kind: "joined"; boardId: string } | { kind: "gone" } | { kind: "full" };

/** /join/:token → join_board(). */
export async function joinBoard(token: string): Promise<JoinResult> {
  const { data, error } = await supabase.rpc("join_board", { p_token: token });
  if (error) {
    if (error.hint === "board_full") return { kind: "full" };
    throw error;
  }
  return data ? { kind: "joined", boardId: data } : { kind: "gone" };
}
