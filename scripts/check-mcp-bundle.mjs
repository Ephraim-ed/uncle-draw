#!/usr/bin/env node
// The connector's Node bundle (AI-1) must load Excalidraw and build every
// template outside a browser. Run after `npm run build:mcp`.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const bundle = "server-dist/mcp.mjs";
if (!existsSync(bundle)) {
  console.error(`No ${bundle}. Run \`npm run build:mcp\` first.`);
  process.exit(1);
}

const { selftest } = await import(pathToFileURL(bundle).href);
const count = selftest();
if (!(count > 200)) {
  console.error(`The bundle built only ${count} elements from the templates.`);
  process.exit(1);
}
console.log(`MCP bundle OK: ${count} template elements built in Node.`);
