import { useEffect, useRef, useState } from "react";
import { TITLE_MAX, normalizeTitle } from "../boards/boards.api";

/**
 * Click-to-rename title in the editor's top-right (EDIT-3). Hidden below
 * 1024 px by the caller. Without `onRename` (editors, COLLAB-1) it's plain text.
 */
export function BoardTitle({ title, onRename }: { title: string; onRename?: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const finish = (commit: boolean) => {
    setEditing(false);
    if (commit) {
      const next = normalizeTitle(draft);
      if (next && next !== title) onRename?.(next);
    }
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (!onRename) {
    return (
      <span className="ud-title" title={title}>
        {title}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="ud-title-input"
        aria-label="Board title"
        value={draft}
        maxLength={TITLE_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep Excalidraw shortcuts out of the field
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="ud-title"
      title={`${title} (click to rename)`}
      aria-label={`Board title: ${title}. Click to rename.`}
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      {title}
    </button>
  );
}
