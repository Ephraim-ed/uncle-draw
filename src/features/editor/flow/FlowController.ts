import { CaptureUpdateAction, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { openLabelEditor } from "../labelEditor";
import type { Box } from "../table/controller";
import {
  addLane,
  addNextStep,
  arrowMiddle,
  deleteLane,
  flowKind,
  insertStep,
  isFlowNode,
  isSplittable,
  laneStack,
  type Direction,
} from "./flow";

type El = ExcalidrawElement;

/** How far (px) the "insert a step" button sits from its arrow. */
const ARROW_BUTTON_OFFSET = 30;

export interface FlowUi {
  /** A selected step: "+" buttons go around it. */
  node: { id: string; box: Box } | null;
  /** A selected swimlane (its header or body): the lane bar goes by its header. */
  lane: { id: string; box: Box; canDelete: boolean } | null;
  /** A selected arrow between two steps: a "+" beside its middle inserts a step. */
  arrow: { id: string; left: number; top: number } | null;
}

/**
 * Growing flowcharts on the canvas (EDIT-8): "+" buttons around a selected
 * step add the next one, and a bar on a selected swimlane adds or removes
 * lanes. New shapes go straight into typing their label.
 */
export class FlowController {
  private api: ExcalidrawImperativeAPI | null = null;
  private host: HTMLElement | null = null;
  private ui: FlowUi = { node: null, lane: null, arrow: null };
  private listeners = new Set<() => void>();
  private frame = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.ui;

  attach(api: ExcalidrawImperativeAPI, host: HTMLElement): () => void {
    this.api = api;
    this.host = host;
    const stopChange = api.onChange(() => this.schedule());
    const stopScroll = api.onScrollChange(() => this.schedule());
    const onResize = () => this.schedule();
    window.addEventListener("resize", onResize);
    this.schedule();
    return () => {
      stopChange();
      stopScroll();
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.api = null;
      this.host = null;
    };
  }

  /** Adds a connected step next to the selected one and starts typing its label. One undo step. */
  addStep = (dir: Direction) => {
    const api = this.api;
    const id = this.ui.node?.id;
    if (!api || !id) return;
    const result = addNextStep(api.getSceneElementsIncludingDeleted(), id, dir);
    if (!result) return;
    this.commit(result.elements, result.stepId);
  };

  /** Splits the selected arrow with a new step and starts typing its label. One undo step. */
  insertStep = () => {
    const api = this.api;
    const id = this.ui.arrow?.id;
    if (!api || !id) return;
    const result = insertStep(api.getSceneElementsIncludingDeleted(), id);
    if (result) this.commit(result.elements, result.stepId);
  };

  /** Adds a swimlane above or below the selected one and starts typing its name. One undo step. */
  addLane = (where: "above" | "below") => {
    const api = this.api;
    const id = this.ui.lane?.id;
    if (!api || !id) return;
    const result = addLane(api.getSceneElementsIncludingDeleted(), id, where);
    if (!result) return;
    this.commit(result.elements, result.headId ?? result.laneId, !!result.headId);
  };

  /** Deletes the selected swimlane with its steps; the lanes below move up. One undo step. */
  deleteLane = () => {
    const api = this.api;
    const id = this.ui.lane?.id;
    if (!api || !id) return;
    const next = deleteLane(api.getSceneElementsIncludingDeleted(), id);
    if (!next) return;
    api.updateScene({
      elements: next,
      appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  private commit(elements: El[], selectId: string, type = true) {
    this.api!.updateScene({
      elements,
      appState: { selectedElementIds: { [selectId]: true }, selectedGroupIds: {}, editingGroupId: null },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    if (type && this.host) openLabelEditor(this.api!, this.host, selectId);
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.refresh);
  };

  private set(next: FlowUi) {
    if (JSON.stringify(next) === JSON.stringify(this.ui)) return;
    this.ui = next;
    this.listeners.forEach((l) => l());
  }

  private refresh = () => {
    this.frame = 0;
    const api = this.api;
    if (!api) return;
    const s = api.getAppState();
    const none = { node: null, lane: null, arrow: null };
    if (
      s.viewModeEnabled ||
      s.activeTool.type !== "selection" ||
      s.editingTextElement ||
      s.selectedElementsAreBeingDragged ||
      s.isResizing ||
      s.isRotating ||
      s.newElement ||
      s.multiElement
    ) {
      this.set(none);
      return;
    }
    const elements = api.getSceneElements();
    const ids = new Set(Object.keys(s.selectedElementIds));
    const selected = elements.filter((el) => ids.has(el.id) && !(el.type === "text" && el.containerId));
    const el = selected.length === 1 ? selected[0]! : null;
    if (el && isFlowNode(el)) {
      this.set({ ...none, node: { id: el.id, box: this.toBox(s, el) } });
      return;
    }
    const middle = el && isSplittable(el, elements) ? arrowMiddle(el) : null;
    if (el && middle) {
      const origin = this.host!.getBoundingClientRect();
      const v = sceneCoordsToViewportCoords({ sceneX: middle.x, sceneY: middle.y }, s);
      // Beside a mostly vertical arrow, above a mostly horizontal one, clear of its own handles.
      const vertical = el.height > el.width;
      this.set({
        ...none,
        arrow: {
          id: el.id,
          left: v.x - origin.left + (vertical ? ARROW_BUTTON_OFFSET : 0),
          top: v.y - origin.top - (vertical ? 0 : ARROW_BUTTON_OFFSET),
        },
      });
      return;
    }
    const kind = flowKind(el);
    const stack = el && (kind === "lane" || kind === "laneHead") ? laneStack(elements, el.id) : null;
    if (el && stack) {
      const lane = stack.lanes[stack.index]!;
      this.set({
        ...none,
        lane: { id: el.id, box: this.toBox(s, lane.head ?? lane.body), canDelete: stack.lanes.length > 1 },
      });
      return;
    }
    this.set(none);
  };

  private toBox(s: AppState, el: El): Box {
    const origin = this.host!.getBoundingClientRect();
    const v = sceneCoordsToViewportCoords({ sceneX: el.x, sceneY: el.y }, s);
    return {
      left: v.x - origin.left,
      top: v.y - origin.top,
      width: el.width * s.zoom.value,
      height: el.height * s.zoom.value,
    };
  }
}
