import { buildTemplate, TEMPLATES, type TemplateStyle } from "../../src/features/editor/templates/templates";

const STYLE: TemplateStyle = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "solid",
  fontFamily: 5,
  paper: "#ffffff",
};

/** Builds every template; the element count proves Excalidraw works here (scripts/check-mcp-bundle.mjs). */
export function selftest(): number {
  return TEMPLATES.reduce((n, t) => n + buildTemplate(t, { x: 0, y: 0 }, STYLE).length, 0);
}
