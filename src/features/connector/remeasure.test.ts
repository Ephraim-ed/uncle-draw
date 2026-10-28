import { CaptureUpdateAction, convertToExcalidrawElements, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { SceneData } from "@excalidraw/excalidraw/types";
import { describe, expect, test } from "vitest";
import { MEASURE_KEY } from "./marks";
import { hasMeasureTag, remeasure, remeasureScene } from "./remeasure";

type El = ExcalidrawElement;
const tag = (el: El): El => ({ ...el, customData: { ...el.customData, [MEASURE_KEY]: true } }) as El;

/** A labelled box as the server makes it: the label's size is a guess, too wide and off-centre. */
function serverBox() {
  const [box, label] = restoreElements(
    convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "box",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          label: { text: "Check the result" },
        },
      ],
      { regenerateIds: false },
    ),
    null,
  );
  const guessed = { ...(label as ExcalidrawTextElement), width: 400, height: 25, x: 0, y: 110 } as El;
  return [tag({ ...box!, customData: { udFlow: "step" } }), tag(guessed)];
}

describe("remeasure", () => {
  test("returns null when no element is tagged", () => {
    const els = convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]);
    expect(remeasure(els)).toBeNull();
    expect(hasMeasureTag(els)).toBe(false);
  });

  test("clears the tag, bumps versions and recenters a label in its container", () => {
    const scene = serverBox();
    expect(hasMeasureTag(scene)).toBe(true);
    const fixed = remeasure(scene)!;
    const box = fixed.find((el) => el.id === "box")!;
    const label = fixed.find((el) => el.type === "text") as ExcalidrawTextElement;
    for (const el of fixed) {
      expect(el.customData?.[MEASURE_KEY]).toBeUndefined();
      expect(el.version).toBeGreaterThan(scene.find((s) => s.id === el.id)!.version);
    }
    // Other tags stay.
    expect(box.customData?.udFlow).toBe("step");
    expect(label.width).not.toBe(400);
    expect(label.width).toBeLessThanOrEqual(box.width);
    expect(label.x + label.width / 2).toBeCloseTo(box.x + box.width / 2, 5);
    expect(label.y + label.height / 2).toBeCloseTo(box.y + box.height / 2, 5);
    expect(label.containerId).toBe("box");
  });

  test("a label taller than its box makes the box taller", () => {
    const [box, label] = serverBox();
    const long = { ...(label as ExcalidrawTextElement), originalText: "word ".repeat(80).trim() } as El;
    const fixed = remeasure([box!, long])!;
    const grown = fixed.find((el) => el.id === "box")!;
    const text = fixed.find((el) => el.type === "text")!;
    expect(grown.height).toBeGreaterThan(80);
    expect(text.y).toBeGreaterThanOrEqual(grown.y);
    expect(text.y + text.height).toBeLessThanOrEqual(grown.y + grown.height);
  });

  test("free text keeps its spot and gets its real size", () => {
    const [free] = restoreElements(
      convertToExcalidrawElements([{ type: "text", id: "t", x: 50, y: 60, text: "Pricing" }], {
        regenerateIds: false,
      }),
      null,
    );
    const fixed = remeasure([tag({ ...free!, width: 999 } as El)])!;
    expect(fixed[0]).toMatchObject({ x: 50, y: 60 });
    expect(fixed[0]!.width).not.toBe(999);
  });
});

test("remeasureScene puts the fixed elements in the scene without an undo step", async () => {
  let elements: readonly El[] = serverBox();
  const updates: SceneData[] = [];
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: (data: SceneData) => {
      updates.push(data);
      if (data.elements) elements = data.elements;
    },
  };
  await remeasureScene(api as never);
  expect(updates).toHaveLength(1);
  expect(updates[0]!.captureUpdate).toBe(CaptureUpdateAction.NEVER);
  expect(hasMeasureTag(elements)).toBe(false);
  await remeasureScene(api as never);
  expect(updates).toHaveLength(1);
});
