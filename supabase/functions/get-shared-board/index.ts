// get-shared-board Edge Function. The service-role client exists only here;
// share links never touch RLS (TECHNICAL_REQUIREMENTS.md §6.4).
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { handle, type FileRecord, type ShareRecord } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handle(req, {
    async findActiveShare(token): Promise<ShareRecord | null> {
      const { data, error } = await supabase
        .from("board_shares")
        .select("board_id, expires_at, boards!inner(title, scene, app_state, updated_at, deleted_at)")
        .eq("token", token)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const board = Array.isArray(data.boards) ? data.boards[0] : data.boards;
      if (!board) return null;
      return { board_id: data.board_id, expires_at: data.expires_at, board };
    },

    async listFiles(boardId): Promise<FileRecord[]> {
      const { data, error } = await supabase
        .from("board_files")
        .select("file_id, mime_type, storage_path")
        .eq("board_id", boardId);
      if (error) throw error;
      return data ?? [];
    },

    async signUrls(paths, expiresIn) {
      const { data, error } = await supabase.storage.from("board-files").createSignedUrls(paths, expiresIn);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
      }
      return out;
    },

    now: () => new Date(),
  }),
);
