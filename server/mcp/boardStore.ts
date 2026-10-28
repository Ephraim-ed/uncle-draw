import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONNECTOR_SESSION_PREFIX } from "../../src/features/connector/marks";
import type { Change } from "../../src/features/connector/place";
import { ConnectorError } from "../../src/features/connector/types";
import { COLLAB_CHUNK_BYTES, SCENE_MAX_BYTES } from "../../src/features/editor/constants";
import { chunkElements } from "../../src/features/editor/collab/protocol";
import { asJson, restoreScene, toDbPayload } from "../../src/features/editor/serialize";
import type { Database, Json } from "../../src/lib/database.types";
import { generateShareToken } from "../../src/lib/shareToken";
import { serverEnv } from "./env";

/**
 * Boards as the signed-in user sees them (AI-1): every call carries their
 * token, so the database's own rules decide what they can reach. Writes go
 * through save_board like the editor's, retry on a conflict, and are sent
 * live to anyone with the board open.
 */

export interface BoardInfo {
  id: string;
  title: string;
  updatedAt: string;
  url: string;
}

export interface SnapshotInfo {
  id: string;
  reason: string;
  createdAt: string;
}

export interface BoardStore {
  /** Newest first, at most 50, trashed boards left out. */
  list(query?: string): Promise<BoardInfo[]>;
  create(title: string): Promise<BoardInfo>;
  read(boardId: string): Promise<{ info: BoardInfo; elements: ExcalidrawElement[] }>;
  mutate(
    boardId: string,
    fn: (elements: ExcalidrawElement[]) => Change | Promise<Change>,
    opts?: { snapshot?: string },
  ): Promise<{ info: BoardInfo; change: Change }>;
  snapshots(boardId: string): Promise<SnapshotInfo[]>;
  snapshot(boardId: string, snapshotId: string): Promise<ExcalidrawElement[]>;
  shareLink(boardId: string, kind: "view" | "edit"): Promise<string>;
}

type Db = SupabaseClient<Database>;

