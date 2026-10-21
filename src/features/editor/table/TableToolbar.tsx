import { IconSitemap, IconTable } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import type { TableController } from "./controller";

/** Tool buttons in Excalidraw's own markup, so they look and behave like its tools. */
export function TableToolbarButtons({
  controller,
  onTemplates,
}: {
  controller: TableController;
  onTemplates: () => void;
}) {
  const { toolActive } = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <>
      <label className="ToolIcon Shape ToolIcon_size_medium" title="Table — B (drag to draw one)">
        <input
          className="ToolIcon_type_radio ToolIcon_size_medium"
          type="radio"
          name="ud-table-tool"
          checked={toolActive}
          onChange={controller.activateTool}
          aria-label="Table"
          aria-keyshortcuts="B"
          data-testid="toolbar-table"
        />
        <div className="ToolIcon__icon">
          <IconTable stroke={1.5} />
          <span className="ToolIcon__keybinding">B</span>
        </div>
      </label>
      <button
        type="button"
        className="ToolIcon ToolIcon_type_button ToolIcon_size_medium ToolIcon_type_button--show ud-toolbar-templates"
        title="Flowchart templates"
        aria-label="Flowchart templates"
        data-testid="toolbar-templates"
        onClick={onTemplates}
      >
        <div className="ToolIcon__icon" aria-hidden="true">
          <IconSitemap stroke={1.5} />
        </div>
      </button>
    </>
  );
}
