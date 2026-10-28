import { convertToExcalidrawElements, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { describe, expect, test } from "vitest";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import { buildTemplate, TEMPLATES } from "../editor/templates/templates";
import { deleteUnits, restoreSnapshot } from "./history";
import { addTemplate, DEFAULT_STYLE } from "./place";
import { applyTidy } from "./tidy";
import { ConnectorError } from "./types";
import { describeUnits } from "./units";

type El = ExcalidrawElement;
const template = (id: string) => TEMPLATES.find((t) => t.id === id)!;
const board = (els: El[]) => restoreElements(els, null, { repairBindings: true });
const text = (id: string, x: number, y: number, value: string) =>
  convertToExcalidrawElements([{ type: "text", id, x, y, text: value }], { regenerateIds: false })[0]!;
const live = (els: readonly El[]) => els.filter((el) => !el.isDeleted);
const pos = (els: readonly El[]) =>
  live(els)
    .map((el) => [el.id, Math.round(el.x), Math.round(el.y)].join())
    .sort();
const merge = (local: readonly El[], remote: readonly El[]) =>
  reconcileElements(
    local as readonly OrderedExcalidrawElement[],
    remote as unknown as RemoteExcalidrawElement[],
    {} as AppState,
  );

const chart = buildTemplate(template("process"), { x: 0, y: 0 }, DEFAULT_STYLE);
const scene = board([...chart, text("t1", 600, 0, "call Sam"), text("t2", 600, 200, "write FAQ")]);
const chartUnit = describeUnits(scene).find((u) => u.kind === "chart")!.id;

describe("deleteUnits", () => {
  test("tombstones the chart's shapes, arrows and labels", () => {
    const { elements, changed } = deleteUnits(scene, [chartUnit]);
    for (const el of chart) {
      const after = elements.find((e) => e.id === el.id)!;
      expect(after.isDeleted).toBe(true);
      expect(after.version).toBeGreaterThan(scene.find((e) => e.id === el.id)!.version);
    }
    expect(changed.map((el) => el.id).sort()).toEqual(chart.map((el) => el.id).sort());
    expect(
      live(elements)
        .map((el) => el.id)
        .sort(),
    ).toEqual(["t1", "t2"]);
  });

  test("deleting a frame deletes what's in it, like Excalidraw does", () => {
    const { elements } = addTemplate(scene, template("kanban"), { area: "Plan" });
    const frame = describeUnits(elements).find((u) => u.kind === "frame")!;
    const after = deleteUnits(elements, [frame.id]).elements;
    expect(
      live(after).some((el) => el.frameId === frame.elementIds[0] || el.id === frame.elementIds[0]),
    ).toBe(false);
    expect(live(after).length).toBe(live(scene).length);
  });

  test("an unknown or locked unit is refused", () => {
    expect(() => deleteUnits(scene, ["chart:nope"])).toThrow(ConnectorError);
    const locked = board([...scene, { ...text("pin", 0, 900, "pinned"), locked: true }]);
    expect(() => deleteUnits(locked, ["text:pin"])).toThrow(ConnectorError);
  });
});

describe("restoreSnapshot", () => {
  const tidied = applyTidy(scene, { topics: [{ name: "Sign-up", units: [chartUnit] }] }).elements;
  const current = board([...tidied, text("late", 3000, 3000, "added after")]);

  test("result wins reconcileElements against the current scene", () => {
    const { changed } = restoreSnapshot(current, scene);
    const merged = merge(current, changed);
    expect(pos(merged)).toEqual(pos(scene));
  });

  test("elements created after the snapshot are deleted by the restore", () => {
    const { elements, changed } = restoreSnapshot(current, scene);
    expect(elements.find((el) => el.id === "late")!.isDeleted).toBe(true);
    expect(live(elements).some((el) => el.type === "frame")).toBe(false);
    expect(changed.some((el) => el.id === "late")).toBe(true);
  });

  test("the restored scene has valid indices in snapshot order", () => {
    const { elements } = restoreSnapshot(current, scene);
    expect(elements.every((el) => typeof el.index === "string")).toBe(true);
    const indices = elements.map((el) => el.index!);
    expect(indices).toEqual([...indices].sort());
    const order = live(elements).map((el) => el.id);
    expect(order).toEqual(live(scene).map((el) => el.id));
  });
});
