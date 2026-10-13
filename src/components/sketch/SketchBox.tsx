import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { SketchArt } from "./SketchArt";

export type SketchBoxProps = HTMLAttributes<HTMLDivElement> & {
  seed: number;
  /** Paper-cut shadow offset in px (0 = none). */
  shadow?: number;
  fill?: "surface" | "sunken" | "highlight" | "none";
  boil?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

const FILL_VAR = {
  surface: "var(--ud-surface)",
  sunken: "var(--ud-surface-sunken)",
  highlight: "var(--ud-highlight)",
  none: "transparent",
} as const;

/** A sheet of paper with a hand-drawn border (cards, panels, the login card). */
export function SketchBox({
  seed,
  shadow = 3,
  fill = "surface",
  boil,
  className,
  style,
  children,
  ref,
  ...rest
}: SketchBoxProps) {
  return (
    <div
      ref={ref}
      className={["ud-box", "ud-sketch", className ?? ""].filter(Boolean).join(" ")}
      style={
        {
          "--ud-sketch-fill": FILL_VAR[fill],
          "--ud-so": `${shadow}px`,
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      <SketchArt
        seed={seed}
        shape="rect"
        fillStyle={fill === "none" ? "none" : "solid"}
        shadow={shadow > 0}
        boil={boil}
      />
      {children}
    </div>
  );
}
