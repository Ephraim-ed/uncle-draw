import { CaptureUpdateAction, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import {
  buildTable,
  checkboxAt,
  fitRow,
  hasCheckbox,
  tablePart,
  tableSize,
  toggleCheckbox,
  type TableOptions,
} from "./table";

/** Extra reach around each checkbox, in screen pixels, so boxes are easy to hit with a finger. */
const BOX_SLOP_PX = 6;
/** A press that travels further than this is a drag, not a click. */
const TAP_SLOP_PX = 8;

/**
 * Drops a new table in the middle of the view and selects it (EDIT-7).
 * One undo step removes it again.
 */
export function insertTable(api: ExcalidrawImperativeAPI, options: TableOptions) {
  const s = api.getAppState();
  const center = viewportCoordsToSceneCoords(
    { clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 },
    s,
  );
  const { width, height } = tableSize(options);
  const snap = (v: number) => (s.gridModeEnabled && s.gridSize ? Math.round(v / s.gridSize) * s.gridSize : v);
  const groupId = crypto.randomUUID();
  const table = buildTable(
    options,
    { x: snap(center.x - width / 2), y: snap(center.y - height / 2) },
    {
      strokeColor: s.currentItemStrokeColor,
      roughness: s.currentItemRoughness,
      fill: s.viewBackgroundColor === "transparent" ? "#ffffff" : s.viewBackgroundColor,
    },
    groupId,
  );
  api.setActiveTool({ type: "selection" });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...table],
    appState: {
      selectedElementIds: Object.fromEntries(table.map((el) => [el.id, true as const])),
      selectedGroupIds: { [groupId]: true },
      editingGroupId: null,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/**
 * Table behavior on top of Excalidraw (EDIT-7), using only its imperative API
 * and DOM events on our own wrapper:
 * - A plain click on a checkbox ticks it. The press never reaches Excalidraw,
 *   so it doesn't select, drag or start a text box. Shift/Ctrl/Alt-click still
 *   selects the box itself.
 * - Double-clicking a cell types in it, one step instead of Excalidraw's two
 *   (enter the group, then edit).
 * - When typing makes a cell taller, the rest of its row follows (fitRow).
 */
export function useTables(api: ExcalidrawImperativeAPI | null, host: HTMLElement | null) {
  useEffect(() => {
    if (!api || !host) return;

    /** The checkbox a plain selection-tool click at this spot would tick. */
    const boxAt = (
      target: EventTarget | null,
      clientX: number,
      clientY: number,
    ): ExcalidrawElement | null => {
      if (!(target instanceof HTMLCanvasElement) || !host.contains(target)) return null;
      const s = api.getAppState();
      if (
        s.viewModeEnabled ||
        s.activeTool.type !== "selection" ||
        s.editingTextElement ||
        s.editingLinearElement ||
        s.newElement ||
        s.multiElement ||
        s.croppingElementId
      ) {
        return null;
      }
      const p = viewportCoordsToSceneCoords({ clientX, clientY }, s);
      return checkboxAt(api.getSceneElements(), p, BOX_SLOP_PX / s.zoom.value);
    };
    const plain = (e: MouseEvent | TouchEvent) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

    let press: { pointerId: number; boxId: string; x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (press) {
        // A second finger: this is a pinch, not a tick.
        press = null;
        return;
      }
      if (e.button !== 0 || !plain(e)) return;
      const box = boxAt(e.target, e.clientX, e.clientY);
      if (!box) return;
      e.stopPropagation();
      e.preventDefault();
      press = { pointerId: e.pointerId, boxId: box.id, x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.pointerId) return;
      const { boxId, x, y } = press;
      press = null;
      e.stopPropagation();
      if (Math.hypot(e.clientX - x, e.clientY - y) > TAP_SLOP_PX) return;
      if (boxAt(e.target, e.clientX, e.clientY)?.id !== boxId) return;
      api.updateScene({
        elements: toggleCheckbox(api.getSceneElementsIncludingDeleted(), boxId),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    };

    // A release outside the editor never reaches the wrapper.
    const onPointerEnd = (e: PointerEvent) => {
      if (
        press?.pointerId === e.pointerId &&
        (e.type === "pointercancel" || !host.contains(e.target as Node))
      ) {
        press = null;
      }
    };

    // Two quick ticks are a double-click (or double-tap) to Excalidraw, which
    // would drop a new text box on the checkbox. The ticks already happened.
    const onDoubleClick = (e: MouseEvent) => {
      if (e.isTrusted && plain(e) && boxAt(e.target, e.clientX, e.clientY)) e.stopPropagation();
    };
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches.length === 1 ? e.touches[0] : undefined;
      if (touch && boxAt(e.target, touch.clientX, touch.clientY)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    // Runs after Excalidraw has set its own cursor for this move.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.buttons === 0 && plain(e) && boxAt(e.target, e.clientX, e.clientY)) {
        api.setCursor("pointer");
      }
    };

    // Excalidraw's first double-click on a table enters its group and selects
    // the cell; finish the job by double-clicking again, which edits the text.
    let followUp: ReturnType<typeof setTimeout> | undefined;
    const onDoubleClickDone = (e: MouseEvent) => {
      const target = e.target;
      if (!e.isTrusted || !(target instanceof HTMLCanvasElement) || !host.contains(target)) return;
      const { clientX, clientY } = e;
      clearTimeout(followUp);
      followUp = setTimeout(() => {
        const s = api.getAppState();
        const ids = Object.keys(s.selectedElementIds);
        if (!s.editingGroupId || s.editingTextElement || ids.length !== 1 || !target.isConnected) return;
        const elements = api.getSceneElements();
        let cell = elements.find((el) => el.id === ids[0]);
        if (cell?.type === "text" && cell.containerId) {
          const containerId = cell.containerId;
          cell = elements.find((el) => el.id === containerId);
        }
        if (!cell || tablePart(cell) !== "cell" || cell.groupIds[0] !== s.editingGroupId) return;
        if (hasCheckbox(elements, cell)) return;
        target.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, view: window }),
        );
      }, 0);
    };

    // When a cell's text editor closes, line its row up.
    let editingId: string | null = null;
    let fit: ReturnType<typeof setTimeout> | undefined;
    const stopWatching = api.onChange((_elements, appState) => {
      const now = appState.editingTextElement?.id ?? null;
      if (now === editingId) return;
      const ended = editingId;
      editingId = now;
      if (!ended) return;
      clearTimeout(fit);
      fit = setTimeout(() => {
        const elements = api.getSceneElementsIncludingDeleted();
        const text = elements.find((el) => el.id === ended);
        if (text?.type !== "text" || !text.containerId) return;
        const next = fitRow(elements, text.containerId);
        if (next) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      }, 0);
    });

    const capture = { capture: true };
    const activeCapture = { capture: true, passive: false };
    host.addEventListener("pointerdown", onPointerDown, capture);
    host.addEventListener("pointerup", onPointerUp, capture);
    host.addEventListener("dblclick", onDoubleClick, capture);
    host.addEventListener("touchstart", onTouchStart, activeCapture);
    window.addEventListener("pointerup", onPointerEnd, capture);
    window.addEventListener("pointercancel", onPointerEnd, capture);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("dblclick", onDoubleClickDone);
    return () => {
      clearTimeout(followUp);
      clearTimeout(fit);
      stopWatching();
      host.removeEventListener("pointerdown", onPointerDown, capture);
      host.removeEventListener("pointerup", onPointerUp, capture);
      host.removeEventListener("dblclick", onDoubleClick, capture);
      host.removeEventListener("touchstart", onTouchStart, activeCapture);
      window.removeEventListener("pointerup", onPointerEnd, capture);
      window.removeEventListener("pointercancel", onPointerEnd, capture);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("dblclick", onDoubleClickDone);
    };
  }, [api, host]);
}
