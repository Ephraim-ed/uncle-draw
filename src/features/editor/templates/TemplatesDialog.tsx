import { exportToSvg } from "@excalidraw/excalidraw";
import { useEffect, useRef } from "react";
import { SketchArt, SketchDialog, hashSeed } from "../../../components/sketch";
import { FLOWCHARTS, buildTemplate, type FlowchartTemplate } from "./flowcharts";

const PREVIEW_STYLE = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "hachure",
  fontFamily: 5,
} as const;

/** The template drawn by Excalidraw itself, on a light "paper" card in both themes like board thumbnails. */
function Preview({ template }: { template: FlowchartTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    exportToSvg({
      elements: buildTemplate(template, { x: 0, y: 0 }, PREVIEW_STYLE),
      appState: { exportBackground: false, exportWithDarkMode: false },
      files: null,
      exportPadding: 12,
      skipInliningFonts: true,
    })
      .then((svg) => {
        if (cancelled || !ref.current) return;
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.setAttribute("aria-hidden", "true");
        ref.current.replaceChildren(svg);
      })
      .catch(() => {
        // The name and description still say what it is.
      });
    return () => {
      cancelled = true;
    };
  }, [template]);
  return <div ref={ref} className="ud-template__preview" />;
}

/** Toolbar → Flowchart templates, or Main menu → "Flowchart templates…" (EDIT-8). Mount it only while open. */
export function TemplatesDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (template: FlowchartTemplate) => void;
}) {
  return (
    <SketchDialog open onClose={onClose} title="Flowchart templates" seedKey="templates" width={760}>
      <p className="mb-4 text-ink-muted">Pick one to start from. Every shape and arrow stays editable.</p>
      <ul className="ud-templates">
        {FLOWCHARTS.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className="ud-template ud-sketch"
              onClick={() => {
                onPick(template);
                onClose();
              }}
            >
              <SketchArt
                seed={hashSeed(`template:${template.id}`)}
                shape="rect"
                fillStyle="solid"
                strokeWidth={1.5}
              />
              <Preview template={template} />
              <span className="ud-template__name">{template.name}</span>
              <span className="ud-template__description">{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </SketchDialog>
  );
}
