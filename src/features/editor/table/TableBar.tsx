import {
  IconArrowsSort,
  IconColumnInsertLeft,
  IconCopy,
  IconGripVertical,
  IconColumnInsertRight,
  IconColumnRemove,
  IconLayoutNavbar,
  IconListCheck,
  IconPalette,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRowRemove,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { IconButton, SketchArt, SketchMenu, hashSeed, useToast } from "../../../components/sketch";
import { leftEdge } from "../overlay";
import type { Box, TableController, TableDraft, TableFocus, TableGuide } from "./controller";
import { ALIGN_OPTIONS, WIDTH_OPTIONS } from "./lookOptions";
import { BORDER_COLORS, FILL_COLORS, PAPER } from "./options";
import { Segmented, Swatches } from "./Swatches";

/** Keep clear of Excalidraw's toolbar (top) and footer (bottom). */
const TOP_SAFE = 72;
const BOTTOM_SAFE = 72;
const GAP = 12;
const EDGE = 8;
/** Colors a picked cell can be highlighted with (Excalidraw's light quick picks). */
const HIGHLIGHTS = ["#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#e9ecef"] as const;

/** Table tools on the canvas (EDIT-7): the bar over a selected table, its active cell, and the table tool's preview. */
export function TableBar({ controller }: { controller: TableController }) {
  const ui = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <>
      {ui.draft ? <Draft draft={ui.draft} /> : null}
      {ui.guide ? <Guide guide={ui.guide} /> : null}
      {ui.focus ? (
        <Bar key={ui.focus.groupId} focus={ui.focus} paper={ui.paper} controller={controller} />
      ) : null}
    </>
  );
}

const offsets = (sizes: readonly number[]) =>
  sizes.slice(0, -1).map((_, i) => sizes.slice(0, i + 1).reduce((a, b) => a + b, 0));

function Draft({ draft }: { draft: TableDraft }) {
  const { box } = draft;
  return (
    <div
      className="ud-table-draft"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-hidden="true"
    >
      {offsets(draft.cols).map((x) => (
        <span key={`c${x}`} className="ud-table-draft__col" style={{ left: x }} />
      ))}
      {offsets(draft.rows).map((y) => (
        <span key={`r${y}`} className="ud-table-draft__row" style={{ top: y }} />
      ))}
      <span className="ud-table-draft__label">{draft.label}</span>
    </div>
  );
}

function Guide({ guide }: { guide: TableGuide }) {
  const { box } = guide;
  return (
    <div
      className="ud-table-guide"
      data-kind={guide.kind}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-hidden="true"
    >
      <span className="ud-table-guide__label">{guide.label}</span>
    </div>
  );
}

function onScreen(box: Box) {
  return (
    box.left < window.innerWidth &&
    box.left + box.width > 0 &&
    box.top < window.innerHeight &&
    box.top + box.height > 0
  );
}

/** Above the table, or below it when there's no room, kept inside the window. */
function place(box: Box, width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = box.top - height - GAP;
  if (top < TOP_SAFE) top = box.top + box.height + GAP;
  if (top + height > vh - BOTTOM_SAFE)
    top = Math.max(TOP_SAFE, Math.min(vh - BOTTOM_SAFE - height, box.top + GAP));
  const left = Math.min(
    Math.max(leftEdge(), box.left + box.width / 2 - width / 2),
    Math.max(leftEdge(), vw - width - EDGE),
  );
  return { top, left, up: top > vh / 2 };
}

/** Clicking the bar keeps keyboard focus on the canvas, so Ctrl+Z and Delete still work. */
function keepFocus(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest("input, select, textarea")) e.preventDefault();
}

function BarButton({
  label,
  onClick,
  pressed,
  expanded,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <IconButton
      label={label}
      seedKey={`tablebar:${label}`}
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
    >
      {children}
    </IconButton>
  );
}

const ICON = { size: 18, stroke: 1.75 } as const;

