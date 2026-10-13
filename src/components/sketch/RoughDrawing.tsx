import { useEffect, useState, type ReactNode } from "react";
import { roughPaths, type SketchOptions, type SketchShape } from "./roughPaths";
import { boilSeeds } from "./seed";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** Palette roles. Colors resolve through tokens so drawings adapt to dark mode. */
export type Tone = "ink" | "muted" | "faint" | "primary" | "highlight" | "danger" | "warning" | "paper";

const TONE_VAR: Record<Tone, string> = {
  ink: "var(--ud-ink)",
  muted: "var(--ud-ink-muted)",
  faint: "var(--ud-ink-faint)",
  primary: "var(--ud-primary)",
  highlight: "var(--ud-highlight)",
  danger: "var(--ud-danger)",
  warning: "var(--ud-warning)",
  paper: "var(--ud-surface)",
};

export interface DrawingItem {
  shape: SketchShape;
  tone?: Tone;
  fillTone?: Tone;
  fillStyle?: SketchOptions["fillStyle"];
  strokeWidth?: number;
  roughness?: number;
  bowing?: number;
  hachureGap?: number;
  hachureAngle?: number;
  stroke?: boolean;
}

export interface DrawingText {
  x: number;
  y: number;
  text: string;
  size?: number;
  tone?: Tone;
  anchor?: "start" | "middle" | "end";
  rotate?: number;
}

export interface RoughDrawingProps {
  width: number;
  height: number;
  items: readonly DrawingItem[];
  texts?: readonly DrawingText[];
  /** Base seed; item i uses seed + i, so every drawing is stable. */
  seed: number;
  /** Accessible name. Without one the drawing is decorative (aria-hidden). */
  title?: string;
  boil?: boolean;
  /** SVG transform applied to all items, e.g. "rotate(-38 32 32)". */
  transform?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Renders a static Rough.js drawing (illustrations, marks, doodles; §9.3).
 * Strokes are `currentColor`-style tokens, transparent background, roughness 1.
 */
export function RoughDrawing({
  width,
  height,
  items,
  texts = [],
  seed,
  title,
  boil = false,
  transform,
  className,
  children,
}: RoughDrawingProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const boiling = boil && !reducedMotion;
  useEffect(() => {
    if (!boiling) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % 3), 125);
    return () => window.clearInterval(id);
  }, [boiling]);

  const base = boiling ? boilSeeds(seed)[frame]! : seed;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ overflow: "visible", maxWidth: "100%", height: "auto" }}
    >
      <g transform={transform}>
        {items.map((item, i) => {
          const paths = roughPaths(item.shape, {
            seed: base + i * 31,
            fillStyle: item.fillStyle ?? (item.fillTone ? "hachure" : "none"),
            ...(item.strokeWidth !== undefined ? { strokeWidth: item.strokeWidth } : { strokeWidth: 2 }),
            ...(item.roughness !== undefined ? { roughness: item.roughness } : {}),
            ...(item.bowing !== undefined ? { bowing: item.bowing } : {}),
            ...(item.hachureGap !== undefined ? { hachureGap: item.hachureGap } : {}),
            ...(item.hachureAngle !== undefined ? { hachureAngle: item.hachureAngle } : {}),
            ...(item.stroke !== undefined ? { stroke: item.stroke } : {}),
          });
          const stroke = TONE_VAR[item.tone ?? "ink"];
          const fill = TONE_VAR[item.fillTone ?? "ink"];
          return (
            <g key={i}>
              {paths.map((p, j) => (
                <path
                  key={j}
                  d={p.d}
                  strokeWidth={p.strokeWidth || undefined}
                  strokeLinecap="round"
                  style={
                    p.role === "fill"
                      ? { fill, stroke: "none" }
                      : p.role === "hachure"
                        ? { fill: "none", stroke: fill }
                        : { fill: "none", stroke }
                  }
                />
              ))}
            </g>
          );
        })}
        {texts.map((t, i) => (
          <text
            key={`t${i}`}
            x={t.x}
            y={t.y}
            textAnchor={t.anchor ?? "middle"}
            transform={t.rotate ? `rotate(${t.rotate} ${t.x} ${t.y})` : undefined}
            style={{
              fontFamily: "var(--ud-font-hand)",
              fontSize: t.size ?? 20,
              fill: TONE_VAR[t.tone ?? "ink"],
            }}
          >
            {t.text}
          </text>
        ))}
      </g>
      {children}
    </svg>
  );
}
