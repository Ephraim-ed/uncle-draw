// The browser stand-in loads before anything that imports Excalidraw.
import "./dom";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, protectedResourceMetadata } from "./auth";
import { supabaseBoardStore } from "./boardStore";
import { INSTRUCTIONS, registerTools } from "./tools";

export { selftest } from "./selftest";

/**
 * The connector's one HTTP entry (AI-1): protected-resource metadata for
 * sign-in discovery, and MCP over Streamable HTTP. Stateless: every request
 * gets a fresh server holding the caller's token, and replies are plain JSON.
 */

const METADATA_PATH = "/.well-known/oauth-protected-resource";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Vercel rewrites the well-known paths here with ?resource-metadata.
  if (url.pathname.startsWith(METADATA_PATH) || url.searchParams.has("resource-metadata")) {
    return withCors(Response.json(protectedResourceMetadata(origin)));
  }
  if (req.method !== "POST") {
    // No server-sent stream: a serverless function can't hold one open.
    return withCors(new Response("Use POST.", { status: 405, headers: { Allow: "POST, OPTIONS" } }));
  }

  const auth = await authenticate(req, undefined, origin);
  if (auth instanceof Response) return withCors(auth);

  const server = new McpServer({ name: "uncle-draw", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, supabaseBoardStore(auth.token));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    await server.close();
  }
}
