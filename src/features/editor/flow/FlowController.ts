import { CaptureUpdateAction, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Box } from "../table/controller";
import { addLane, addNextStep, deleteLane, flowKind, isFlowNode, laneStack, type Direction } from "./flow";

type El = ExcalidrawElement;

export interface FlowUi {
  /** A selected step: "+" buttons go around it. */
  node: { id: string; box: Box } | null;
  /** A selected swimlane (its header or body): the lane bar goes by its header. */
  lane: { id: string; box: Box; canDelete: boolean } | null;
}

/**
 * Where a new shape must be (px inside the editor) to type into it in place:
 * clear of the toolbar, the footer and the style panel on the left.
 */
const SAFE = { left: 240, right: 80, top: 100, bottom: 100 };

/**
 * Growing flowcharts on the canvas (EDIT-8): "+" buttons around a selected
 * step add the next one, and a bar on a selected swimlane adds or removes
 * lanes. New shapes go straight into typing their label.
 */
export class FlowController {
  private api: ExcalidrawImperativeAPI | null = null;
  private host: HTMLElement | null = null;
  private ui: FlowUi = { node: null, lane: null };
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
    if (type) this.startTyping(selectId);
  }

  /**
   * Opens the label editor on a new shape, the way a double-click on it
   * would (Excalidraw has no API for this). Scrolls it into view first.
   */
  private startTyping(id: string) {
    const api = this.api;
    const host = this.host;
    if (!api || !host) return;
    const center = () => {
      const el = api.getSceneElements().find((e) => e.id === id);
      return el
        ? sceneCoordsToViewportCoords(
            { sceneX: el.x + el.width / 2, sceneY: el.y + el.height / 2 },
            api.getAppState(),
          )
        : null;
    };
    const open = () => {
      const p = center();
      // The topmost canvas under the point is the one Excalidraw listens on,
      // even where a panel covers it.
      const target = p
        ? document.elementsFromPoint(p.x, p.y).find((n) => n instanceof HTMLCanvasElement && host.contains(n))
        : null;
      if (!p || !target) return;
      target.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
          view: window,
        }),
      );
    };
    requestAnimationFrame(() => {
      const p = center();
      if (!p) return;
      const r = host.getBoundingClientRect();
      const clear =
        p.x > r.left + SAFE.left &&
        p.x < r.right - SAFE.right &&
        p.y > r.top + SAFE.top &&
        p.y < r.bottom - SAFE.bottom;
      if (clear) {
        open();
        return;
      }
      const el = api.getSceneElements().find((e) => e.id === id);
      if (el) api.scrollToContent(el, { animate: false });
      requestAnimationFrame(() => requestAnimationFrame(open));
    });
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
    const none = { node: null, lane: null };
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
      this.set({ node: { id: el.id, box: this.toBox(s, el) }, lane: null });
      return;
    }
    const kind = flowKind(el);
    const stack = el && (kind === "lane" || kind === "laneHead") ? laneStack(elements, el.id) : null;
    if (el && stack) {
      const lane = stack.lanes[stack.index]!;
      this.set({
        node: null,
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
