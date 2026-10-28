// The Claude connector (AI-1). The server is prebuilt into server-dist/ by
// `npm run build:mcp` (Excalidraw can't load in Node unbundled); vercel.json
// ships it with this function.
const load = () => import(new URL("../server-dist/mcp.mjs", import.meta.url).href);

export async function POST(request) {
  return (await load()).handle(request);
}
export const GET = POST;
export const DELETE = POST;
export const OPTIONS = POST;
