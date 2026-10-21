import { IconAlignCenter, IconAlignLeft, IconAlignRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { Align } from "./grid";
import { BORDER_WIDTHS } from "./options";

/** Options for the Segmented controls in the insert dialog and the table bar. */
export const ALIGN_OPTIONS: readonly { value: Align; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align left", icon: <IconAlignLeft size={18} stroke={1.75} /> },
  { value: "center", label: "Align center", icon: <IconAlignCenter size={18} stroke={1.75} /> },
  { value: "right", label: "Align right", icon: <IconAlignRight size={18} stroke={1.75} /> },
];

export const WIDTH_OPTIONS: readonly { value: number; label: string; icon: ReactNode }[] = BORDER_WIDTHS.map(
  (w) => ({
    value: w.value,
    label: w.label,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <line
          x1="3"
          y1="10"
          x2="17"
          y2="10"
          stroke="currentColor"
          strokeWidth={w.value + 0.5}
          strokeLinecap="round"
        />
      </svg>
    ),
  }),
);
