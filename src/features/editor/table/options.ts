import type { AppState } from "@excalidraw/excalidraw/types";
import { DEFAULT_HEADER_FILL, type Align, type TableLook, type TableOptions } from "./grid";

/** A fill that follows the canvas color, so cells look see-through but still catch clicks. */
export const PAPER = "paper";

/** The style picked in the dialog; PAPER is resolved when the table is made. */
export interface LookChoice {
  headerFill: string;
  cellFill: string;
  border: string;
  borderWidth: number;
  align: Align;
}

export interface TableSetup extends TableOptions {
  look: LookChoice;
}

export const TABLE_LIMITS = { rows: { min: 1, max: 30 }, cols: { min: 1, max: 12 } } as const;

export const DEFAULT_SETUP: TableSetup = {
  rows: 3,
  cols: 2,
  header: true,
  checkboxes: true,
  look: {
    headerFill: DEFAULT_HEADER_FILL,
    cellFill: PAPER,
    border: "#1e1e1e",
    borderWidth: 1,
    align: "center",
  },
};

/** Excalidraw's quick-pick colors (VISUAL_DESIGN.md §7: we don't change its palette). */
export const FILL_COLORS = [PAPER, DEFAULT_HEADER_FILL, "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"] as const;
export const BORDER_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"] as const;
export const BORDER_WIDTHS = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Bold" },
  { value: 4, label: "Extra bold" },
] as const;

const COLOR_NAMES: Record<string, string> = {
  [PAPER]: "Canvas color",
  [DEFAULT_HEADER_FILL]: "Light gray",
  "#ffc9c9": "Light red",
  "#b2f2bb": "Light green",
  "#a5d8ff": "Light blue",
  "#ffec99": "Light yellow",
  "#1e1e1e": "Black",
  "#e03131": "Red",
  "#2f9e44": "Green",
  "#1971c2": "Blue",
  "#f08c00": "Orange",
};
export const colorName = (color: string) => COLOR_NAMES[color.toLowerCase()] ?? color;

const HEX = /^#[0-9a-f]{6}$/i;
const isColor = (v: unknown, paperOk: boolean): v is string =>
  typeof v === "string" && (HEX.test(v) || (paperOk && v === PAPER));

const OPTIONS_KEY = "ud:table-options";

/** Last-used setup on this device, like the drawing style (EDIT-5). */
export function loadSetup(): TableSetup {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<TableSetup> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_SETUP;
    const inRange = (v: unknown, { min, max }: { min: number; max: number }): v is number =>
      Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    const look: Partial<LookChoice> = typeof saved.look === "object" && saved.look ? saved.look : {};
    const d = DEFAULT_SETUP;
    return {
      rows: inRange(saved.rows, TABLE_LIMITS.rows) ? saved.rows : d.rows,
      cols: inRange(saved.cols, TABLE_LIMITS.cols) ? saved.cols : d.cols,
      header: typeof saved.header === "boolean" ? saved.header : d.header,
      checkboxes: typeof saved.checkboxes === "boolean" ? saved.checkboxes : d.checkboxes,
      look: {
        headerFill: isColor(look.headerFill, true) ? look.headerFill : d.look.headerFill,
        cellFill: isColor(look.cellFill, true) ? look.cellFill : d.look.cellFill,
        border: isColor(look.border, false) ? look.border : d.look.border,
        borderWidth: BORDER_WIDTHS.some((w) => w.value === look.borderWidth)
          ? look.borderWidth!
          : d.look.borderWidth,
        align:
          look.align === "left" || look.align === "right" || look.align === "center"
            ? look.align
            : d.look.align,
      },
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function saveSetup(setup: TableSetup) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(setup));
  } catch {
    // ignore
  }
}

/** The canvas color, or white when the canvas is see-through. */
export function paperColor(appState: Pick<AppState, "viewBackgroundColor">): string {
  const bg = appState.viewBackgroundColor;
  return !bg || bg === "transparent" ? "#ffffff" : bg;
}

export function resolveLook(
  choice: LookChoice,
  appState: Pick<AppState, "viewBackgroundColor" | "currentItemRoughness">,
): TableLook {
  const paper = paperColor(appState);
  return {
    ...choice,
    headerFill: choice.headerFill === PAPER ? paper : choice.headerFill,
    cellFill: choice.cellFill === PAPER ? paper : choice.cellFill,
    roughness: appState.currentItemRoughness,
  };
}
