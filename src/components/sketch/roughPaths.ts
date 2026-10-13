import rough from "roughjs";
import type { Options } from "roughjs/bin/core";

/**
 * Rough.js path generation for the sketchy shell (VISUAL_DESIGN.md §5).
 *
 * Paths are generated with sentinel colors and rendered with CSS classes, so
 * strokes follow `currentColor` and fills follow CSS variables. SVG
 * presentation attributes can't read `var()`, CSS properties can.
 */

const generator = rough.generator();

const STROKE = "S";
const FILL = "F";

/** Base options for the shell (§5.1). */
export const BASE_OPTIONS: Options = {
  roughness: 1,
  bowing: 1,
  strokeWidth: 1.5,
  hachureGap: 6,
  preserveVertices: false,
};

export type Point = readonly [number, number];

export type SketchShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "roundRect"; x: number; y: number; w: number; h: number; r: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "ellipse"; cx: number; cy: number; w: number; h: number }
  | { kind: "polygon"; points: readonly Point[] }
  | { kind: "curve"; points: readonly Point[] }
  | { kind: "linearPath"; points: readonly Point[] }
  | { kind: "arc"; cx: number; cy: number; w: number; h: number; start: number; stop: number }
  | { kind: "path"; d: string };

export type PathRole = "stroke" | "fill" | "hachure";

export interface SketchPath {
  d: string;
  role: PathRole;
  strokeWidth: number;
}

export interface SketchOptions {
  seed: number;
  roughness?: number;
  bowing?: number;
  strokeWidth?: number;
  /** "none" draws the outline only. */
  fillStyle?: "none" | "solid" | "hachure" | "cross-hatch" | "zigzag";
  hachureGap?: number;
  hachureAngle?: number;
  fillWeight?: number;
  /** false draws the fill only (e.g. sticky notes have no border). */
  stroke?: boolean;
  disableMultiStroke?: boolean;
}

const MAX_CACHE = 800;
const cache = new Map<string, SketchPath[]>();

function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h - rr}`,
    `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `L ${x + rr} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - rr}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    "Z",
  ].join(" ");
}

function toRoughOptions(o: SketchOptions): Options {
  const fillStyle = o.fillStyle ?? "none";
  return {
    ...BASE_OPTIONS,
    seed: o.seed,
    roughness: o.roughness ?? BASE_OPTIONS.roughness,
    bowing: o.bowing ?? BASE_OPTIONS.bowing,
    strokeWidth: o.strokeWidth ?? BASE_OPTIONS.strokeWidth,
    hachureGap: o.hachureGap ?? BASE_OPTIONS.hachureGap,
    ...(o.hachureAngle !== undefined ? { hachureAngle: o.hachureAngle } : {}),
    ...(o.fillWeight !== undefined ? { fillWeight: o.fillWeight } : {}),
    ...(o.disableMultiStroke !== undefined ? { disableMultiStroke: o.disableMultiStroke } : {}),
    stroke: o.stroke === false ? "none" : STROKE,
    ...(fillStyle === "none" ? {} : { fill: FILL, fillStyle }),
  };
}

function draw(shape: SketchShape, opts: Options) {
  const pts = (p: readonly Point[]) => p.map(([x, y]) => [x, y] as [number, number]);
  switch (shape.kind) {
    case "rect":
      return generator.rectangle(shape.x, shape.y, shape.w, shape.h, opts);
    case "roundRect":
      return generator.path(roundRectPath(shape.x, shape.y, shape.w, shape.h, shape.r), opts);
    case "line":
      return generator.line(shape.x1, shape.y1, shape.x2, shape.y2, opts);
    case "ellipse":
      return generator.ellipse(shape.cx, shape.cy, shape.w, shape.h, opts);
    case "polygon":
      return generator.polygon(pts(shape.points), opts);
    case "curve":
      return generator.curve(pts(shape.points), opts);
    case "linearPath":
      return generator.linearPath(pts(shape.points), opts);
    case "arc":
      return generator.arc(shape.cx, shape.cy, shape.w, shape.h, shape.start, shape.stop, false, opts);
    case "path":
      return generator.path(shape.d, opts);
  }
}

/**
 * Generate (memoized) the SVG paths for a shape. The cache key covers the
 * geometry, seed and options, so redraws only happen when size changes.
 */
export function roughPaths(shape: SketchShape, options: SketchOptions): SketchPath[] {
  const key = JSON.stringify([shape, options]);
  const hit = cache.get(key);
  if (hit) return hit;

  const drawable = draw(shape, toRoughOptions(options));
  const paths: SketchPath[] = [];
  for (const p of generator.toPaths(drawable)) {
    if (p.fill === FILL) paths.push({ d: p.d, role: "fill", strokeWidth: 0 });
    else if (p.stroke === FILL) paths.push({ d: p.d, role: "hachure", strokeWidth: p.strokeWidth });
    else if (p.stroke === STROKE) paths.push({ d: p.d, role: "stroke", strokeWidth: p.strokeWidth });
  }

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, paths);
  return paths;
}
