import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI, LibraryItem } from "@excalidraw/excalidraw/types";
import { cloneElements } from "../../library/clone";
import { centeredIn } from "../canvas";
import { paperColor } from "../table/options";
import { buildTemplate, templateBounds, type Template } from "./templates";

/** Adds elements to the board, selected, with the selection tool picked. One undo step. */
function place(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[]) {
  // Selecting a shape selects its label; Excalidraw doesn't list bound text itself.
  const selected = elements.filter((el) => el.type !== "text" || !el.containerId);
  api.setActiveTool({ type: "selection" });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(selected.map((el) => [el.id, true as const])),
      selectedGroupIds: {},
      editingGroupId: null,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Drops a template in the middle of the view in the current drawing style. */
export function insertTemplate(api: ExcalidrawImperativeAPI, template: Template) {
  const s = api.getAppState();
  const { width, height } = templateBounds(template);
  place(
    api,
    buildTemplate(template, centeredIn(s, width, height), {
      strokeColor: s.currentItemStrokeColor,
      strokeWidth: s.currentItemStrokeWidth,
      roughness: s.currentItemRoughness,
      fillStyle: s.currentItemFillStyle,
      fontFamily: s.currentItemFontFamily,
      paper: paperColor(s),
    }),
  );
}

/** Drops one of my saved templates (a library item) in the middle of the view, as a fresh copy. */
export function insertSaved(api: ExcalidrawImperativeAPI, item: LibraryItem) {
  const live = item.elements.filter((el) => !el.isDeleted);
  if (live.length === 0) return;
  const [x1, y1, x2, y2] = getCommonBounds(live);
  place(api, cloneElements(live, centeredIn(api.getAppState(), x2 - x1, y2 - y1)));
}
