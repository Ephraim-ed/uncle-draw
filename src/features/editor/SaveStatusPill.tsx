import { IconAlertTriangle, IconCloudCheck, IconCloudOff, IconCloudUpload } from "@tabler/icons-react";
import { SketchArt, hashSeed } from "../../components/sketch";
import { formatClock, formatShortDate } from "../../lib/time";
import type { ErrorReason, SaveStatus } from "./saveQueue";

export interface SaveStatusPillProps {
  status: SaveStatus;
  /** Changes on every save, so the check pops again. */
  nonce?: number;
  /** When the board was last saved (ms), for the tooltip. */
  savedAt?: number | null;
  errorReason: ErrorReason;
  /** Phones show the icon only (§11). */
  iconOnly?: boolean;
  /** False when IndexedDB is unavailable: offline changes aren't kept locally. */
  backupAvailable?: boolean;
  onRetry: () => void;
}

function label(status: SaveStatus, errorReason: ErrorReason, backupAvailable: boolean): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "saving":
      return "Saving…";
    case "offline":
      return backupAvailable ? "Offline · saved on this device" : "Offline · will sync when you're back";
    case "error":
      return errorReason === "tooLarge" ? "Too big to save · keeping a copy here" : "Couldn't save";
  }
}

/** "Saved at 3:42 PM" today, "Saved Oct 13" before that. */
function savedHint(savedAt: number | null | undefined): string {
  if (!savedAt) return "All changes saved";
  const sameDay = new Date(savedAt).toDateString() === new Date().toDateString();
  return sameDay
    ? `Saved at ${formatClock(savedAt)}`
    : `Saved ${formatShortDate(new Date(savedAt).toISOString())}`;
}

function StatusIcon({ status }: { status: SaveStatus }) {
  switch (status) {
    case "saved":
      return <IconCloudCheck size={18} stroke={1.75} />;
    case "saving":
      return <IconCloudUpload size={18} stroke={1.75} />;
    case "offline":
      return <IconCloudOff size={18} stroke={1.75} className="text-warning" />;
    case "error":
      return <IconAlertTriangle size={18} stroke={1.75} />;
  }
}

/**
 * Save status (SAVE-2; tech §7.3; VISUAL_DESIGN.md §9.1).
 *
 * - Saving / saved are quiet: a cloud icon and a muted label, no box (it's a
 *   status, not a button). Both labels share one fixed-width slot, so the top
 *   bar never shifts while autosave runs. The tooltip says when it last saved.
 * - Offline and errors need attention: a rough pill with the full message.
 * - Phones: icon only, in a small pill so it reads over the canvas.
 */
export function SaveStatusPill({
  status,
  nonce = 0,
  savedAt,
  errorReason,
  iconOnly = false,
  backupAvailable = true,
  onRetry,
}: SaveStatusPillProps) {
  const text = label(status, errorReason, backupAvailable);
  const calm = status === "saved" || status === "saving";
  const hint = status === "saved" ? savedHint(savedAt) : status === "saving" ? "Saving your changes…" : text;
  // Keyed so each finished save replays the pop.
  const icon = (
    <span key={status === "saved" ? `saved-${nonce}` : status} className="ud-status__icon" aria-hidden="true">
      <StatusIcon status={status} />
    </span>
  );

  return (
    <div className="ud-pill-wrap" data-status={status}>
      {calm && !iconOnly ? (
        <span className="ud-status" title={hint}>
          {icon}
          {/* Both labels occupy the same grid cell: the slot is as wide as the longer one. */}
          <span className="ud-status__labels" aria-hidden="true">
            <span className={status === "saving" ? undefined : "ud-status__ghost"}>Saving…</span>
            <span className={status === "saved" ? undefined : "ud-status__ghost"}>Saved</span>
          </span>
        </span>
      ) : (
        <span
          className={`ud-pill ud-sketch${iconOnly ? " ud-pill--icon" : ""}${status === "error" ? " ud-pill--danger" : ""}`}
          title={hint}
        >
          <SketchArt seed={hashSeed("save-pill")} shape="roundRect" radius={12} fillStyle="solid" />
          {icon}
          {iconOnly ? null : <span className="ud-pill__text">{text}</span>}
        </span>
      )}
      {status === "error" && errorReason !== "tooLarge" ? (
        <button type="button" className="ud-pill__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {/* Polite live region for status changes (SAVE-2). */}
      <span className="ud-visually-hidden" aria-live="polite" role="status">
        {status === "saving" ? "" : text}
      </span>
    </div>
  );
}
