import { CaptureUpdateAction, FONT_FAMILY, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { tablePart } from "../editor/table/table";
import { MEASURE_KEY } from "./marks";

/**
 * Real sizes for text Claude made (AI-6). The server guesses text sizes; the
 * editor measures them with the real fonts, puts labels back in the middle of
 * their shapes, and clears the tag. The result saves like any edit.
 */

type El = ExcalidrawElement;

/** Excalidraw's padding between a shape and its label. */
const LABEL_PAD = 5;

const tagged = (el: El) => !el.isDeleted && el.customData?.[MEASURE_KEY] === true;
const isLine = (el: El | undefined) => el?.type === "arrow" || el?.type === "line";

export function hasMeasureTag(elements: readonly El[]): boolean {
  return elements.some(tagged);
}

function untagged(el: El): El["customData"] {
  const rest: Record<string, unknown> = { ...el.customData };
  delete rest[MEASURE_KEY];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Where a label goes in its shape, by its alignment. */
function labelPosition(
  text: ExcalidrawTextElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const x =
    text.textAlign === "left"
      ? box.x + LABEL_PAD
      : text.textAlign === "right"
        ? box.x + box.width - LABEL_PAD - text.width
        : box.x + (box.width - text.width) / 2;
  const y =
    text.verticalAlign === "top"
      ? box.y + LABEL_PAD
      : text.verticalAlign === "bottom"
        ? box.y + box.height - LABEL_PAD - text.height
        : box.y + (box.height - text.height) / 2;
  return { x, y };
}

/** The tagged elements measured for real and untagged, or null if none are tagged. */
export function remeasure(elements: readonly El[]): El[] | null {
  const marked = elements.filter(tagged);
  if (marked.length === 0) return null;
  const byId = new Map(elements.map((el) => [el.id, el]));
  const texts = new Set(marked.filter((el) => el.type === "text").map((el) => el.id));

  // Measured as a whole scene so every binding is there; wrapping starts from what was typed.
  const input = elements.map((el) =>
    texts.has(el.id) && el.type === "text" ? { ...el, text: el.originalText } : el,
  );
  const measured = new Map(
    restoreElements(input, null, { refreshDimensions: true, repairBindings: true }).map((el) => [el.id, el]),
  );

  // A label that no longer fits makes its shape taller (not table cells: their row decides,
  // and never an arrow, whose size is its points).
  const height = new Map<string, number>();
  for (const id of texts) {
    const text = measured.get(id) as ExcalidrawTextElement | undefined;
    const box = text?.containerId ? byId.get(text.containerId) : undefined;
    if (!text || !box || tablePart(box) || isLine(box)) continue;
    const needed = text.height + 2 * LABEL_PAD;
    if (needed > box.height) height.set(box.id, Math.ceil(needed));
  }

  const out: El[] = [];
  for (const el of marked) {
    if (el.type !== "text") {
      out.push(
        newElementWith(el, {
          customData: untagged(el),
          ...(height.has(el.id) ? { height: height.get(el.id) } : {}),
        }),
      );
      continue;
    }
    const text = measured.get(el.id) as ExcalidrawTextElement;
    const box = el.containerId ? byId.get(el.containerId) : undefined;
    const size = { text: text.text, width: text.width, height: text.height, lineHeight: text.lineHeight };
    // An arrow's label sits where Excalidraw put it on the path: keep its centre.
    const position = isLine(box)
      ? { x: el.x + (el.width - size.width) / 2, y: el.y + (el.height - size.height) / 2 }
      : box
        ? labelPosition({ ...el, ...size } as ExcalidrawTextElement, {
            x: box.x,
            y: box.y,
            width: box.width,
            height: height.get(box.id) ?? box.height,
          })
        : { x: text.x, y: text.y };
    out.push(newElementWith(el, { ...size, ...position, customData: untagged(el) }));
  }
  // A shape that grew but wasn't tagged itself still has to change.
  for (const [id, h] of height) {
    if (!out.some((el) => el.id === id)) out.push(newElementWith(byId.get(id)!, { height: h }));
  }
  return out;
}

const FAMILY_NAME = Object.fromEntries(Object.entries(FONT_FAMILY).map(([name, id]) => [id, name]));

/** Loads the fonts the tagged text uses, so measuring isn't done with a fallback font. */
async function loadFonts(elements: readonly El[]) {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return;
  const wanted = new Set(
    elements.flatMap((el) =>
      el.type === "text" && tagged(el)
        ? [`${el.fontSize}px "${FAMILY_NAME[el.fontFamily] ?? "Excalifont"}"`]
        : [],
    ),
  );
  await Promise.all([...wanted].map((font) => fonts.load(font).catch(() => [])));
}

/** Re-measures the scene's tagged elements once their fonts are in, without an undo step. */
export async function remeasureScene(
  api: Pick<ExcalidrawImperativeAPI, "getSceneElementsIncludingDeleted" | "updateScene">,
): Promise<void> {
  if (!hasMeasureTag(api.getSceneElementsIncludingDeleted())) return;
  await loadFonts(api.getSceneElementsIncludingDeleted());
  const current = api.getSceneElementsIncludingDeleted();
  const fixed = remeasure(current);
  if (!fixed) return;
  const byId = new Map(fixed.map((el) => [el.id, el]));
  api.updateScene({
    elements: current.map((el) => byId.get(el.id) ?? el),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
