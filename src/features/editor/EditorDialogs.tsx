import { useRef, useState, type FormEvent } from "react";
import { SketchButton, SketchDialog, SketchInput } from "../../components/sketch";
import { formatClock } from "../../lib/time";
import { TITLE_MAX, normalizeTitle } from "../boards/boards.api";

/** Main menu → "Rename…" (EDIT-3). */
export function RenameDialog({
  open,
  title,
  onClose,
  onRename,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the draft each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(title);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = normalizeTitle(draft);
    if (next && next !== title) onRename(next);
    onClose();
  };

  return (
    <SketchDialog
      open={open}
      onClose={onClose}
      title="Rename board"
      seedKey="rename"
      initialFocusRef={inputRef}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <SketchInput
          ref={inputRef}
          label="Board title"
          value={draft}
          maxLength={TITLE_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="flex justify-end gap-3">
          <SketchButton onClick={onClose}>Cancel</SketchButton>
          <SketchButton type="submit" variant="primary">
            Rename
          </SketchButton>
        </div>
      </form>
    </SketchDialog>
  );
}

/** Save conflict (SAVE-4; VISUAL_DESIGN.md §9.2). Autosave is paused until a choice is made. */
export function ConflictDialog({
  open,
  busy,
  onLoadLatest,
  onKeepMine,
}: {
  open: boolean;
  busy: boolean;
  onLoadLatest: () => void;
  onKeepMine: () => void;
}) {
  const latestRef = useRef<HTMLButtonElement>(null);
  return (
    <SketchDialog
      open={open}
      onClose={() => undefined}
      dismissible={false}
      title="This board was changed somewhere else."
      seedKey="conflict"
      initialFocusRef={latestRef}
      footer={
        <>
          <SketchButton onClick={onKeepMine} disabled={busy}>
            Keep my version
          </SketchButton>
          <SketchButton ref={latestRef} variant="primary" onClick={onLoadLatest} disabled={busy}>
            Load the latest
          </SketchButton>
        </>
      }
    >
      <p>Maybe in another tab or on another device. Autosave is paused until you choose.</p>
      <ul className="flex flex-col gap-1 text-ink-muted">
        <li>
          <strong className="text-ink">Load the latest</strong> replaces your canvas with the saved version.
        </li>
        <li>
          <strong className="text-ink">Keep my version</strong> overwrites the saved version with yours.
        </li>
      </ul>
    </SketchDialog>
  );
}

/** Local recovery prompt (SAVE-3; VISUAL_DESIGN.md §9.2). */
export function RecoveryDialog({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const restoreRef = useRef<HTMLButtonElement>(null);
  return (
    <SketchDialog
      open
      onClose={() => undefined}
      dismissible={false}
      title={`We found unsaved changes from ${formatClock(savedAt)}.`}
      seedKey="recovery"
      initialFocusRef={restoreRef}
      footer={
        <>
          <SketchButton onClick={onDiscard}>Discard</SketchButton>
          <SketchButton ref={restoreRef} variant="primary" onClick={onRestore}>
            Restore them
          </SketchButton>
        </>
      }
    >
      <p>They were kept on this device but never reached the cloud. Restore them?</p>
    </SketchDialog>
  );
}
