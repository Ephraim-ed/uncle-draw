import { roughPaths } from "../components/sketch/roughPaths";
import { PencilMark } from "./PencilMark";

const SQUIGGLE_POINTS: Array<readonly [number, number]> = [
  [2, 7],
  [26, 3],
  [52, 9],
  [78, 3],
  [104, 9],
  [130, 3],
  [156, 9],
  [182, 4],
  [198, 6],
];

/** Squiggle underline: primary color, roughness 1.5, bowing 2, stroke 2 (§2). */
function Squiggle() {
  const paths = roughPaths(
    { kind: "curve", points: SQUIGGLE_POINTS },
    { seed: 2024, roughness: 1.5, bowing: 2, strokeWidth: 2, fillStyle: "none" },
  );
  return (
    <svg
      className="ud-wordmark__squiggle"
      viewBox="0 0 200 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          style={{ fill: "none", stroke: "var(--ud-primary)", strokeWidth: p.strokeWidth }}
        />
      ))}
    </svg>
  );
}

export interface WordmarkProps {
  size?: "header" | "display";
  withMark?: boolean;
}

/** "Uncle Draw" in Excalifont with a rough squiggle underline. */
export function Wordmark({ size = "header", withMark = true }: WordmarkProps) {
  const display = size === "display";
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      {withMark ? <PencilMark size={display ? 44 : 28} /> : null}
      <span className="relative inline-block pb-2">
        <span
          className={display ? "font-hand text-display" : "font-hand"}
          style={display ? undefined : { fontSize: 24, lineHeight: "30px" }}
        >
          Uncle Draw
        </span>
        <Squiggle />
      </span>
    </span>
  );
}
