import { IconDots, IconPencil, IconShare, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { RoughDrawing, SketchArt, SketchMenu, hashSeed, type MenuEntry } from "../../components/sketch";
import { formatRelative } from "../../lib/time";
import { TITLE_MAX, normalizeTitle, type BoardSummary } from "./boards.api";

export interface BoardCardProps {
  board: BoardSummary;
  thumbnailUrl: string | undefined;
  onRename: (title: string) => void;
  onShare: () => void;
  onTrash: () => void;
}

/** A blank paper sheet for boards without a thumbnail (DASH-5). */
function BlankSheet({ seed }: { seed: number }) {
  return (
    <span className="ud-force-light flex h-full w-full items-center justify-center">
      <RoughDrawing
        width={120}
        height={80}
        seed={seed}
        items={[
          {
            shape: {
              kind: "polygon",
              points: [
                [22, 6],
                [88, 6],
                [100, 18],
                [100, 74],
                [22, 74],
              ],
            },
            fillTone: "paper",
            fillStyle: "solid",
            tone: "faint",
            strokeWidth: 1.5,
          },
          {
            shape: {
              kind: "linearPath",
              points: [
                [88, 6],
                [88, 18],
                [100, 18],
              ],
            },
            tone: "faint",
            strokeWidth: 1.5,
          },
        ]}
      />
    </span>
  );
}

/** Dashboard card (DASH-1, DASH-3; VISUAL_DESIGN.md §6.2). */
export function BoardCard({ board, thumbnailUrl, onRename, onShare, onTrash }: BoardCardProps) {
  const seed = hashSeed(board.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(board.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const startRename = () => {
    setDraft(board.title);
    setRenaming(true);
  };

  const finishRename = (commit: boolean) => {
    if (!renaming) return;
    setRenaming(false);
    if (commit) {
      const title = normalizeTitle(draft);
      if (title && title !== board.title) onRename(title);
    }
    requestAnimationFrame(() => linkRef.current?.focus());
  };

  const items: MenuEntry[] = [
    { label: "Rename", icon: <IconPencil size={16} stroke={1.75} />, onSelect: startRename, key: "rename" },
    { label: "Share", icon: <IconShare size={16} stroke={1.75} />, onSelect: onShare, key: "share" },
    { type: "separator", key: "sep" },
    {
      label: "Move to trash",
      icon: <IconTrash size={16} stroke={1.75} />,
      onSelect: onTrash,
      danger: true,
      key: "trash",
    },
  ];

  // Shift+F10 / the context-menu key open the card menu (§10).
  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return;
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      setMenuOpen(true);
    }
  };

  const showImage = !!thumbnailUrl && failedUrl !== thumbnailUrl;
  const edited = `Edited ${formatRelative(board.updated_at)}`;

  const body = (
    <>
      <span className="ud-card__well block aspect-[16/10] w-full overflow-hidden">
        {showImage ? (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
            onError={() => setFailedUrl(thumbnailUrl ?? null)}
          />
        ) : (
          <BlankSheet seed={seed} />
        )}
      </span>
    </>
  );

  return (
    <article className="ud-card ud-sketch h-full" onKeyDown={onKeyDown}>
      <SketchArt seed={seed} shape="rect" fillStyle="solid" shadow />
      {renaming ? (
        <div className="flex flex-1 flex-col">
          {body}
          <div className="px-4 pt-3 pb-4">
            <label className="ud-visually-hidden" htmlFor={`rename-${board.id}`}>
              Board title
            </label>
            <input
              id={`rename-${board.id}`}
              ref={inputRef}
              className="ud-card__rename"
              value={draft}
              maxLength={TITLE_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finishRename(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finishRename(true);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  finishRename(false);
                }
              }}
            />
          </div>
        </div>
      ) : (
        <Link ref={linkRef} to={`/b/${board.id}`} className="ud-card__link flex flex-1 flex-col">
          {body}
          <span className="flex flex-col gap-0.5 px-4 pt-3 pb-4 pr-14">
            <span className="truncate text-body font-semibold text-ink">{board.title}</span>
            <span className="text-label font-normal text-ink-muted">{edited}</span>
          </span>
        </Link>
      )}
      {!renaming ? (
        <div className="absolute right-2 bottom-2.5">
          <SketchMenu
            label={`Board options for ${board.title}`}
            items={items}
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            seedKey={`card-menu:${board.id}`}
            trigger={(props) => (
              <button
                {...props}
                type="button"
                className="ud-iconbtn ud-sketch"
                aria-label={`Board options for ${board.title}`}
              >
                <SketchArt seed={seed + 7} shape="circle" fillStyle="solid" stroke={false} />
                <span className="ud-iconbtn__icon" aria-hidden="true">
                  <IconDots size={20} stroke={1.75} />
                </span>
              </button>
            )}
          />
        </div>
      ) : null}
    </article>
  );
}
