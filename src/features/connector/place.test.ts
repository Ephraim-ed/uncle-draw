import { convertToExcalidrawElements, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, test } from "vitest";
import { TEMPLATES } from "../editor/templates/templates";
import { notesTemplate } from "./blocks";
import { MEASURE_KEY } from "./marks";
import { addTemplate, freeSpot } from "./place";

const process = TEMPLATES.find((t) => t.id === "process")!;
const rect = (id: string, x: number, y: number, w = 100, h = 50, more: Partial<ExcalidrawElement> = {}) =>
  ({
    ...convertToExcalidrawElements([{ type: "rectangle", id, x, y, width: w, height: h }], {
      regenerateIds: false,
    })[0]!,
    ...more,
  }) as ExcalidrawElement;
const live = (els: readonly ExcalidrawElement[]) => els.filter((el) => !el.isDeleted);
const boundsOf = (els: readonly ExcalidrawElement[]) => {
  const [x1, y1, x2, y2] = getCommonBounds(live(els));
  return { x1, y1, x2, y2 };
};
const overlap = (a: ReturnType<typeof boundsOf>, b: ReturnType<typeof boundsOf>) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe("freeSpot", () => {
  test("on an empty board is 0,0", () => {
    expect(freeSpot([], { width: 300, height: 200 })).toEqual({ x: 0, y: 0 });
  });

  test("is right of existing content, top-aligned, and never overlaps it", () => {
    const scene = [rect("a", -50, 40), rect("b", 300, 200, 200, 300)];
    const spot = freeSpot(scene, { width: 400, height: 400 });
    expect(spot).toEqual({ x: 500 + 120, y: 40 });
  });
});

describe("addTemplate", () => {
  test("marks text and containers with udMeasure and gives every element an index", () => {
    const { elements, changed, createdIds } = addTemplate([rect("a", 0, 0)], process);
    expect(createdIds.length).toBeGreaterThan(0);
    expect(changed.map((el) => el.id).sort()).toEqual([...createdIds].sort());
    expect(elements.every((el) => typeof el.index === "string")).toBe(true);
    const indices = elements.map((el) => el.index!);
    expect(indices).toEqual([...indices].sort());
    const texts = changed.filter((el) => el.type === "text");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((el) => el.customData?.[MEASURE_KEY] === true)).toBe(true);
    const containers = changed.filter((el) =>
      texts.some((t) => t.type === "text" && t.containerId === el.id),
    );
    expect(containers.every((el) => el.customData?.[MEASURE_KEY] === true)).toBe(true);
    // The step tags survive, so the "+" buttons still grow the chart.
    expect(changed.some((el) => el.customData?.udFlow === "step")).toBe(true);
  });

  test("lands to the right of existing content without overlapping it", () => {
    const scene = [rect("a", 0, 0, 400, 400)];
    const { changed } = addTemplate(scene, process);
    expect(overlap(boundsOf(changed), boundsOf(scene))).toBe(false);
    expect(boundsOf(changed).x1).toBeGreaterThanOrEqual(400);
  });

  test("with a new area makes a named frame containing the elements", () => {
    const { changed, createdIds } = addTemplate([rect("a", 0, 0)], notesTemplate("Pricing", ["$12/mo?"]), {
      area: "Sign-up & pricing",
    });
    const frame = changed.find((el) => el.type === "frame");
    expect(frame).toMatchObject({ name: "Sign-up & pricing" });
    expect(createdIds).toContain(frame!.id);
    const children = changed.filter((el) => el.id !== frame!.id);
    expect(children.every((el) => el.frameId === frame!.id)).toBe(true);
    // The frame wraps its contents with room to spare.
    const inner = boundsOf(children);
    expect(frame!.x).toBeLessThanOrEqual(inner.x1 - 40);
    expect(frame!.x + frame!.width).toBeGreaterThanOrEqual(inner.x2 + 40);
  });

  test("into an existing area grows that frame and bumps its version", () => {
    const first = addTemplate([], notesTemplate("Pricing", ["$12/mo?"]), { area: "Pricing" });
    const frame = first.elements.find((el) => el.type === "frame")!;
    const second = addTemplate(first.elements, process, { area: "Pricing" });
    const grown = second.changed.find((el) => el.id === frame.id)!;
    expect(grown.version).toBeGreaterThan(frame.version);
    expect(grown.height).toBeGreaterThan(frame.height);
    const added = second.changed.filter((el) => second.createdIds.includes(el.id));
    expect(added.every((el) => el.frameId === frame.id)).toBe(true);
    expect(second.elements.filter((el) => el.type === "frame")).toHaveLength(1);
    // New content sits below what was already in the frame.
    const before = boundsOf(first.elements.filter((el) => el.frameId === frame.id));
    expect(boundsOf(added).y1).toBeGreaterThan(before.y2);
    expect(boundsOf(added).y2).toBeLessThanOrEqual(grown.y + grown.height);
  });

  test("never overlaps deleted elements' ghosts (ignores isDeleted)", () => {
    const scene = [rect("a", 0, 0), rect("ghost", 2000, 0, 100, 50, { isDeleted: true })];
    const { changed } = addTemplate(scene, process);
    // Placement ignores the deleted element: it goes next to the live one, not past the ghost.
    expect(boundsOf(changed).x1).toBeLessThan(2000);
  });
});
