import { IconPlus, IconRowInsertBottom, IconRowInsertTop, IconRowRemove } from "@tabler/icons-react";
import { useSyncExternalStore, type MouseEvent } from "react";
import { IconButton, SketchArt, hashSeed } from "../../../components/sketch";
import { leftEdge } from "../overlay";
import type { Box } from "../table/controller";
import type { Direction } from "./flow";
import type { FlowController, FlowUi } from "./FlowController";

/** How far (px) outside the step its "+" buttons sit: past Excalidraw's resize handles, and its rotate handle on top. */
const HANDLE_OFFSET = 34;
const TOP_HANDLE_OFFSET = 50;
const TOP_SAFE = 72;
const ICON = { size: 18, stroke: 1.75 } as const;

const HANDLES: readonly { dir: Direction; label: string; at: (b: Box) => { left: number; top: number } }[] = [
  {
    dir: "right",
    label: "Add next step to the right",
    at: (b) => ({ left: b.left + b.width + HANDLE_OFFSET, top: b.top + b.height / 2 }),
  },
  {
    dir: "down",
    label: "Add next step below",
    at: (b) => ({ left: b.left + b.width / 2, top: b.top + b.height + HANDLE_OFFSET }),
  },
  {
    dir: "left",
    label: "Add next step to the left",
    at: (b) => ({ left: b.left - HANDLE_OFFSET, top: b.top + b.height / 2 }),
  },
  {
    dir: "up",
    label: "Add next step above",
    at: (b) => ({ left: b.left + b.width / 2, top: b.top - TOP_HANDLE_OFFSET }),
  },
];

/** Clicking these keeps keyboard focus on the canvas. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Flowchart growing tools on the canvas (EDIT-8). */
export function FlowOverlay({ controller }: { controller: FlowController }) {
  const ui = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <>
      {ui.node ? <StepHandles box={ui.node.box} onAdd={controller.addStep} /> : null}
      {ui.arrow ? (
        <button
          type="button"
          className="ud-flow-add ud-sketch"
          style={{ left: ui.arrow.left, top: ui.arrow.top }}
          aria-label="Insert a step here"
          title="Insert a step here"
          onMouseDown={keepFocus}
          onClick={controller.insertStep}
        >
          <SketchArt seed={hashSeed("flow-add:insert")} shape="circle" fillStyle="solid" strokeWidth={1.5} />
          <IconPlus size={14} stroke={2.5} />
        </button>
      ) : null}
      {ui.lane ? <LaneBar lane={ui.lane} controller={controller} /> : null}
    </>
  );
}

function StepHandles({ box, onAdd }: { box: Box; onAdd: (dir: Direction) => void }) {
  return (
    <>
      {HANDLES.map(({ dir, label, at }) => (
        <button
          key={dir}
          type="button"
          className="ud-flow-add ud-sketch"
          style={at(box)}
          aria-label={label}
          title={label}
          onMouseDown={keepFocus}
          onClick={() => onAdd(dir)}
        >
          <SketchArt seed={hashSeed(`flow-add:${dir}`)} shape="circle" fillStyle="solid" strokeWidth={1.5} />
          <IconPlus size={14} stroke={2.5} />
        </button>
      ))}
    </>
  );
}

function LaneBar({ lane, controller }: { lane: NonNullable<FlowUi["lane"]>; controller: FlowController }) {
  const { box } = lane;
  const above = box.top - 56;
  const style = {
    left: Math.max(leftEdge(), box.left),
    top: above < TOP_SAFE ? box.top + box.height + 12 : above,
  };
  return (
    <div
      role="toolbar"
      aria-label="Swimlane"
      className="ud-shell ud-floatbar ud-sketch"
      style={style}
      onMouseDown={keepFocus}
    >
      <SketchArt seed={hashSeed("lanebar")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
      <IconButton label="Add lane above" seedKey="lanebar:above" onClick={() => controller.addLane("above")}>
        <IconRowInsertTop {...ICON} />
      </IconButton>
      <IconButton label="Add lane below" seedKey="lanebar:below" onClick={() => controller.addLane("below")}>
        <IconRowInsertBottom {...ICON} />
      </IconButton>
      <IconButton
        label={lane.canDelete ? "Delete lane and its steps" : "Delete lane (a chart keeps one lane)"}
        seedKey="lanebar:delete"
        onClick={controller.deleteLane}
        disabled={!lane.canDelete}
      >
        <IconRowRemove {...ICON} />
      </IconButton>
    </div>
  );
}
