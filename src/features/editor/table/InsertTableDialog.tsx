import { useRef, useState, type FormEvent } from "react";
import { SketchButton, SketchDialog, SketchInput } from "../../../components/sketch";
import { TABLE_LIMITS, type TableOptions } from "./table";

const OPTIONS_KEY = "ud:table-options";
const DEFAULTS: TableOptions = { rows: 3, cols: 2, header: true, checkboxes: true };

/** Last-used options on this device, like the drawing style (EDIT-5). */
function loadOptions(): TableOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<TableOptions> | null;
    if (!saved || typeof saved !== "object") return DEFAULTS;
    const inRange = (v: unknown, { min, max }: { min: number; max: number }) =>
      Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    return {
      rows: inRange(saved.rows, TABLE_LIMITS.rows) ? saved.rows! : DEFAULTS.rows,
      cols: inRange(saved.cols, TABLE_LIMITS.cols) ? saved.cols! : DEFAULTS.cols,
      header: typeof saved.header === "boolean" ? saved.header : DEFAULTS.header,
      checkboxes: typeof saved.checkboxes === "boolean" ? saved.checkboxes : DEFAULTS.checkboxes,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveOptions(options: TableOptions) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // ignore
  }
}

/** A whole number within limits, or null. */
function parseCount(raw: string, { min, max }: { min: number; max: number }): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Footer "Table" button / Main menu → "Insert table…" (EDIT-7). Mount it only while open. */
export function InsertTableDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (options: TableOptions) => void;
}) {
  const [initial] = useState(loadOptions);
  const [rows, setRows] = useState(String(initial.rows));
  const [cols, setCols] = useState(String(initial.cols));
  const [header, setHeader] = useState(initial.header);
  const [checkboxes, setCheckboxes] = useState(initial.checkboxes);
  const [showErrors, setShowErrors] = useState(false);
  const rowsRef = useRef<HTMLInputElement>(null);

  const rowCount = parseCount(rows, TABLE_LIMITS.rows);
  const colCount = parseCount(cols, TABLE_LIMITS.cols);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (rowCount === null || colCount === null) {
      setShowErrors(true);
      return;
    }
    const options = { rows: rowCount, cols: colCount, header, checkboxes };
    saveOptions(options);
    onInsert(options);
    onClose();
  };

  return (
    <SketchDialog
      open
      onClose={onClose}
      title="Insert a table"
      seedKey="table"
      initialFocusRef={rowsRef}
      width={420}
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
        <p className="ud-field__hint">Double-click a cell to type in it. Click a box to tick it.</p>
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
