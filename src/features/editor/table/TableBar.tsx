import {
  IconColumnInsertLeft,
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
import { IconButton, SketchArt, hashSeed } from "../../../components/sketch";
import type { Box, TableController, TableDraft, TableFocus, TableGuide } from "./controller";
import { ALIGN_OPTIONS, WIDTH_OPTIONS } from "./lookOptions";
import { BORDER_COLORS, FILL_COLORS, PAPER } from "./options";
import { Segmented, Swatches } from "./Swatches";

/** Keep clear of Excalidraw's toolbar (top) and footer (bottom). */
const TOP_SAFE = 72;
const BOTTOM_SAFE = 72;
const GAP = 12;
const EDGE = 8;

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
    Math.max(EDGE, box.left + box.width / 2 - width / 2),
    Math.max(EDGE, vw - width - EDGE),
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

  return (
    <>
      {a ? (
        <div
          className="ud-table-active"
          style={{ left: a.left, top: a.top, width: a.width, height: a.height }}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={ref}
        role="toolbar"
        aria-label="Table"
        className="ud-shell ud-tablebar ud-sketch"
        style={{ left, top, visibility: size.width ? "visible" : "hidden" }}
        onMouseDown={keepFocus}
      >
        <SketchArt seed={hashSeed("tablebar")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
        <BarButton label="Insert row above" onClick={() => controller.insertRow("above")}>
          <IconRowInsertTop {...ICON} />
        </BarButton>
        <BarButton label="Insert row below" onClick={() => controller.insertRow("below")}>
          <IconRowInsertBottom {...ICON} />
        </BarButton>
        <BarButton
          label={`Delete row${needsCell}`}
          onClick={controller.deleteRow}
          disabled={!focus.canDeleteRow}
        >
          <IconRowRemove {...ICON} />
        </BarButton>
        <span className="ud-tablebar__divider" />
        <BarButton label="Insert column left" onClick={() => controller.insertCol("left")}>
          <IconColumnInsertLeft {...ICON} />
        </BarButton>
        <BarButton label="Insert column right" onClick={() => controller.insertCol("right")}>
          <IconColumnInsertRight {...ICON} />
        </BarButton>
        <BarButton
          label={`Delete column${needsCell}`}
          onClick={controller.deleteCol}
          disabled={!focus.canDeleteCol}
        >
          <IconColumnRemove {...ICON} />
        </BarButton>
        <span className="ud-tablebar__divider" />
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
        <span className="ud-tablebar__divider" />
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
        <span className="ud-tablebar__divider" />
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
      className="ud-tablebar__panel ud-sketch"
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
      <div className="ud-tablebar__sizes">
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
      {focus.active ? null : <p className="ud-field__hint">Click a cell to size its column and row.</p>}
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
