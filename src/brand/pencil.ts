/**
 * Geometry of the Uncle Draw mark: a slanted pencil doodle with a hexagonal
 * body, cone tip and eraser cap (VISUAL_DESIGN.md §2). Shared by <PencilMark>
 * and scripts/render-icons.ts (favicon set), so it has no imports.
 */

export type PencilTone = "ink" | "primary" | "highlight";

export interface PencilPart {
  points: ReadonlyArray<readonly [number, number]>;
  closed: boolean;
  tone: PencilTone;
  fillTone?: PencilTone;
  fillStyle?: "solid" | "hachure";
}

/** Drawn horizontally in a 64×64 box, then rotated by PENCIL_ROTATION. */
export const PENCIL_PARTS: readonly PencilPart[] = [
  // eraser cap
  {
    points: [
      [6, 26],
      [14, 26],
      [14, 38],
      [6, 38],
    ],
    closed: true,
    tone: "ink",
    fillTone: "primary",
    fillStyle: "hachure",
  },
  // ferrule
  {
    points: [
      [14, 25],
      [19, 25],
      [19, 39],
      [14, 39],
    ],
    closed: true,
    tone: "ink",
  },
  // hexagonal body (two facet lines suggest the hexagon)
  {
    points: [
      [19, 26],
      [44, 26],
      [44, 38],
      [19, 38],
    ],
    closed: true,
    tone: "ink",
    fillTone: "highlight",
    fillStyle: "hachure",
  },
  {
    points: [
      [19, 30],
      [44, 30],
    ],
    closed: false,
    tone: "ink",
  },
  {
    points: [
      [19, 34],
      [44, 34],
    ],
    closed: false,
    tone: "ink",
  },
  // cone tip
  {
    points: [
      [44, 26],
      [57, 32],
      [44, 38],
    ],
    closed: true,
    tone: "ink",
  },
  // graphite point
  {
    points: [
      [53, 30],
      [57, 32],
      [53, 34],
    ],
    closed: true,
    tone: "ink",
    fillTone: "ink",
    fillStyle: "solid",
  },
];

export const PENCIL_ROTATION = -38;
export const PENCIL_SEED = 1971;
