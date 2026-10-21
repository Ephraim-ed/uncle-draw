import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { centeredIn } from "../canvas";
import { buildTemplate, templateBounds, type FlowchartTemplate } from "./flowcharts";

/** Drops a template in the middle of the view in the current drawing style, selected. One undo step. */
export function insertTemplate(api: ExcalidrawImperativeAPI, template: FlowchartTemplate) {
  const s = api.getAppState();
  const { width, height } = templateBounds(template);
  const elements = buildTemplate(template, centeredIn(s, width, height), {
    strokeColor: s.currentItemStrokeColor,
    strokeWidth: s.currentItemStrokeWidth,
    roughness: s.currentItemRoughness,
    fillStyle: s.currentItemFillStyle,
    fontFamily: s.currentItemFontFamily,
  });
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
