import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { buildTable, DEFAULT_HEADER_FILL } from "../table/grid";
import { FLOWCHARTS, buildTemplate } from "../templates/flowcharts";
import { STEP_FILL, addLane, addNextStep, deleteLane, flowKind, isFlowNode, laneStack } from "./flow";

type El = ExcalidrawElement;

const STYLE = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "hachure",
  fontFamily: 5,
} as const;
const template = (id: string) =>
  buildTemplate(
    FLOWCHARTS.find((t) => t.id === id)!,
    { x: 0, y: 0 },
    STYLE,
  );

const live = (els: readonly El[]) => els.filter((el) => !el.isDeleted);
const labelled = (els: readonly El[], text: string) => {
  const label = live(els).find((el) => el.type === "text" && el.originalText === text);
  return live(els).find((el) => el.id === (label as { containerId?: string } | undefined)?.containerId)!;
};
const byId = (els: readonly El[], id: string) => els.find((el) => el.id === id)!;
const arrowBetween = (els: readonly El[], from: El, to: El) =>
  live(els).find(
    (el): el is ExcalidrawArrowElement =>
      el.type === "arrow" && el.startBinding?.elementId === from.id && el.endBinding?.elementId === to.id,
  )!;
/** An arrow's corners in scene coords. Excalidraw nudges bound ends by half a pixel, so compare within 1 px. */
const expectPath = (a: ExcalidrawArrowElement, expected: number[][]) => {
  const actual = a.points.map(([x, y]) => [a.x + x, a.y + y]);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(Math.abs(p[0]! - expected[i]![0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[1]! - expected[i]![1]!)).toBeLessThanOrEqual(1);
  });
};
const bodies = (els: readonly El[]) =>
  live(els)
    .filter((el) => flowKind(el) === "lane")
    .sort((a, b) => a.y - b.y);

describe("swimlanes", () => {
  it("finds the whole stack from a header or a body", () => {
    const els = template("swimlanes");
    const sales = labelled(els, "Sales");
    const stack = laneStack(els, sales.id)!;
    expect(stack.index).toBe(1);
    expect(stack.lanes.map((l) => [l.body.y, l.head?.id])).toEqual([
      [0, labelled(els, "Customer").id],
      [160, sales.id],
      [320, labelled(els, "Warehouse").id],
    ]);
    expect(laneStack(els, stack.lanes[2]!.body.id)!.index).toBe(2);
  });

  it("adds a lane below one, pushing lanes, steps and arrow ends down", () => {
    const els = template("swimlanes");
    const confirm = labelled(els, "Confirm order");
    const ship = labelled(els, "Pack and ship");
    const receive = labelled(els, "Receive order");
    const result = addLane(els, labelled(els, "Sales").id, "below")!;
    const next = result.elements;

    expect(bodies(next).map((b) => b.y)).toEqual([0, 160, 320, 480]);
    const head = byId(next, result.headId!);
    expect([flowKind(head), head.y, head.x, head.backgroundColor]).toEqual([
      "laneHead",
      320,
      0,
      DEFAULT_HEADER_FILL,
    ]);
    expect(byId(next, labelled(els, "Warehouse").id).y).toBe(480);
    expect(byId(next, ship.id).y).toBe(ship.y + 160);
    expect(byId(next, confirm.id).y).toBe(confirm.y); // above the new lane
    // The ship step's label went with it.
    expect(labelled(next, "Pack and ship").id).toBe(ship.id);

    // Into the moved step: its end and the corner lined up with it moved; the elbow stays square.
    expectPath(arrowBetween(next, confirm, ship), [
      [606, 240],
      [630, 240],
      [630, 560],
      [654, 560],
    ]);
    // Out of the moved step: the same from the start.
    expectPath(arrowBetween(next, ship, receive), [
      [846, 560],
      [870, 560],
      [870, 80],
      [894, 80],
    ]);
    // New lanes sit behind the steps.
    expect(next.indexOf(byId(next, result.laneId))).toBeLessThan(next.indexOf(byId(next, ship.id)));
  });

  it("adds a lane above the first one, moving the whole chart down", () => {
    const els = template("swimlanes");
    const order = labelled(els, "Place order");
    const next = addLane(els, labelled(els, "Customer").id, "above")!.elements;
    expect(bodies(next).map((b) => b.y)).toEqual([0, 160, 320, 480]);
    expect(byId(next, order.id).y).toBe(order.y + 160);
  });

  it("deletes a lane with its steps and arrows, and closes the gap", () => {
    const els = template("swimlanes");
    const order = labelled(els, "Place order");
    const confirm = labelled(els, "Confirm order");
    const ship = labelled(els, "Pack and ship");
    const toConfirm = arrowBetween(els, order, confirm);
    const next = deleteLane(els, labelled(els, "Sales").id)!;

    expect(bodies(next).map((b) => b.y)).toEqual([0, 160]);
    expect(byId(next, confirm.id).isDeleted).toBe(true);
    expect(byId(next, toConfirm.id).isDeleted).toBe(true);
    expect(live(next).some((el) => el.type === "text" && el.originalText === "Sales")).toBe(false);
    expect(byId(next, ship.id).y).toBe(ship.y - 160);
    expect(byId(next, order.id).boundElements?.some((b) => b.id === toConfirm.id)).toBe(false);
  });

  it("keeps at least one lane", () => {
    let els = template("swimlanes");
    els = deleteLane(els, labelled(els, "Sales").id)!;
    els = deleteLane(els, labelled(els, "Warehouse").id)!;
    expect(deleteLane(els, labelled(els, "Customer").id)).toBeNull();
  });
});

