/**
 * Illustrations (VISUAL_DESIGN.md §9.3), drawn as deterministic Rough.js
 * doodles: ink strokes (token-driven, so they adapt to dark mode), at most two
 * accent colors, transparent background, roughness 1, Excalifont labels.
 *
 * They stand in for the versions to be drawn in Uncle Draw itself and
 * exported as SVG; swapping one in only changes the file it comes from.
 */
import { RoughDrawing, type DrawingItem, type DrawingText } from "../../components/sketch/RoughDrawing";

interface IllustrationProps {
  className?: string;
  width?: number;
}

function make(
  name: string,
  viewW: number,
  viewH: number,
  seed: number,
  items: DrawingItem[],
  texts: DrawingText[] = [],
) {
  function Illustration({ className, width = viewW }: IllustrationProps) {
    return (
      <span className={className} style={{ display: "inline-block", width, maxWidth: "100%" }}>
        <RoughDrawing width={viewW} height={viewH} items={items} texts={texts} seed={seed} />
      </span>
    );
  }
  Illustration.displayName = name;
  return Illustration;
}

/** Login: a stick figure handing over a pencil. */
export const PencilHandoffDoodle = make(
  "PencilHandoffDoodle",
  240,
  130,
  101,
  [
    { shape: { kind: "ellipse", cx: 60, cy: 30, w: 28, h: 28 } },
    {
      shape: { kind: "arc", cx: 60, cy: 32, w: 14, h: 10, start: 0.3, stop: Math.PI - 0.3 },
      strokeWidth: 1.5,
    },
    { shape: { kind: "line", x1: 60, y1: 44, x2: 60, y2: 86 } },
    { shape: { kind: "line", x1: 60, y1: 86, x2: 46, y2: 120 } },
    { shape: { kind: "line", x1: 60, y1: 86, x2: 74, y2: 120 } },
    { shape: { kind: "line", x1: 60, y1: 58, x2: 42, y2: 76 } },
    {
      shape: {
        kind: "linearPath",
        points: [
          [60, 58],
          [82, 60],
          [100, 54],
        ],
      },
    },
    {
      shape: {
        kind: "polygon",
        points: [
          [100, 47],
          [132, 41],
          [134, 51],
          [102, 57],
        ],
      },
      fillTone: "highlight",
      hachureGap: 4,
      strokeWidth: 1.5,
    },
    {
      shape: {
        kind: "polygon",
        points: [
          [132, 41],
          [146, 44],
          [134, 51],
        ],
      },
      strokeWidth: 1.5,
    },
    {
      shape: {
        kind: "polygon",
        points: [
          [96, 48],
          [100, 47],
          [102, 57],
          [98, 58],
        ],
      },
      fillTone: "primary",
      hachureGap: 2,
      strokeWidth: 1.5,
    },
    { shape: { kind: "line", x1: 150, y1: 30, x2: 158, y2: 24 }, strokeWidth: 1.5, tone: "muted" },
    { shape: { kind: "line", x1: 152, y1: 44, x2: 162, y2: 44 }, strokeWidth: 1.5, tone: "muted" },
    { shape: { kind: "line", x1: 150, y1: 58, x2: 158, y2: 64 }, strokeWidth: 1.5, tone: "muted" },
  ],
  [{ x: 196, y: 50, text: "here!", size: 22, rotate: -6 }],
);

/** "Check your inbox": an envelope with motion lines. */
export const EnvelopeDoodle = make("EnvelopeDoodle", 170, 110, 202, [
  { shape: { kind: "rect", x: 40, y: 22, w: 108, h: 70 }, fillTone: "paper", fillStyle: "solid" },
  {
    shape: {
      kind: "linearPath",
      points: [
        [40, 22],
        [94, 62],
        [148, 22],
      ],
    },
  },
  {
    shape: {
      kind: "linearPath",
      points: [
        [40, 92],
        [82, 56],
      ],
    },
    strokeWidth: 1.5,
  },
  {
    shape: {
      kind: "linearPath",
      points: [
        [148, 92],
        [106, 56],
      ],
    },
    strokeWidth: 1.5,
  },
  {
    shape: { kind: "rect", x: 124, y: 30, w: 16, h: 16 },
    fillTone: "primary",
    hachureGap: 3,
    strokeWidth: 1.5,
  },
  { shape: { kind: "line", x1: 6, y1: 40, x2: 28, y2: 40 }, strokeWidth: 1.5, tone: "muted" },
  { shape: { kind: "line", x1: 2, y1: 56, x2: 30, y2: 56 }, strokeWidth: 1.5, tone: "muted" },
  { shape: { kind: "line", x1: 10, y1: 72, x2: 28, y2: 72 }, strokeWidth: 1.5, tone: "muted" },
]);

