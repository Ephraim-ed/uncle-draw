import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { FLOWCHARTS, buildTemplate, templateBounds } from "./flowcharts";
import { TemplatesDialog } from "./TemplatesDialog";

const STYLE = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "hachure",
  fontFamily: 5,
} as const;

const labelOf = (els: readonly ExcalidrawElement[], shape: ExcalidrawElement) => {
  const id = shape.boundElements?.find((b) => b.type === "text")?.id;
  const text = els.find((el) => el.id === id);
  return text?.type === "text" ? text.originalText : undefined;
};

describe("flowchart templates", () => {
  it.each(FLOWCHARTS.map((t) => [t.name, t] as const))(
    "%s builds into bound, labelled shapes",
    (_name, t) => {
      const els = buildTemplate(t, { x: 500, y: 300 }, STYLE);
      const arrows = els.filter((el): el is ExcalidrawArrowElement => el.type === "arrow");
      expect(arrows).toHaveLength(t.links.length);
      for (const arrow of arrows) {
        const start = els.find((el) => el.id === arrow.startBinding?.elementId);
        const end = els.find((el) => el.id === arrow.endBinding?.elementId);
        expect(start && end).toBeTruthy();
        // Both shapes know about the arrow, so it follows them when they move.
        expect(start!.boundElements?.some((b) => b.id === arrow.id)).toBe(true);
        expect(end!.boundElements?.some((b) => b.id === arrow.id)).toBe(true);
      }
      const labels = t.nodes.flatMap((n) => (n.label ? [n.label] : []));
      const shapes = els.filter((el) => el.type !== "text" && el.type !== "arrow");
      expect(
        shapes
          .map((s) => labelOf(els, s))
          .filter(Boolean)
          .sort(),
      ).toEqual([...labels].sort());
      expect(els.every((el) => el.index === null)).toBe(true);

      // Placed where asked.
      const b = templateBounds(t);
      expect(Math.min(...shapes.map((s) => s.x))).toBeCloseTo(
        500 + (Math.min(...t.nodes.map((n) => n.x)) - b.x),
      );
    },
  );

  it("gives every insert fresh ids", () => {
    const t = FLOWCHARTS[2]!;
    const a = buildTemplate(t, { x: 0, y: 0 }, STYLE).map((el) => el.id);
    const b = buildTemplate(t, { x: 0, y: 0 }, STYLE).map((el) => el.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it("uses the drawing style for strokes and fills", () => {
    const els = buildTemplate(
      FLOWCHARTS[0]!,
      { x: 0, y: 0 },
      { ...STYLE, strokeColor: "#e03131", fillStyle: "solid" },
    );
    const step = els.find((el) => el.type === "rectangle")!;
    expect([step.strokeColor, step.fillStyle, step.backgroundColor]).toEqual(["#e03131", "solid", "#a5d8ff"]);
  });
});

describe("TemplatesDialog", () => {
  it("lists the templates and picks one", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<TemplatesDialog onPick={onPick} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Flowchart templates" })).toBeInTheDocument();
    for (const t of FLOWCHARTS)
      expect(screen.getByRole("button", { name: new RegExp(t.name) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Swimlanes/ }));
    expect(onPick).toHaveBeenCalledWith(FLOWCHARTS.find((t) => t.id === "swimlanes"));
    expect(onClose).toHaveBeenCalled();
  });
});
