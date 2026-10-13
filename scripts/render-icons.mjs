#!/usr/bin/env node
// Renders the pencil mark (VISUAL_DESIGN.md §2) into the favicon set:
// public/favicon.svg plus 32, 180 and 512 px PNGs on a transparent background.
// Uses the same geometry and seeds as <PencilMark>. Run: npm run icons
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import rough from "roughjs";
import { PENCIL_PARTS, PENCIL_ROTATION, PENCIL_SEED } from "../src/brand/pencil.ts";

const gen = rough.generator();

// Fixed colors: a standalone SVG can't read the app's CSS tokens.
const LIGHT = { ink: "#1e1e1e", primary: "#1971c2", highlight: "#ffec99" };
const DARK = { ink: "#e8e6e3", primary: "#4dabf7", highlight: "#ffec99" };

function partPaths() {
  const out = [];
  PENCIL_PARTS.forEach((part, i) => {
    const opts = {
      seed: PENCIL_SEED + i * 31,
      roughness: 1,
      bowing: 1,
      strokeWidth: 1.6,
      stroke: "S",
      ...(part.fillTone ? { fill: "F", fillStyle: part.fillStyle ?? "hachure", hachureGap: 3 } : {}),
    };
    const pts = part.points.map(([x, y]) => [x, y]);
    const drawable = part.closed ? gen.polygon(pts, opts) : gen.linearPath(pts, opts);
    for (const p of gen.toPaths(drawable)) {
      if (p.fill === "F") out.push({ d: p.d, cls: `f-${part.fillTone}` });
      else if (p.stroke === "F") out.push({ d: p.d, cls: `h-${part.fillTone}`, w: p.strokeWidth });
      else if (p.stroke === "S") out.push({ d: p.d, cls: `s-${part.tone}`, w: p.strokeWidth });
    }
  });
  return out;
}

function css(c) {
  return Object.entries(c)
    .map(
      ([tone, color]) =>
        `.s-${tone},.h-${tone}{fill:none;stroke:${color}}.f-${tone}{fill:${color};stroke:none}`,
    )
    .join("");
}

const paths = partPaths()
  .map(
    (p) => `<path class="${p.cls}" d="${p.d}"${p.w ? ` stroke-width="${p.w}"` : ""} stroke-linecap="round"/>`,
  )
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<style>${css(LIGHT)}@media (prefers-color-scheme: dark){${css(DARK)}}</style>
<g transform="rotate(${PENCIL_ROTATION} 32 32)">${paths}</g>
</svg>
`;

writeFileSync("public/favicon.svg", svg);
console.log("wrote public/favicon.svg");

const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: "light" });
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
for (const [size, file] of [
  [32, "public/favicon-32.png"],
  [180, "public/apple-touch-icon.png"],
  [512, "public/icon-512.png"],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  await page.screenshot({ path: file, omitBackground: true });
  console.log(`wrote ${file}`);
}
await browser.close();
