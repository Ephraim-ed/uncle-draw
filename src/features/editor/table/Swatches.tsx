import { useId, type ReactNode } from "react";
import { PAPER, colorName } from "./options";

/**
 * A row of color chips (native radios, so arrow keys work) plus a custom
 * color picker. `paper` is what the PAPER chip shows: the canvas color.
 */
export function Swatches({
  label,
  value,
  colors,
  paper,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  colors: readonly string[];
  paper: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const picked = (color: string) =>
    color === value ||
    (color === PAPER && value.toLowerCase() === paper.toLowerCase() && !colors.includes(value));
  const custom = !colors.some(picked);
  return (
    <fieldset className="ud-swatches" disabled={disabled}>
      <legend className="ud-swatches__label">{label}</legend>
      <div className="ud-swatches__chips">
        {colors.map((color) => (
          <label key={color} className="ud-swatch" title={colorName(color)}>
            <input
              type="radio"
              name={name}
              className="ud-visually-hidden"
              checked={picked(color)}
              onChange={() => onChange(color)}
            />
            <span
              className="ud-swatch__chip"
              data-paper={color === PAPER ? "" : undefined}
              style={{ background: color === PAPER ? paper : color }}
            />
            <span className="ud-visually-hidden">{colorName(color)}</span>
          </label>
        ))}
        <label className="ud-swatch ud-swatch--custom" title="Custom color">
          <input
            type="color"
            className="ud-swatch__picker"
            value={custom && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
            data-picked={custom ? "" : undefined}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`Custom ${label.toLowerCase()}`}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** A small set of mutually exclusive icon or text options. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="ud-segmented">
      <legend className="ud-swatches__label">{label}</legend>
      <div className="ud-segmented__options">
        {options.map((o) => (
          <label key={String(o.value)} className="ud-segmented__option" title={o.label}>
            <input
              type="radio"
              name={name}
              className="ud-visually-hidden"
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            <span className="ud-segmented__face">
              {o.icon ?? o.label}
              {o.icon ? <span className="ud-visually-hidden">{o.label}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
