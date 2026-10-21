import { useRef, useState, type FormEvent } from "react";
import { SketchButton, SketchDialog, SketchInput } from "../../../components/sketch";
import { ALIGN_OPTIONS, WIDTH_OPTIONS } from "./lookOptions";
import {
  BORDER_COLORS,
  FILL_COLORS,
  TABLE_LIMITS,
  loadSetup,
  saveSetup,
  type LookChoice,
  type TableSetup,
} from "./options";
import { Segmented, Swatches } from "./Swatches";

/** A whole number within limits, or null. */
function parseCount(raw: string, { min, max }: { min: number; max: number }): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Main menu → "Insert table…", or the footer fallback (EDIT-7). Mount it only while open. */
export function InsertTableDialog({
  paper,
  onClose,
  onInsert,
}: {
  /** The canvas color, shown on the "Canvas color" chip. */
  paper: string;
  onClose: () => void;
  onInsert: (setup: TableSetup) => void;
}) {
  const [initial] = useState(loadSetup);
  const [rows, setRows] = useState(String(initial.rows));
  const [cols, setCols] = useState(String(initial.cols));
  const [header, setHeader] = useState(initial.header);
  const [checkboxes, setCheckboxes] = useState(initial.checkboxes);
  const [look, setLook] = useState<LookChoice>(initial.look);
  const [showErrors, setShowErrors] = useState(false);
  const rowsRef = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<LookChoice>) => setLook((l) => ({ ...l, ...patch }));

  const rowCount = parseCount(rows, TABLE_LIMITS.rows);
  const colCount = parseCount(cols, TABLE_LIMITS.cols);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (rowCount === null || colCount === null) {
      setShowErrors(true);
      return;
    }
    const setup = { rows: rowCount, cols: colCount, header, checkboxes, look };
    saveSetup(setup);
    onInsert(setup);
    onClose();
  };

  return (
    <SketchDialog
      open
      onClose={onClose}
      title="Insert a table"
      seedKey="table"
      initialFocusRef={rowsRef}
      width={480}
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <SketchInput
            ref={rowsRef}
            label="Rows"
            type="number"
            inputMode="numeric"
            min={TABLE_LIMITS.rows.min}
            max={TABLE_LIMITS.rows.max}
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            error={showErrors && rowCount === null ? `Pick 1 to ${TABLE_LIMITS.rows.max} rows.` : undefined}
          />
          <SketchInput
            label="Columns"
            type="number"
            inputMode="numeric"
            min={TABLE_LIMITS.cols.min}
            max={TABLE_LIMITS.cols.max}
            value={cols}
            onChange={(e) => setCols(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            error={
              showErrors && colCount === null ? `Pick 1 to ${TABLE_LIMITS.cols.max} columns.` : undefined
            }
          />
        </div>
        <div className="flex flex-col gap-3">
          <label className="ud-check">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
            Header row on top
          </label>
          <label className="ud-check">
            <input type="checkbox" checked={checkboxes} onChange={(e) => setCheckboxes(e.target.checked)} />
            Checkbox at the start of each row
          </label>
        </div>
        <div className="flex flex-col gap-3">
          <Swatches
            label="Header color"
            value={look.headerFill}
            colors={FILL_COLORS}
            paper={paper}
            onChange={(headerFill) => change({ headerFill })}
            disabled={!header}
          />
          <Swatches
            label="Cell color"
            value={look.cellFill}
            colors={FILL_COLORS}
            paper={paper}
            onChange={(cellFill) => change({ cellFill })}
          />
          <Swatches
            label="Border color"
            value={look.border}
            colors={BORDER_COLORS}
            paper={paper}
            onChange={(border) => change({ border })}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Segmented
              label="Border width"
              value={look.borderWidth}
              options={WIDTH_OPTIONS}
              onChange={(borderWidth) => change({ borderWidth })}
            />
            <Segmented
              label="Text"
              value={look.align}
              options={ALIGN_OPTIONS}
              onChange={(align) => change({ align })}
            />
          </div>
        </div>
        <p className="ud-field__hint">
          Double-click a cell to type in it, and click a box to tick it. Drag the grid lines to resize.
        </p>
        <div className="flex justify-end gap-3">
          <SketchButton onClick={onClose}>Cancel</SketchButton>
          <SketchButton type="submit" variant="primary">
            Insert table
          </SketchButton>
        </div>
      </form>
    </SketchDialog>
  );
}
