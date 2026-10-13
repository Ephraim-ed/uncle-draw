import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-text";
export type ButtonSize = "md" | "sm";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stable key for the wobble. Defaults to the variant plus the label text. */
  seedKey?: string;
  icon?: ReactNode;
  /** Excalifont label (20 px), e.g. the "New board" CTA (§6.2). */
  hand?: boolean;
  children?: ReactNode;
  className?: string;
}

function classes({ variant = "secondary", size = "md", hand, className }: CommonProps) {
  return [
    "ud-btn",
    "ud-sketch",
    `ud-btn--${variant}`,
    size === "sm" ? "ud-btn--sm" : "",
    hand ? "ud-btn--hand" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function seedFor(p: CommonProps) {
  const label = typeof p.children === "string" ? p.children : "";
  return hashSeed(p.seedKey ?? `${p.variant ?? "secondary"}:${label}`);
}

function Art(p: CommonProps) {
  if (p.variant === "danger-text") return null;
  return (
    <SketchArt
      seed={seedFor(p)}
      shape="rect"
      strokeWidth={p.variant === "primary" || p.variant === "danger" ? 2 : 1.5}
      fillStyle="solid"
      shadow
      focusRing
    />
  );
}

function Content({ icon, children }: CommonProps) {
  return (
    <>
      {icon ? (
        <span className="ud-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children !== undefined ? <span className="ud-btn__label">{children}</span> : null}
    </>
  );
}

export type SketchButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
    ref?: Ref<HTMLButtonElement>;
  };

/** Primary / secondary / danger-text button (VISUAL_DESIGN.md §5.3). */
export function SketchButton({
  variant,
  size,
  seedKey,
  icon,
  hand,
  children,
  className,
  type = "button",
  ref,
  ...rest
}: SketchButtonProps) {
  const common = { variant, size, seedKey, icon, hand, children, className };
  return (
    <button ref={ref} type={type} className={classes(common)} {...rest}>
      <Art {...common} />
      <Content {...common} />
    </button>
  );
}

export type SketchLinkButtonProps = CommonProps & Omit<LinkProps, "children" | "className">;

/** A router link styled as a sketch button. */
export function SketchLinkButton({
  variant,
  size,
  seedKey,
  icon,
  hand,
  children,
  className,
  ...rest
}: SketchLinkButtonProps) {
  const common = { variant, size, seedKey, icon, hand, children, className };
  return (
    <Link className={classes(common)} {...rest}>
      <Art {...common} />
      <Content {...common} />
    </Link>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** Required: icon buttons always need an accessible name (§10). */
  label: string;
  seedKey?: string;
  ref?: Ref<HTMLButtonElement>;
};

/** Ghost / icon button: no border, 40×40 hit area, rough circle on hover. */
export function IconButton({
  label,
  seedKey,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={["ud-iconbtn", "ud-sketch", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <SketchArt
        seed={hashSeed(seedKey ?? `icon:${label}`)}
        shape="circle"
        fillStyle="solid"
        stroke={false}
      />
      <span className="ud-iconbtn__icon" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
