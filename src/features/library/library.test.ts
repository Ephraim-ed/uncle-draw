import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneElements, selectionForTemplate } from "./clone";
import { LibrarySync } from "./librarySync";

function linked(): ExcalidrawElement[] {
  return convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        label: { text: "A" },
        groupIds: ["g"],
      },
      { type: "rectangle", id: "b", x: 0, y: 150, width: 100, height: 50, groupIds: ["g"] },
      { type: "arrow", x: 50, y: 56, width: 0, height: 88, start: { id: "a" }, end: { id: "b" } },
    ],
    { regenerateIds: false },
  );
}

describe("cloneElements", () => {
  it("copies with fresh ids and groups, keeps labels and arrows attached, and moves to `at`", () => {
    const els = linked();
    const copy = cloneElements(els, { x: 500, y: 400 });
    const oldIds = new Set(els.map((el) => el.id));
    expect(copy.every((el) => !oldIds.has(el.id))).toBe(true);
    expect(new Set(copy.map((el) => el.groupIds.join())).size).toBeGreaterThan(0);
    expect(copy.some((el) => el.groupIds.includes("g"))).toBe(false);

    const ids = new Set(copy.map((el) => el.id));
    const arrow = copy.find((el): el is ExcalidrawArrowElement => el.type === "arrow")!;
    expect(ids.has(arrow.startBinding!.elementId) && ids.has(arrow.endBinding!.elementId)).toBe(true);
    const label = copy.find((el) => el.type === "text")!;
    expect(ids.has((label as { containerId: string }).containerId)).toBe(true);
    for (const el of copy) for (const b of el.boundElements ?? []) expect(ids.has(b.id)).toBe(true);
    expect(Math.min(...copy.map((el) => el.x))).toBe(500);
    expect(Math.min(...copy.map((el) => el.y))).toBe(400);
  });

  it("drops links to anything left behind", () => {
    const els = linked();
    const onlyArrow = cloneElements(
      els.filter((el) => el.type === "arrow"),
      { x: 0, y: 0 },
    );
    const arrow = onlyArrow[0] as ExcalidrawArrowElement;
    expect([arrow.startBinding, arrow.endBinding]).toEqual([null, null]);
  });
});

describe("selectionForTemplate", () => {
  it("takes the selected shapes with their labels, and leaves images out", () => {
    const els = linked();
    const a = els.find((el) => el.id === "a")!;
    // An image as a board holds it (converting one needs its file).
    const image = {
      ...a,
      id: "img",
      type: "image",
      fileId: "f",
      status: "saved",
      scale: [1, 1],
      crop: null,
    } as unknown as ExcalidrawElement;
    const picked = selectionForTemplate([...els, image], { [a.id]: true, [image.id]: true });
    expect(picked.elements.map((el) => el.type).sort()).toEqual(["rectangle", "text"]);
    expect(picked.skippedImages).toBe(1);
  });
});

describe("LibrarySync", () => {
  afterEach(() => vi.useRealTimers());
  const item = (id: string): LibraryItems[number] => ({
    id,
    status: "unpublished",
    elements: [],
    created: 1,
  });

  it("loads once, then saves changes after they settle", async () => {
    vi.useFakeTimers();
    const api = { load: vi.fn().mockResolvedValue([item("a")]), save: vi.fn().mockResolvedValue(undefined) };
    const sync = new LibrarySync("u1", api);
    await expect(sync.load()).resolves.toEqual([item("a")]);
    await sync.load();
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(sync.getItems()).toEqual([item("a")]);

    // Excalidraw reporting what it loaded is not a change.
    sync.handleChange([item("a")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.save).not.toHaveBeenCalled();

    sync.handleChange([item("a"), item("b")]);
    sync.handleChange([item("b")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith("u1", [item("b")]);
  });

  it("tells me once when saving fails, and retries", async () => {
    const onError = vi.fn();
    const api = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined),
    };
    const sync = new LibrarySync("u1", api, onError);
    await sync.load();
    sync.handleChange([item("a")]);
    await sync.flush();
    await sync.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledTimes(2);
    await sync.flush();
    expect(api.save).toHaveBeenCalledTimes(2); // saved now; nothing more to do
  });
});
