import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export type SketchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: ReactNode;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  seedKey?: string;
  className?: string;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Text input with a sketchy underline only (VISUAL_DESIGN.md §5.3). */
export function SketchInput({
  label,
  hideLabel,
  hint,
  error,
  seedKey,
  className,
  inputClassName,
  id,
  ref,
  ...rest
}: SketchInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId, rest["aria-describedby"]].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ud-field", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={hideLabel ? "ud-visually-hidden" : "ud-field__label"}>
        {label}
      </label>
      <div className="ud-input ud-sketch" data-invalid={error ? "" : undefined}>
        <SketchArt seed={hashSeed(seedKey ?? `input:${inputId}`)} shape="underline" fillStyle="none" />
        <input
          ref={ref}
          id={inputId}
          className={["ud-input__control", inputClassName ?? ""].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      </div>
      {hint ? (
        <p id={hintId} className="ud-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ud-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
