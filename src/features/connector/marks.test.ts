import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { expect, test } from "vitest";
import { MEASURE_KEY, markForMeasure } from "./marks";

test("markForMeasure tags text and the shapes that hold it, and nothing else", () => {
  const els = convertToExcalidrawElements(
    [
      { type: "rectangle", id: "box", x: 0, y: 0, width: 100, height: 50, label: { text: "hi" } },
      { type: "rectangle", id: "plain", x: 200, y: 0, width: 100, height: 50 },
      { type: "text", id: "free", x: 0, y: 100, text: "note" },
    ],
    { regenerateIds: false },
  );
  const marked = markForMeasure(els);
  const tagged = marked
    .filter((el) => el.customData?.[MEASURE_KEY] === true)
    .map((el) => (el.type === "text" && el.containerId ? "label" : el.id));
  expect(tagged.sort()).toEqual(["box", "free", "label"]);
  expect(marked.find((el) => el.id === "plain")?.customData?.[MEASURE_KEY]).toBeUndefined();
});
