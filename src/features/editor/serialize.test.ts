import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { HAND_DRAWN_DEFAULTS } from "./constants";
import { pickDbAppState, restoreScene, sceneFingerprint, toDbPayload } from "./serialize";

/** A scene as the editor holds it: Excalidraw has already run restore() on it. */
function sampleElements(): ExcalidrawElement[] {
  const skeleton = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      fillStyle: "hachure",
      backgroundColor: "#a5d8ff",
    },
    { type: "ellipse", x: 200, y: 40, width: 60, height: 60, strokeColor: "#1971c2" },
    { type: "arrow", x: 140, y: 60, width: 50, height: 0 },
    { type: "diamond", x: 300, y: 20, width: 40, height: 40, roughness: 2 },
  ]);
  return restoreScene(skeleton as unknown[]).elements as ExcalidrawElement[];
}

const comparable = (els: readonly ExcalidrawElement[]) =>
  els.map((e) => ({
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    seed: e.seed,
    version: e.version,
    versionNonce: e.versionNonce,
    strokeColor: e.strokeColor,
    backgroundColor: e.backgroundColor,
    fillStyle: e.fillStyle,
    roughness: e.roughness,
  }));

describe("serialize (tech §7.2, §14)", () => {
  it("round-trips: save → load → restore() gives identical elements", () => {
    const elements = sampleElements();
    const payload = toDbPayload(elements, { viewBackgroundColor: "#ffffff", gridModeEnabled: false });
    // What Postgres stores and returns is plain JSON.
    const fromDb = JSON.parse(JSON.stringify(payload)) as typeof payload;
    const { elements: restored } = restoreScene(fromDb.scene.elements, fromDb.app_state);
    expect(comparable(restored)).toEqual(comparable(elements));
  });

  it("keeps each shape's seed, so the wobble looks the same after reload (EDIT-2)", () => {
    const elements = sampleElements();
    const { elements: restored } = restoreScene(
      JSON.parse(JSON.stringify(toDbPayload(elements, {}).scene.elements)),
    );
    expect(restored.map((e) => e.seed)).toEqual(elements.map((e) => e.seed));
  });

  it("drops deleted elements (v1 doesn't keep tombstones)", () => {
    const [first, ...rest] = sampleElements();
    const deleted = newElementWith(first!, { isDeleted: true });
    const payload = toDbPayload([deleted, ...rest], {});
    expect(payload.scene.elements.map((e) => e.id)).toEqual(rest.map((e) => e.id));
  });

  it("keeps only the board-level appState, never personal UI state", () => {
    const payload = toDbPayload(sampleElements(), {
      ...HAND_DRAWN_DEFAULTS,
      viewBackgroundColor: "#fff9db",
      gridModeEnabled: true,
      gridSize: 20,
      gridStep: 5,
      scrollX: 500,
      scrollY: -200,
      zoom: { value: 2 as never },
      theme: "dark",
      currentItemStrokeColor: "#e03131",
    } as never);
    expect(Object.keys(payload.app_state).sort()).toEqual(
      ["gridModeEnabled", "gridSize", "gridStep", "viewBackgroundColor"].sort(),
    );
    expect(payload.app_state.viewBackgroundColor).toBe("#fff9db");
    expect(payload.bytes).toBeGreaterThan(0);
  });

  it("pickDbAppState ignores unknown and undefined keys", () => {
    expect(pickDbAppState({ viewBackgroundColor: "#000", foo: 1, gridSize: undefined })).toEqual({
      viewBackgroundColor: "#000",
    });
  });

  it("fingerprints change with element versions and board settings, not with the viewport", () => {
    const elements = sampleElements();
    const base = sceneFingerprint(elements, { viewBackgroundColor: "#ffffff" });
    expect(sceneFingerprint(elements, { viewBackgroundColor: "#ffffff", scrollX: 99 } as never)).toBe(base);
    expect(sceneFingerprint(elements, { viewBackgroundColor: "#fff9db" })).not.toBe(base);
    const moved = [newElementWith(elements[0]!, { x: 999 }), ...elements.slice(1)];
    expect(sceneFingerprint(moved, { viewBackgroundColor: "#ffffff" })).not.toBe(base);
  });

  it("restore() tolerates old or partial elements from the DB", () => {
    const { elements } = restoreScene([{ id: "legacy", type: "rectangle", x: 1, y: 2, width: 3, height: 4 }]);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.id).toBe("legacy");
    expect(typeof elements[0]!.seed).toBe("number");
  });
});
