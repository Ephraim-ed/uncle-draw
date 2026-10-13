import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { roughPaths, type SketchOptions, type SketchPath, type SketchShape } from "./roughPaths";
import { boilSeeds } from "./seed";
import { useElementSize } from "./useElementSize";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** Overlay padding: the SVG sits at `inset: -2px` so wobbly lines aren't clipped. */
const PAD = 2;
const FOCUS_GAP = 4;

export type ArtShape = "rect" | "roundRect" | "underline" | "circle";

export interface SketchArtProps {
  seed: number;
  shape?: ArtShape;
  radius?: number;
  roughness?: number;
  bowing?: number;
  strokeWidth?: number;
  fillStyle?: SketchOptions["fillStyle"];
  /** false: fill only, no outline. */
  stroke?: boolean;
  /** "Paper cut" shadow: same seed, solid --ud-shadow, offset by CSS var --ud-so. */
  shadow?: boolean;
  /** A rough outline 4 px outside the shape, shown on :focus-visible of the host. */
  focusRing?: boolean;
  /** Cycle 3 fixed seeds every 125 ms (loading states only, §8). */
  boil?: boolean;
  className?: string;
}

function geometry(shape: ArtShape, w: number, h: number, radius: number, inflate = 0): SketchShape {
  const x = PAD - inflate;
  const y = PAD - inflate;
  const ww = w + inflate * 2;
  const hh = h + inflate * 2;
  switch (shape) {
    case "rect":
      return { kind: "rect", x, y, w: ww, h: hh };
    case "roundRect":
      return { kind: "roundRect", x, y, w: ww, h: hh, r: radius + inflate };
    case "underline":
      return { kind: "line", x1: PAD, y1: PAD + h - 1, x2: PAD + w, y2: PAD + h - 1 };
    case "circle":
      return { kind: "ellipse", cx: PAD + w / 2, cy: PAD + h / 2, w: ww - 2, h: hh - 2 };
  }
}

function Paths({ paths, prefix }: { paths: SketchPath[]; prefix: string }) {
  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} className={`${prefix}${p.role}`} strokeWidth={p.strokeWidth || undefined} />
      ))}
    </>
  );
}

/**
 * Decorative Rough.js overlay for a shell component (§5.1). It measures its
 * parent (which must be `position: relative`, e.g. via `.ud-sketch`) and draws
 * behind the content. Strokes use `currentColor`; fills read `--ud-sketch-fill`.
 */
export function SketchArt({
  seed,
  shape = "rect",
  radius = 10,
  roughness,
  bowing,
  strokeWidth,
  fillStyle = "solid",
  stroke = true,
  shadow = false,
  focusRing = false,
  boil = false,
  className,
}: SketchArtProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<Element | null>(null);
  const [hostReady, setHostReady] = useState(false);

  // Must run before useElementSize's layout effect so the host is known.
  useLayoutEffect(() => {
    hostRef.current = svgRef.current?.parentElement ?? null;
    setHostReady(!!hostRef.current);
  }, []);
  const size = useElementSize(hostRef, hostReady);

  const reducedMotion = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const boiling = boil && !reducedMotion;
  useEffect(() => {
    if (!boiling) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % 3), 125);
    return () => window.clearInterval(id);
  }, [boiling]);

  const activeSeed = boiling ? boilSeeds(seed)[frame]! : seed;
  const w = size?.width ?? 0;
  const h = size?.height ?? 0;
  const ready = w > 0 && h > 0;

  const opts: SketchOptions = {
    seed: activeSeed,
    ...(roughness !== undefined ? { roughness } : {}),
    ...(bowing !== undefined ? { bowing } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    fillStyle: shape === "underline" ? "none" : fillStyle,
    stroke,
  };

  const main = ready ? roughPaths(geometry(shape, w, h, radius), opts) : [];
  const shadowPaths =
    ready && shadow ? roughPaths(geometry(shape, w, h, radius), { ...opts, fillStyle: "solid" }) : [];
  const focusPaths =
    ready && focusRing
      ? roughPaths(geometry(shape === "underline" ? "rect" : shape, w, h, radius, FOCUS_GAP), {
          seed: activeSeed + 1,
          fillStyle: "none",
          strokeWidth: 1.5,
        })
      : [];

  return (
    <svg
      ref={svgRef}
      className={className ? `ud-sketch__art ${className}` : "ud-sketch__art"}
      aria-hidden="true"
      focusable="false"
      width={w + PAD * 2}
      height={h + PAD * 2}
    >
      {shadowPaths.length > 0 && (
        <g className="ud-sketch__shadow">
          <Paths paths={shadowPaths} prefix="ud-sketch__shadow-" />
        </g>
      )}
      <g className="ud-sketch__main">
        <Paths paths={main} prefix="ud-sketch__" />
      </g>
      {focusPaths.length > 0 && (
        <g className="ud-sketch__focus">
          <Paths paths={focusPaths} prefix="ud-sketch__" />
        </g>
      )}
    </svg>
  );
}
