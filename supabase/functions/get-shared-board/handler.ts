// get-shared-board: read-only share links (TECHNICAL_REQUIREMENTS.md §6.4).
// Pure request handling; data access is injected so it can be unit-tested.

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const SIGNED_URL_TTL_SECONDS = 600;

export interface ShareRecord {
  board_id: string;
  expires_at: string | null;
  board: {
    title: string;
    scene: unknown;
    app_state: unknown;
    updated_at: string;
    deleted_at: string | null;
  };
}

export interface FileRecord {
  file_id: string;
  mime_type: string;
  storage_path: string;
}

export interface Deps {
  /** The share with this token whose revoked_at is null, or null. */
  findActiveShare(token: string): Promise<ShareRecord | null>;
  listFiles(boardId: string): Promise<FileRecord[]>;
  /** storage_path → signed URL, for paths that could be signed. */
  signUrls(paths: string[], expiresIn: number): Promise<Record<string, string>>;
  now(): Date;
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Unknown, revoked, expired and trashed all look exactly the same. */
const notFound = () => json({ error: "not_found" }, 404);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let token: unknown;
  try {
    ({ token } = (await req.json()) as { token?: unknown });
  } catch {
    return notFound();
  }
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return notFound();

  try {
    const share = await deps.findActiveShare(token);
    if (!share) return notFound();
    if (share.board.deleted_at) return notFound();
    if (share.expires_at && new Date(share.expires_at).getTime() <= deps.now().getTime()) return notFound();

    const files = await deps.listFiles(share.board_id);
    const urls =
      files.length > 0
        ? await deps.signUrls(
            files.map((f) => f.storage_path),
            SIGNED_URL_TTL_SECONDS,
          )
        : {};

    return json(
      {
        title: share.board.title,
        scene: share.board.scene,
        app_state: share.board.app_state,
        files: files
          .filter((f) => urls[f.storage_path])
          .map((f) => ({ id: f.file_id, mimeType: f.mime_type, url: urls[f.storage_path] })),
        updated_at: share.board.updated_at,
      },
      200,
    );
  } catch (e) {
    console.error("get-shared-board failed", e instanceof Error ? e.message : e);
    return json({ error: "internal" }, 500);
  }
}