describe("addNextStep", () => {
  it("adds a connected step to the right, in the same lane and style", () => {
    const els = template("swimlanes");
    const order = labelled(els, "Place order");
    const { elements, stepId } = addNextStep(els, order.id, "right")!;
    const step = byId(elements, stepId);
    expect([step.type, step.x, step.y, step.width, step.height]).toEqual(["rectangle", 424, 44, 180, 72]);
    expect([flowKind(step), step.backgroundColor, step.roundness]).toEqual([
      "step",
      STEP_FILL,
      order.roundness,
    ]);
    const arrow = arrowBetween(elements, order, step);
    expectPath(arrow, [
      [366, 80],
      [418, 80],
    ]);
    expect(byId(elements, order.id).boundElements?.some((b) => b.id === arrow.id)).toBe(true);
    expect(step.boundElements).toEqual([{ type: "arrow", id: arrow.id }]);
  });

  it("goes down into the next lane, centered in it", () => {
    const els = template("swimlanes");
    const order = labelled(els, "Place order");
    const { elements, stepId } = addNextStep(els, order.id, "down")!;
    const step = byId(elements, stepId);
    expect([step.x, step.y]).toEqual([180, 160 + (160 - 72) / 2]);
  });

  it("widens the lanes when a step would stick out", () => {
    const els = template("swimlanes");
    const { elements } = addNextStep(els, labelled(els, "Receive order").id, "right")!;
    // 900 + 180 + 64 + 180 + 40 margin = 1364 → lanes from x 140 are 1224 wide.
    expect(bodies(elements).map((b) => b.width)).toEqual([1224, 1224, 1224]);
  });

  it("steps past a shape that's already there", () => {
    const els = template("process");
    const check = labelled(els, "Check the result");
    const { elements, stepId } = addNextStep(els, check.id, "down")!;
    const step = byId(elements, stepId);
    const done = labelled(els, "Done");
    expect(step.y).toBeGreaterThan(done.y + done.height);
    expect(step.x + step.width / 2).toBe(check.x + check.width / 2);
  });

  it("follows a question or an end with a normal step", () => {
    const els = template("decision");
    const { elements, stepId } = addNextStep(els, labelled(els, "Is it OK?").id, "left")!;
    const step = byId(elements, stepId);
    expect([step.type, step.width, step.height, step.backgroundColor]).toEqual([
      "rectangle",
      180,
      72,
      STEP_FILL,
    ]);
  });
});

describe("isFlowNode", () => {
  it("is a template step, or a shape with arrows; never lanes or table cells", () => {
    const els = template("swimlanes");
    expect(isFlowNode(labelled(els, "Place order"))).toBe(true);
    expect(isFlowNode(labelled(els, "Sales"))).toBe(false);
    expect(isFlowNode(bodies(els)[0]!)).toBe(false);
    const [plain] = convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }]);
    expect(isFlowNode(plain!)).toBe(false);
    expect(isFlowNode({ ...plain!, boundElements: [{ type: "arrow", id: "a" }] })).toBe(true);
    const look = {
      headerFill: DEFAULT_HEADER_FILL,
      cellFill: "#fff",
      border: "#000",
      borderWidth: 1,
      align: "center" as const,
      roughness: 1,
    };
    const [cell] = buildTable({ rows: 1, cols: 1, header: false, checkboxes: false }, { x: 0, y: 0 }, look, {
      fontSize: 20,
      fontFamily: 5,
      strokeColor: "#000",
    });
    expect(isFlowNode({ ...cell!, boundElements: [{ type: "arrow", id: "a" }] })).toBe(false);
  });
});
