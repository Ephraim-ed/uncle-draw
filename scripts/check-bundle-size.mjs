#!/usr/bin/env node
// Shell JS budget (tech §10): everything the app loads before the lazy editor
// and share chunks must stay ≤ 200 KB gzip. Walks the Vite manifest's static
// import graph from index.html; dynamic imports (EditorPage, SharePage, the
// dev kit) are excluded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 200;
const dist = process.argv[2] ?? "dist";

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
} catch {
  console.error(`No manifest in ${dist}/.vite/. Run \`npm run build\` first.`);
  process.exit(1);
}

const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
const seen = new Set();
const files = [];

function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) return;
  if (chunk.file.endsWith(".js")) files.push(chunk.file);
  for (const dep of chunk.imports ?? []) visit(dep);
}
for (const [key] of entries) visit(key);

let total = 0;
const rows = files.map((file) => {
  const size = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
  total += size;
  return { file, kb: size / 1024 };
});
rows.sort((a, b) => b.kb - a.kb);

for (const row of rows) console.log(`${row.kb.toFixed(1).padStart(8)} KB  ${row.file}`);
const totalKb = total / 1024;
console.log(`${totalKb.toFixed(1).padStart(8)} KB  total shell JS (gzip), budget ${BUDGET_KB} KB`);

if (totalKb > BUDGET_KB) {
  console.error(`✗ Shell JS is over budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
console.log("✓ Within budget.");
