import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { LibraryItem } from "@excalidraw/excalidraw/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { readPlan } from "../table/grid";
import { tablePart } from "../table/table";
import { TEMPLATES, buildTemplate, templateBounds } from "./templates";
import { SaveTemplateDialog, TemplatesDialog } from "./TemplatesDialog";

const STYLE = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "hachure",
  fontFamily: 5,
  paper: "#ffffff",
} as const;
const FONT = { fontSize: 20, fontFamily: 5, strokeColor: "#1e1e1e" };

const labelOf = (els: readonly ExcalidrawElement[], shape: ExcalidrawElement) => {
  const id = shape.boundElements?.find((b) => b.type === "text")?.id;
  const text = els.find((el) => el.id === id);
  return text?.type === "text" ? text.originalText : undefined;
};

describe("templates", () => {
  it.each(TEMPLATES.map((t) => [t.name, t] as const))("%s builds into bound, labelled shapes", (_name, t) => {
    const els = buildTemplate(t, { x: 500, y: 300 }, STYLE);
    expect(els.every((el) => el.index === null)).toBe(true);
    const arrows = els.filter((el): el is ExcalidrawArrowElement => el.type === "arrow");
    const bound = arrows.filter((a) => a.startBinding);
    expect(bound).toHaveLength(t.links.length);
    expect(arrows.length - bound.length).toBe(t.paths?.length ?? 0);
    for (const arrow of bound) {
      const start = els.find((el) => el.id === arrow.startBinding?.elementId)!;
      const end = els.find((el) => el.id === arrow.endBinding?.elementId)!;
      // Both shapes know about the arrow, so it follows them when they move.
      expect(start.boundElements?.some((b) => b.id === arrow.id)).toBe(true);
      expect(end.boundElements?.some((b) => b.id === arrow.id)).toBe(true);
    }
    const labels = t.nodes.flatMap((n) => (n.label ? [n.label] : []));
    const shapes = els.filter((el) => el.type !== "text" && el.type !== "arrow" && !tablePart(el));
    expect(
      shapes
        .map((s) => labelOf(els, s))
        .filter(Boolean)
        .sort(),
    ).toEqual([...labels].sort());
    const free = els.filter((el) => el.type === "text" && !el.containerId);
    expect(free.map((el) => (el.type === "text" ? el.originalText : "")).sort()).toEqual(
      (t.notes ?? []).map((n) => n.text).sort(),
    );
    // Placed where asked.
    const b = templateBounds(t);
    const left = Math.min(...els.filter((el) => el.type !== "text").map((el) => el.x));
    expect(left).toBeGreaterThanOrEqual(500 - 1);
    expect(left).toBeLessThan(500 + b.width);
  });

  it("gives every insert fresh ids", () => {
    const t = TEMPLATES.find((x) => x.id === "decision")!;
    const a = buildTemplate(t, { x: 0, y: 0 }, STYLE).map((el) => el.id);
    const b = buildTemplate(t, { x: 0, y: 0 }, STYLE).map((el) => el.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it("uses the drawing style for strokes and fills", () => {
    const els = buildTemplate(
      TEMPLATES[0]!,
      { x: 0, y: 0 },
      { ...STYLE, strokeColor: "#e03131", fillStyle: "solid" },
    );
    const step = els.find((el) => el.type === "rectangle")!;
    expect([step.strokeColor, step.fillStyle, step.backgroundColor]).toEqual(["#e03131", "solid", "#a5d8ff"]);
  });

  it("makes the user journey a real, editable table", () => {
    const t = TEMPLATES.find((x) => x.id === "journey")!;
    const els = buildTemplate(t, { x: 0, y: 0 }, STYLE);
    const groupId = els.find((el) => tablePart(el) === "cell")!.groupIds[0]!;
    const p = readPlan(els, groupId, FONT)!;
    expect([p.rowH.length, p.colW.length, p.header]).toEqual([4, 6, true]);
    expect(p.slots[0]!.map((s) => s.text?.originalText ?? "")).toEqual(t.table!.header);
    expect(p.slots.slice(1).map((row) => row[0]!.text?.originalText)).toEqual([
      "Doing",
      "Thinking",
      "Feeling",
    ]);
    expect(p.slots[1]![0]!.cell!.backgroundColor).toBe("#e9ecef"); // the row labels are shaded
  });

  it("lines mind maps and org charts without arrowheads", () => {
    for (const id of ["mindmap", "orgchart"]) {
      const els = buildTemplate(
        TEMPLATES.find((x) => x.id === id)!,
        { x: 0, y: 0 },
        STYLE,
      );
      const arrows = els.filter((el): el is ExcalidrawArrowElement => el.type === "arrow");
      expect(arrows.every((a) => a.endArrowhead === null)).toBe(true);
    }
  });
});

describe("TemplatesDialog", () => {
  const mineItem: LibraryItem = {
    id: "mine-1",
    status: "unpublished",
    elements: buildTemplate(TEMPLATES[0]!, { x: 0, y: 0 }, STYLE),
    created: 1,
    name: "Order flow",
  };

  function renderDialog(props: Partial<Parameters<typeof TemplatesDialog>[0]> = {}) {
    const handlers = {
      onPick: vi.fn(),
      onClose: vi.fn(),
      onPickMine: vi.fn(),
      onRemoveMine: vi.fn(),
    };
    renderWithProviders(<TemplatesDialog mine={[]} {...handlers} {...props} />);
    return handlers;
  }

  it("lists the templates by kind and picks one", async () => {
    const { onPick, onClose } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
    for (const heading of ["Flowcharts", "Planning", "Diagrams", "My templates"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    for (const t of TEMPLATES)
      expect(screen.getByRole("button", { name: new RegExp(t.name) })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Kanban board/ }));
    expect(onPick).toHaveBeenCalledWith(TEMPLATES.find((t) => t.id === "kanban"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows my templates, inserts and removes them, and offers to save the selection", async () => {
    const onSaveSelection = vi.fn();
    const { onPickMine, onRemoveMine } = renderDialog({ mine: [mineItem], onSaveSelection });
    await userEvent.click(screen.getByRole("button", { name: "Remove “Order flow”" }));
    expect(onRemoveMine).toHaveBeenCalledWith(mineItem);
    await userEvent.click(screen.getByRole("button", { name: /^Order flow/ }));
    expect(onPickMine).toHaveBeenCalledWith(mineItem);
  });

  it("explains how to save a template when there are none", async () => {
    const onSaveSelection = vi.fn();
    renderDialog({ onSaveSelection });
    expect(screen.getByText(/Select shapes on the board/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save selected shapes" }));
    expect(onSaveSelection).toHaveBeenCalled();
  });
});

describe("SaveTemplateDialog", () => {
  it("saves under the typed name, or a default", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <SaveTemplateDialog count={3} skippedImages={1} onClose={() => {}} onSave={onSave} />,
    );
    expect(screen.getByText(/3 shapes go into it. Images stay on this board/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Template name"), "Order flow{Enter}");
    expect(onSave).toHaveBeenCalledWith("Order flow");
  });

  it("names an unnamed template", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <SaveTemplateDialog count={1} skippedImages={0} onClose={() => {}} onSave={onSave} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(onSave).toHaveBeenCalledWith("Untitled template");
  });
});