function Bar({
  focus,
  paper,
  controller,
}: {
  focus: TableFocus;
  paper: string;
  controller: TableController;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [styleOpen, setStyleOpen] = useState(false);
  const { toast } = useToast();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The style panel closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!styleOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setStyleOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStyleOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [styleOpen]);

  if (!onScreen(focus.box)) return null;
  const { top, left, up } = place(focus.box, size.width, size.height);
  const needsCell = focus.active ? "" : " (click a cell first)";
  const a = focus.activeBox;

  const rows = focus.multiple ? "rows" : "row";
  const cols = focus.multiple ? "columns" : "column";
  const copy = (kind: "spreadsheet" | "markdown") => {
    const copied = controller.copyText(kind);
    if (!copied) return;
    navigator.clipboard.writeText(copied.text).then(
      () =>
        toast({
          message: `Copied ${copied.rows} ${copied.rows === 1 ? "row" : "rows"}${kind === "markdown" ? " as Markdown" : ""}.`,
        }),
      () => toast({ message: "Hmm, that didn't copy. Try again." }),
    );
  };

  return (
    <>
      {focus.pickedBoxes.map((b, i) => (
        <div
          key={i}
          className="ud-table-picked"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          aria-hidden="true"
        />
      ))}
      {a ? (
        <div
          className="ud-table-active"
          style={{ left: a.left, top: a.top, width: a.width, height: a.height }}
          aria-hidden="true"
        />
      ) : null}
      <RowGrip focus={focus} onMove={controller.moveRow} />
      <div
        ref={ref}
        role="toolbar"
        aria-label="Table"
        className="ud-shell ud-floatbar ud-sketch"
        style={{ left, top, visibility: size.width ? "visible" : "hidden" }}
        onMouseDown={keepFocus}
      >
        <SketchArt seed={hashSeed("tablebar")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
        {focus.progress ? (
          <>
            <span className="ud-floatbar__progress" role="status">
              {focus.progress.done} of {focus.progress.total} done
            </span>
            <span className="ud-floatbar__divider" />
          </>
        ) : null}
        <BarButton label="Insert row above" onClick={() => controller.insertRow("above")}>
          <IconRowInsertTop {...ICON} />
        </BarButton>
        <BarButton label="Insert row below" onClick={() => controller.insertRow("below")}>
          <IconRowInsertBottom {...ICON} />
        </BarButton>
        <BarButton
          label={`Delete ${rows}${needsCell}`}
          onClick={controller.deleteRow}
          disabled={!focus.canDeleteRow}
        >
          <IconRowRemove {...ICON} />
        </BarButton>
        <span className="ud-floatbar__divider" />
        <BarButton label="Insert column left" onClick={() => controller.insertCol("left")}>
          <IconColumnInsertLeft {...ICON} />
        </BarButton>
        <BarButton label="Insert column right" onClick={() => controller.insertCol("right")}>
          <IconColumnInsertRight {...ICON} />
        </BarButton>
        <BarButton
          label={`Delete ${cols}${needsCell}`}
          onClick={controller.deleteCol}
          disabled={!focus.canDeleteCol}
        >
          <IconColumnRemove {...ICON} />
        </BarButton>
        <span className="ud-floatbar__divider" />
        <BarButton
          label="Header row"
          pressed={focus.header}
          onClick={() => controller.setHeader(!focus.header)}
        >
          <IconLayoutNavbar {...ICON} />
        </BarButton>
        <BarButton
          label="Checkbox column"
          pressed={focus.checkCol}
          onClick={() => controller.setCheckCol(!focus.checkCol)}
        >
          <IconListCheck {...ICON} />
        </BarButton>
        <span className="ud-floatbar__divider" />
        {ALIGN_OPTIONS.map((o) => (
          <BarButton
            key={o.value}
            label={o.label}
            pressed={focus.look.align === o.value}
            onClick={() => controller.setLook({ align: o.value })}
          >
            {o.icon}
          </BarButton>
        ))}
        <span className="ud-floatbar__divider" />
        <SketchMenu
          label="Sort rows"
          seedKey="tablebar:sort"
          align="end"
          items={[
            { label: "Sort A → Z", onSelect: () => controller.sort("asc"), disabled: !focus.active },
            { label: "Sort Z → A", onSelect: () => controller.sort("desc"), disabled: !focus.active },
          ]}
          trigger={(props) => (
            <IconButton {...props} label={`Sort by this column${needsCell}`} seedKey="tablebar:sort">
              <IconArrowsSort {...ICON} />
            </IconButton>
          )}
        />
        <SketchMenu
          label="Copy table"
          seedKey="tablebar:copy"
          align="end"
          items={[
            { label: "Copy for spreadsheets", onSelect: () => copy("spreadsheet") },
            { label: "Copy as Markdown", onSelect: () => copy("markdown") },
          ]}
          trigger={(props) => (
            <IconButton
              {...props}
              label={focus.multiple ? "Copy picked cells" : "Copy table"}
              seedKey="tablebar:copy"
            >
              <IconCopy {...ICON} />
            </IconButton>
          )}
        />
        <BarButton label="Table style" expanded={styleOpen} onClick={() => setStyleOpen((open) => !open)}>
          <IconPalette {...ICON} />
        </BarButton>
        <BarButton label="Delete table" onClick={controller.deleteTable}>
          <IconTrash {...ICON} />
        </BarButton>
        {styleOpen ? <StylePanel focus={focus} paper={paper} controller={controller} up={up} /> : null}
      </div>
    </>
  );
}

function StylePanel({
  focus,
  paper,
  controller,
  up,
}: {
  focus: TableFocus;
  paper: string;
  controller: TableController;
  up: boolean;
}) {
  const fill = (color: string) => (color === PAPER ? paper : color);
  return (
    <div
      className="ud-floatbar__panel ud-sketch"
      data-up={up ? "" : undefined}
      role="group"
      aria-label="Table style"
    >
      <SketchArt seed={hashSeed("tablebar:panel")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
      <Swatches
        label="Header color"
        value={focus.look.headerFill}
        colors={FILL_COLORS}
        paper={paper}
        onChange={(c) => controller.setLook({ headerFill: fill(c) })}
        disabled={!focus.header}
      />
      <Swatches
        label="Cell color"
        value={focus.look.cellFill}
        colors={FILL_COLORS}
        paper={paper}
        onChange={(c) => controller.setLook({ cellFill: fill(c) })}
      />
      <Swatches
        label="Border color"
        value={focus.look.border}
        colors={BORDER_COLORS}
        paper={paper}
        onChange={(border) => controller.setLook({ border })}
      />
      <Segmented
        label="Border width"
        value={focus.look.borderWidth}
        options={WIDTH_OPTIONS}
        onChange={(borderWidth) => controller.setLook({ borderWidth })}
      />
      <div className="ud-floatbar__row">
        <Swatches
          label={focus.multiple ? "Highlight cells" : "Highlight cell"}
          value=""
          colors={HIGHLIGHTS}
          paper={paper}
          onChange={(c) => controller.highlight(c)}
          disabled={!focus.active}
        />
        <button
          type="button"
          className="ud-textlink"
          onClick={() => controller.highlight(null)}
          disabled={!focus.active}
        >
          None
        </button>
      </div>
      {focus.checkCol ? (
        <label className="ud-check">
          <input
            type="checkbox"
            checked={focus.look.dimDone}
            onChange={(e) => controller.setLook({ dimDone: e.target.checked })}
          />
          Dim ticked rows
        </label>
      ) : null}
      <div className="ud-floatbar__sizes">
        <SizeField
          label="Column width"
          value={focus.activeSize?.width ?? null}
          onCommit={(v) => controller.setSize("width", v)}
        />
        <SizeField
          label="Row height"
          value={focus.activeSize?.height ?? null}
          onCommit={(v) => controller.setSize("height", v)}
        />
      </div>
      {focus.active ? null : (
        <p className="ud-field__hint">Click a cell to highlight it or size its column and row.</p>
      )}
    </div>
  );
}

/** A px size for the active cell's column or row; applies on Enter or when leaving the field. */
function SizeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number) => void;
}) {
  const shown = value === null ? "" : String(Math.round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(n) && n > 0 && String(Math.round(n)) !== shown) onCommit(n);
  };
  return (
    <label className="ud-sizefield">
      <span className="ud-swatches__label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        disabled={value === null}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

/**
 * A grip by the active row: drag it to move the row (a line shows where it
 * lands), or focus it and use the arrow keys.
 */
function RowGrip({ focus, onMove }: { focus: TableFocus; onMove: (from: number, to: number) => void }) {
  const [drop, setDrop] = useState<number | null>(null);
  const row = focus.active?.row;
  if (row === undefined || (focus.header && row === 0)) return null;
  const box = focus.rowBoxes[row];
  if (!box) return null;
  const first = focus.header ? 1 : 0;
  const boxes = focus.rowBoxes;
  /** The row the pointer would drop before, from its height in the editor. */
  const dropAt = (y: number) => {
    const i = boxes.findIndex((b) => y < b.top + b.height / 2);
    return Math.max(first, i < 0 ? boxes.length : i);
  };
  const lineTop = (i: number) =>
    i < boxes.length ? boxes[i]!.top : boxes[boxes.length - 1]!.top + boxes[boxes.length - 1]!.height;
  return (
    <>
      <button
        type="button"
        className="ud-row-grip"
        style={{ left: box.left - 26, top: box.top + box.height / 2 - 14 }}
        aria-label="Move row (drag, or use the arrow keys)"
        title="Drag to move this row"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrop(row);
        }}
        onPointerMove={(e) => {
          if (drop === null) return;
          const origin =
            (e.currentTarget.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
          setDrop(dropAt(e.clientY - origin));
        }}
        onPointerUp={() => {
          if (drop !== null && drop !== row && drop !== row + 1) onMove(row, drop);
          setDrop(null);
        }}
        onPointerCancel={() => setDrop(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" && row > first) {
            e.preventDefault();
            onMove(row, row - 1);
          } else if (e.key === "ArrowDown" && row < boxes.length - 1) {
            e.preventDefault();
            onMove(row, row + 2);
          }
        }}
      >
        <IconGripVertical size={16} stroke={1.75} />
      </button>
      {drop !== null && drop !== row && drop !== row + 1 ? (
        <div
          className="ud-row-drop"
          style={{ left: box.left, top: lineTop(drop), width: box.width }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