/** Empty dashboard: a blank sheet and a hand-drawn arrow pointing up-right. */
export const EmptyBoardsDoodle = make("EmptyBoardsDoodle", 240, 130, 303, [
  {
    shape: {
      kind: "polygon",
      points: [
        [30, 22],
        [96, 22],
        [114, 40],
        [114, 122],
        [30, 122],
      ],
    },
    fillTone: "paper",
    fillStyle: "solid",
  },
  {
    shape: {
      kind: "linearPath",
      points: [
        [96, 22],
        [96, 40],
        [114, 40],
      ],
    },
    strokeWidth: 1.5,
  },
  { shape: { kind: "line", x1: 44, y1: 60, x2: 98, y2: 60 }, strokeWidth: 1, tone: "faint" },
  { shape: { kind: "line", x1: 44, y1: 78, x2: 98, y2: 78 }, strokeWidth: 1, tone: "faint" },
  { shape: { kind: "line", x1: 44, y1: 96, x2: 80, y2: 96 }, strokeWidth: 1, tone: "faint" },
  {
    shape: {
      kind: "curve",
      points: [
        [132, 108],
        [168, 96],
        [196, 64],
        [214, 18],
      ],
    },
    tone: "primary",
  },
  {
    shape: {
      kind: "linearPath",
      points: [
        [200, 26],
        [214, 18],
        [220, 34],
      ],
    },
    tone: "primary",
  },
]);

/** 404: an eraser rubbing out a page. */
export const EraserDoodle = make("EraserDoodle", 240, 150, 404, [
  { shape: { kind: "rect", x: 40, y: 18, w: 112, h: 120 }, fillTone: "paper", fillStyle: "solid" },
  { shape: { kind: "line", x1: 56, y1: 44, x2: 136, y2: 44 }, tone: "muted", strokeWidth: 1.5 },
  { shape: { kind: "line", x1: 56, y1: 62, x2: 112, y2: 62 }, tone: "muted", strokeWidth: 1.5 },
  { shape: { kind: "line", x1: 56, y1: 80, x2: 92, y2: 80 }, tone: "muted", strokeWidth: 1.5 },
  {
    shape: {
      kind: "linearPath",
      points: [
        [64, 104],
        [80, 96],
        [76, 110],
        [94, 100],
        [90, 114],
      ],
    },
    tone: "faint",
  },
  {
    shape: {
      kind: "polygon",
      points: [
        [118, 82],
        [176, 50],
        [194, 76],
        [136, 108],
      ],
    },
    fillTone: "primary",
    hachureGap: 5,
  },
  { shape: { kind: "line", x1: 160, y1: 59, x2: 178, y2: 86 }, strokeWidth: 1.5 },
  {
    shape: { kind: "ellipse", cx: 110, cy: 122, w: 4, h: 4 },
    fillTone: "ink",
    fillStyle: "solid",
    strokeWidth: 1,
  },
  {
    shape: { kind: "ellipse", cx: 122, cy: 128, w: 3, h: 3 },
    fillTone: "ink",
    fillStyle: "solid",
    strokeWidth: 1,
  },
  {
    shape: { kind: "ellipse", cx: 102, cy: 132, w: 3, h: 3 },
    fillTone: "ink",
    fillStyle: "solid",
    strokeWidth: 1,
  },
]);

/** Revoked or expired share link: torn paper. */
export const TornPaperDoodle = make("TornPaperDoodle", 220, 140, 505, [
  {
    shape: {
      kind: "polygon",
      points: [
        [26, 24],
        [98, 20],
        [90, 42],
        [104, 62],
        [88, 82],
        [100, 102],
        [92, 124],
        [30, 126],
      ],
    },
    fillTone: "paper",
    fillStyle: "solid",
  },
  {
    shape: {
      kind: "polygon",
      points: [
        [114, 30],
        [190, 36],
        [184, 132],
        [108, 126],
        [118, 106],
        [104, 86],
        [120, 66],
        [106, 48],
      ],
    },
    fillTone: "paper",
    fillStyle: "solid",
  },
  { shape: { kind: "line", x1: 40, y1: 50, x2: 84, y2: 48 }, tone: "faint", strokeWidth: 1 },
  { shape: { kind: "line", x1: 40, y1: 70, x2: 80, y2: 69 }, tone: "faint", strokeWidth: 1 },
  { shape: { kind: "line", x1: 124, y1: 56, x2: 176, y2: 60 }, tone: "faint", strokeWidth: 1 },
  { shape: { kind: "line", x1: 128, y1: 76, x2: 172, y2: 80 }, tone: "faint", strokeWidth: 1 },
  { shape: { kind: "line", x1: 104, y1: 8, x2: 100, y2: 0 }, tone: "primary", strokeWidth: 1.5 },
  { shape: { kind: "line", x1: 112, y1: 10, x2: 118, y2: 2 }, tone: "primary", strokeWidth: 1.5 },
]);

/** Small offline indicator: a cloud with a slash. */
export const CloudOffDoodle = make("CloudOffDoodle", 48, 36, 606, [
  {
    shape: {
      kind: "path",
      d: "M12 28 Q3 28 4 20 Q5 13 13 14 Q15 6 25 6 Q34 7 35 15 Q44 15 44 22 Q44 28 37 28 Z",
    },
    strokeWidth: 1.5,
  },
  { shape: { kind: "line", x1: 8, y1: 34, x2: 40, y2: 2 }, tone: "warning", strokeWidth: 2 },
]);
