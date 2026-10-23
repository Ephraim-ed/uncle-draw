import { supabase } from "../../../lib/supabase";

/** One comment in a thread (CMT-1). */
export interface CommentItem {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
}

/** A thread: its first comment and the replies, pinned to a shape or a spot. */
export interface CommentThread {
  id: string;
  /** The shape or text it's on; null for a spot. */
  elementId: string | null;
  /** The spot, or where the shape was (scene coordinates). */
  x: number;
  y: number;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  comments: CommentItem[];
}

export interface CommentAnchor {
  elementId: string | null;
  x: number;
  y: number;
}

/** Longest comment the database takes. */
export const COMMENT_MAX_LENGTH = 4000;

/** Every thread on the board, oldest first, each with its comments in order. */
export async function fetchComments(boardId: string): Promise<CommentThread[]> {
  const { data, error } = await supabase.rpc("board_comments", { p_board_id: boardId });
  if (error) throw error;
  const threads = new Map<string, CommentThread>();
  for (const row of data) {
    let thread = threads.get(row.thread_id);
    if (!thread) {
      thread = {
        id: row.thread_id,
        elementId: row.element_id ?? null,
        x: row.x,
        y: row.y,
        createdBy: row.thread_created_by ?? null,
        createdAt: row.thread_created_at,
        resolvedAt: row.resolved_at ?? null,
        resolvedBy: row.resolved_by ?? null,
        comments: [],
      };
      threads.set(row.thread_id, thread);
    }
    thread.comments.push({
      id: row.comment_id,
      authorId: row.author_id,
      authorName: row.author_name || "Someone",
      authorAvatarUrl: row.author_avatar_url ?? null,
      body: row.body,
      createdAt: row.created_at,
    });
  }
  return [...threads.values()];
}

/** Starts a thread with its first comment; returns the thread's id. */
export async function startThread(boardId: string, anchor: CommentAnchor, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_comment_thread", {
    p_board_id: boardId,
    // The generated types say string, but the column (and the function) take null for a spot.
    p_element_id: anchor.elementId as string,
    p_x: anchor.x,
    p_y: anchor.y,
    p_body: body,
  });
  if (error) throw error;
  return data;
}

export async function addReply(boardId: string, threadId: string, body: string): Promise<void> {
  const { error } = await supabase.from("comments").insert({ board_id: boardId, thread_id: threadId, body });
  if (error) throw error;
}

/** Resolves (in my name) or reopens a thread. */
export async function setResolved(threadId: string, resolvedBy: string | null): Promise<void> {
  const { error } = await supabase
    .from("comment_threads")
    .update({ resolved_at: resolvedBy ? new Date().toISOString() : null, resolved_by: resolvedBy })
    .eq("id", threadId);
  if (error) throw error;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;
}

/** Deletes a thread with all its replies. */
export async function deleteThread(threadId: string): Promise<void> {
  const { error } = await supabase.from("comment_threads").delete().eq("id", threadId);
  if (error) throw error;
}
