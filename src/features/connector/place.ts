import {
  convertToExcalidrawElements,
  getCommonBounds,
  newElementWith,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";
import { HAND_DRAWN_DEFAULTS } from "../editor/constants";
import {
  buildTemplate,
  templateBounds,
  type Template,
  type TemplateStyle,
} from "../editor/templates/templates";
import { markForMeasure } from "./marks";

/**
 * Putting what Claude makes on the board (AI-2): in free space to the right
 * of everything, or inside a named area (a frame), growing it to fit.
 */

/** The look of everything Claude draws: the board defaults, filled solid so it reads at a glance. */
export const DEFAULT_STYLE: TemplateStyle = {
  strokeColor: HAND_DRAWN_DEFAULTS.currentItemStrokeColor,
  strokeWidth: HAND_DRAWN_DEFAULTS.currentItemStrokeWidth,
  roughness: HAND_DRAWN_DEFAULTS.currentItemRoughness,
  fillStyle: "solid",
  fontFamily: HAND_DRAWN_DEFAULTS.currentItemFontFamily,
  paper: "#ffffff",
};

/** A change to a board: the whole next scene, and the elements to save and send live. */
export interface Change {
  elements: ExcalidrawElement[];
  changed: ExcalidrawElement[];
  createdIds: string[];
}

/** Space around content inside a frame. */
export const FRAME_PAD = 40;
/** Space between things stacked in a frame. */
export const STACK_GAP = 48;
const FREE_GAP = 120;

const live = (elements: readonly ExcalidrawElement[]) => elements.filter((el) => !el.isDeleted);

/** Top-left corner for new content: right of everything, top-aligned with it. */
export function freeSpot(
  elements: readonly ExcalidrawElement[],
  _size: { width: number; height: number },
  gap = FREE_GAP,
): { x: number; y: number } {
  const present = live(elements);
  if (present.length === 0) return { x: 0, y: 0 };
  const [, y1, x2] = getCommonBounds(present);
  return { x: Math.round(x2 + gap), y: Math.round(y1) };
}

/** The live frame named `name`, if any. */
export function frameNamed(
  elements: readonly ExcalidrawElement[],
  name: string,
): ExcalidrawFrameElement | null {
  return (
    (live(elements).find((el) => el.type === "frame" && el.name === name) as ExcalidrawFrameElement) ?? null
  );
}

/** A new frame at x, y. Children point at it themselves (frameId). */
export function newFrame(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ExcalidrawElement {
  const [frame] = convertToExcalidrawElements([{ type: "frame", children: [], name, x, y, width, height }]);
  // The converter pads a frame out from 0, 0 as if no position were given; set the box ourselves.
  return { ...frame!, x, y, width, height, index: null } as ExcalidrawElement;
}

/** Adds the scene's new and changed elements, with valid fractional indices and bindings. */
export function finish(
  elements: readonly ExcalidrawElement[],
  updated: readonly ExcalidrawElement[],
  created: readonly ExcalidrawElement[],
): Change {
  const byId = new Map(updated.map((el) => [el.id, el]));
  const next = restoreElements([...elements.map((el) => byId.get(el.id) ?? el), ...created], null, {
    repairBindings: true,
  });
  const ids = new Set([...byId.keys(), ...created.map((el) => el.id)]);
  return {
    elements: next,
    changed: next.filter((el) => ids.has(el.id)),
    createdIds: created.map((el) => el.id),
  };
}

/** Builds `t` on the board: in free space, or inside the area named `opts.area`. */
export function addTemplate(
  elements: readonly ExcalidrawElement[],
  t: Template,
  opts: { area?: string } = {},
): Change {
  const b = templateBounds(t);
  const size = { width: b.width, height: b.height };
  if (!opts.area)
    return finish(elements, [], markForMeasure(buildTemplate(t, freeSpot(elements, size), DEFAULT_STYLE)));

  const frame = frameNamed(elements, opts.area);
  if (!frame) {
    const spot = freeSpot(elements, size);
    const built = buildTemplate(t, { x: spot.x + FRAME_PAD, y: spot.y + FRAME_PAD }, DEFAULT_STYLE);
    const box = newFrame(opts.area, spot.x, spot.y, b.width + 2 * FRAME_PAD, b.height + 2 * FRAME_PAD);
    return finish(elements, [], [...markForMeasure(built).map((el) => ({ ...el, frameId: box.id })), box]);
  }

  const inside = live(elements).filter((el) => el.frameId === frame.id);
  const top = inside.length > 0 ? getCommonBounds(inside)[3] + STACK_GAP : frame.y + FRAME_PAD;
  const at = { x: frame.x + FRAME_PAD, y: Math.round(top) };
  const built = markForMeasure(buildTemplate(t, at, DEFAULT_STYLE)).map((el) => ({
    ...el,
    frameId: frame.id,
  }));
  const grown = newElementWith(frame, {
    width: Math.max(frame.width, at.x + b.width + FRAME_PAD - frame.x),
    height: Math.max(frame.height, at.y + b.height + FRAME_PAD - frame.y),
  });
  return finish(elements, [grown], built);
}
