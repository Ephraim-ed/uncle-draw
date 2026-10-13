import { IconAlertTriangle, IconCheck, IconCloudOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { RoughDrawing, SketchArt, hashSeed } from "../../components/sketch";
import type { ErrorReason, SaveStatus } from "./saveQueue";

export interface SaveStatusPillProps {
  status: SaveStatus;
  /** Changes on every save so "Saved" re-appears before collapsing. */
  nonce?: number;
  errorReason: ErrorReason;
  /** Phones show the icon only (§11). */
  iconOnly?: boolean;
  /** False when IndexedDB is unavailable: offline changes aren't kept locally. */
  backupAvailable?: boolean;
  onRetry: () => void;
}

/** The "Saving…" scribble: a boiling rough squiggle (§9.1). */
function SavingScribble() {
  return (
    <RoughDrawing
      width={20}
      height={20}
      seed={hashSeed("saving")}
      boil
      items={[
        {
          shape: {
            kind: "curve",
            points: [
              [2, 12],
              [6, 6],
              [10, 14],
              [14, 6],
              [18, 10],
            ],
          },
          tone: "muted",
          strokeWidth: 1.75,
        },
      ]}
    />
  );
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

/**
 * Save-status pill (SAVE-2; tech §7.3; VISUAL_DESIGN.md §9.1). Announced
 * politely to screen readers; "Saved" collapses to the check after 2 s.
 */
export function SaveStatusPill({
  status,
  nonce = 0,
  errorReason,
  iconOnly = false,
  backupAvailable = true,
  onRetry,
}: SaveStatusPillProps) {
  // "Saved" shows its label for 2 s after each save, then collapses to the icon.
  const key = `${status}:${nonce}`;
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
  const collapsed = collapsedKey === key;

  useEffect(() => {
    if (status !== "saved") return;
    const id = window.setTimeout(() => setCollapsedKey(key), 2000);
    return () => window.clearTimeout(id);
  }, [status, key]);

  const text = label(status, errorReason, backupAvailable);
  const showText = !iconOnly && !(status === "saved" && collapsed);
  const danger = status === "error";

  const icon =
    status === "saved" ? (
      <IconCheck size={18} stroke={1.75} />
    ) : status === "saving" ? (
      <SavingScribble />
    ) : status === "offline" ? (
      <IconCloudOff size={18} stroke={1.75} className="text-warning" />
    ) : (
      <IconAlertTriangle size={18} stroke={1.75} />
    );

  const body = (
    <>
      <SketchArt seed={hashSeed("save-pill")} shape="roundRect" radius={12} fillStyle="solid" />
      <span className="inline-flex" aria-hidden="true">
        {icon}
      </span>
      <span className={showText ? "ud-pill__text" : "ud-visually-hidden"}>{text}</span>
    </>
  );

  return (
    <div className="ud-pill-wrap" data-status={status}>
      <span className={`ud-pill ud-sketch${danger ? " ud-pill--danger" : ""}`} title={text}>
        {body}
      </span>
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
