import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { LibraryItem, LibraryItems } from "@excalidraw/excalidraw/types";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  IconButton,
  SketchArt,
  SketchButton,
  SketchDialog,
  SketchInput,
  hashSeed,
} from "../../../components/sketch";
import {
  TEMPLATES,
  UNTITLED_TEMPLATE,
  buildTemplate,
  type Template,
  type TemplateCategory,
} from "./templates";

const PREVIEW_STYLE = {
  strokeColor: "#1e1e1e",
  strokeWidth: 2,
  roughness: 1,
  fillStyle: "hachure",
  fontFamily: 5,
  paper: "#ffffff",
} as const;
const CATEGORIES: readonly TemplateCategory[] = ["Flowcharts", "Planning", "Diagrams"];

/** Elements drawn by Excalidraw itself, on a light "paper" card in both themes like board thumbnails. */
function Preview({ elements }: { elements: readonly ExcalidrawElement[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    exportToSvg({
      elements: elements.filter((el) => !el.isDeleted),
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
        // The name still says what it is.
      });
    return () => {
      cancelled = true;
    };
  }, [elements]);
  return <div ref={ref} className="ud-template__preview" />;
}

function BuiltIn({ template, onPick }: { template: Template; onPick: () => void }) {
  const elements = useMemo(() => buildTemplate(template, { x: 0, y: 0 }, PREVIEW_STYLE), [template]);
  return (
    <button type="button" className="ud-template ud-sketch" onClick={onPick}>
      <SketchArt
        seed={hashSeed(`template:${template.id}`)}
        shape="rect"
        fillStyle="solid"
        strokeWidth={1.5}
      />
      <Preview elements={elements} />
      <span className="ud-template__name">{template.name}</span>
      <span className="ud-template__description">{template.description}</span>
    </button>
  );
}

/**
 * Toolbar → Templates, or Main menu → "Templates…" (EDIT-8): the built-in
 * templates by kind, then mine (my library). Mount it only while open.
 */
export function TemplatesDialog({
  mine,
  onClose,
  onPick,
  onPickMine,
  onRemoveMine,
  onSaveSelection,
}: {
  mine: LibraryItems;
  onClose: () => void;
  onPick: (template: Template) => void;
  onPickMine: (item: LibraryItem) => void;
  onRemoveMine: (item: LibraryItem) => void;
  /** Present while shapes are selected on the board. */
  onSaveSelection?: () => void;
}) {
  const pick = (run: () => void) => {
    run();
    onClose();
  };
  return (
    <SketchDialog open onClose={onClose} title="Templates" seedKey="templates" width={820}>
      <p className="mb-4 text-ink-muted">Pick one to start from. Every shape and arrow stays editable.</p>
      <div className="ud-templates__scroll">
        {CATEGORIES.map((category) => (
          <section key={category} className="ud-templates__section" aria-labelledby={`templates-${category}`}>
            <h3 id={`templates-${category}`} className="ud-templates__heading">
              {category}
            </h3>
            <ul className="ud-templates">
              {TEMPLATES.filter((t) => t.category === category).map((template) => (
                <li key={template.id}>
                  <BuiltIn template={template} onPick={() => pick(() => onPick(template))} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="ud-templates__section" aria-labelledby="templates-mine">
          <div className="ud-templates__head">
            <h3 id="templates-mine" className="ud-templates__heading">
              My templates
            </h3>
            {onSaveSelection ? (
              <SketchButton
                size="sm"
                icon={<IconDeviceFloppy size={18} stroke={1.75} />}
                onClick={onSaveSelection}
              >
                Save selected shapes
              </SketchButton>
            ) : null}
          </div>
          {mine.length === 0 ? (
            <p className="ud-field__hint">
              Select shapes on the board and choose “Save selected shapes” (or Main menu → “Save as
              template…”) to keep them here. They’re saved to your account.
            </p>
          ) : (
            <ul className="ud-templates">
              {mine.map((item) => {
                const name = item.name || UNTITLED_TEMPLATE;
                return (
                  <li key={item.id} className="ud-template__mine">
                    <button
                      type="button"
                      className="ud-template ud-sketch"
                      onClick={() => pick(() => onPickMine(item))}
                    >
                      <SketchArt
                        seed={hashSeed(`mine:${item.id}`)}
                        shape="rect"
                        fillStyle="solid"
                        strokeWidth={1.5}
                      />
                      <Preview elements={item.elements} />
                      <span className="ud-template__name">{name}</span>
                    </button>
                    <IconButton
                      label={`Remove “${name}”`}
                      className="ud-template__remove"
                      onClick={() => onRemoveMine(item)}
                    >
                      <IconTrash size={16} stroke={1.75} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </SketchDialog>
  );
}

/** Names the selected shapes before they're saved as a template. Mount it only while open. */
export function SaveTemplateDialog({
  count,
  skippedImages,
  onClose,
  onSave,
}: {
  count: number;
  skippedImages: number;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(name.trim().slice(0, 80) || UNTITLED_TEMPLATE);
    onClose();
  };
  return (
    <SketchDialog
      open
      onClose={onClose}
      title="Save as template"
      seedKey="save-template"
      initialFocusRef={inputRef}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <SketchInput
          ref={inputRef}
          label="Template name"
          value={name}
          maxLength={80}
          placeholder={UNTITLED_TEMPLATE}
          onChange={(e) => setName(e.target.value)}
          hint={
            `${count} ${count === 1 ? "shape" : "shapes"} go into it.` +
            (skippedImages > 0 ? ` Images stay on this board and are left out.` : "")
          }
        />
        <div className="flex justify-end gap-3">
          <SketchButton onClick={onClose}>Cancel</SketchButton>
          <SketchButton type="submit" variant="primary">
            Save template
          </SketchButton>
        </div>
      </form>
    </SketchDialog>
  );
}