const NOT_FOUND = "Board not found, or you don't have access to it.";
const MAX_ATTEMPTS = 3;
const LIST_LIMIT = 50;
const TITLE_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function supabaseBoardStore(
  token: string,
  sessionId = `${CONNECTOR_SESSION_PREFIX}${crypto.randomUUID()}`,
): BoardStore {
  const db: Db = createClient<Database>(serverEnv.supabaseUrl, serverEnv.anonKey, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const site = serverEnv.siteUrl;
  const info = (row: { id: string; title: string; updated_at: string }): BoardInfo => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    url: `${site}/b/${row.id}`,
  });

  async function row(boardId: string) {
    if (!UUID_RE.test(boardId)) throw new ConnectorError(NOT_FOUND);
    const { data, error } = await db
      .from("boards")
      .select("id, title, scene, app_state, version, updated_at, deleted_at")
      .eq("id", boardId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.deleted_at) throw new ConnectorError(NOT_FOUND);
    return data;
  }

  function scene(r: Awaited<ReturnType<typeof row>>) {
    const raw = (r.scene as { elements?: unknown[] } | null)?.elements;
    return restoreScene(Array.isArray(raw) ? raw : [], (r.app_state ?? {}) as Record<string, unknown>);
  }

  async function broadcast(boardId: string, changed: readonly ExcalidrawElement[]) {
    if (changed.length === 0) return;
    const channel = db.channel(`board:${boardId}`, { config: { private: true } });
    try {
      await db.realtime.setAuth(token);
      // Chunked like the editor's own ticks.
      for (const chunk of chunkElements(changed, COLLAB_CHUNK_BYTES)) {
        await channel.httpSend("tick", { s: sessionId, e: chunk });
      }
    } catch (e) {
      // The save already happened; open editors pick it up when they next save.
      console.warn("Live update failed", e);
    } finally {
      await db.removeChannel(channel);
    }
  }

  return {
    async list(query) {
      let q = db.from("boards").select("id, title, updated_at").is("deleted_at", null);
      const words = query?.trim();
      if (words) q = q.ilike("title", `%${words.replace(/[\\%_]/g, "\\$&")}%`);
      const { data, error } = await q
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return data.map(info);
    },

    async create(title) {
      const name = title.trim();
      if (!name || name.length > TITLE_MAX) {
        throw new ConnectorError(`A board title needs 1 to ${TITLE_MAX} characters.`);
      }
      const { data, error } = await db
        .from("boards")
        .insert({ title: name })
        .select("id, title, updated_at")
        .single();
      if (error) throw error;
      return info(data);
    },

    async read(boardId) {
      const r = await row(boardId);
      return { info: info(r), elements: scene(r).elements };
    },

    async mutate(boardId, fn, opts = {}) {
      let snapshotted = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const r = await row(boardId);
        const { elements, dbAppState } = scene(r);
        if (opts.snapshot && !snapshotted) {
          const before = toDbPayload(elements, dbAppState);
          const { error } = await db.from("board_snapshots").insert({
            board_id: boardId,
            reason: opts.snapshot,
            scene: asJson(before.scene) as NonNullable<Json>,
            app_state: asJson(before.app_state) as NonNullable<Json>,
          });
          if (error) throw error;
          snapshotted = true;
        }
        const change = await fn(elements);
        const payload = toDbPayload(change.elements, dbAppState);
        if (payload.bytes > SCENE_MAX_BYTES) {
          throw new ConnectorError("That would make the board too big to save. Try a smaller change.");
        }
        const { data: version, error } = await db.rpc("save_board", {
          p_board_id: boardId,
          p_expected_version: r.version,
          p_scene: asJson(payload.scene),
          p_app_state: asJson(payload.app_state),
        });
        if (error) throw error;
        if (typeof version === "number") {
          await broadcast(boardId, change.changed);
          return { info: info({ ...r, updated_at: new Date().toISOString() }), change };
        }
        // Someone saved in between: read their version and do it again on top.
      }
      throw new ConnectorError("The board kept changing; try again.");
    },

    async snapshots(boardId) {
      await row(boardId);
      const { data, error } = await db
        .from("board_snapshots")
        .select("id, reason, created_at")
        .eq("board_id", boardId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((s) => ({ id: s.id, reason: s.reason, createdAt: s.created_at }));
    },

    async snapshot(boardId, snapshotId) {
      await row(boardId);
      const { data, error } = UUID_RE.test(snapshotId)
        ? await db
            .from("board_snapshots")
            .select("scene, app_state")
            .eq("board_id", boardId)
            .eq("id", snapshotId)
            .maybeSingle()
        : { data: null, error: null };
      if (error) throw error;
      if (!data)
        throw new ConnectorError(
          "That snapshot isn't on this board. List the snapshots to see which there are.",
        );
      const raw = (data.scene as { elements?: unknown[] } | null)?.elements;
      return restoreScene(Array.isArray(raw) ? raw : [], (data.app_state ?? {}) as Record<string, unknown>)
        .elements;
    },

    async shareLink(boardId, kind) {
      await row(boardId);
      const table = kind === "view" ? "board_shares" : "board_edit_links";
      const active = async () => {
        const { data, error } = await db
          .from(table)
          .select("token")
          .eq("board_id", boardId)
          .is("revoked_at", null)
          .maybeSingle();
        if (error) throw error;
        return data?.token ?? null;
      };
      let tokenValue = await active();
      if (!tokenValue) {
        const { data, error } = await db
          .from(table)
          .insert({ board_id: boardId, token: generateShareToken() })
          .select("token")
          .single();
        if (error?.code === "42501") throw new ConnectorError("Only the board's owner can make share links.");
        // Another tab made one first: there's one active link per board.
        if (error?.code === "23505") tokenValue = await active();
        else if (error) throw error;
        else tokenValue = data.token;
      }
      if (!tokenValue) throw new ConnectorError("Only the board's owner can make share links.");
      return `${site}/${kind === "view" ? "s" : "join"}/${tokenValue}`;
    },
  };
}
