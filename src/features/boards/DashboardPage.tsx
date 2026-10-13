import { IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { EmptyBoardsDoodle } from "../../assets/illustrations";
import { Wordmark } from "../../brand/Wordmark";
import { SketchArt, SketchBox, SketchButton, hashSeed, useToast } from "../../components/sketch";
import { AvatarMenu } from "../../components/ui/AvatarMenu";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useUser } from "../auth/AuthProvider";
import { ShareDialog } from "../share/ShareDialog";
import type { BoardSummary } from "./boards.api";
import {
  useBoardsList,
  useCreateBoard,
  useLeaveBoard,
  useRenameBoard,
  useRestoreBoard,
  useThumbnailUrls,
  useTrashBoard,
} from "./boards.queries";
import { BoardCard } from "./BoardCard";
import { LeaveConfirmDialog, TrashConfirmDialog } from "./TrashConfirmDialog";

const GRID =
  "grid grid-cols-1 gap-6 tablet:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] desktop:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

interface CardActions {
  userId: string;
  onRename: (board: BoardSummary, title: string) => void;
  onShare: (board: BoardSummary) => void;
  onTrash: (board: BoardSummary) => void;
  onLeave: (board: BoardSummary) => void;
}

/** One page of cards, so thumbnail URLs are signed in one batch per page (tech §7.5). */
function BoardPage({ boards, actions }: { boards: BoardSummary[]; actions: CardActions }) {
  const thumbs = useThumbnailUrls(boards);
  return (
    <>
      {boards.map((board) => (
        <li key={board.id}>
          <BoardCard
            board={board}
            thumbnailUrl={board.thumbnail_path ? thumbs.data?.[board.thumbnail_path] : undefined}
            shared={board.owner_id !== actions.userId}
            onRename={(title) => actions.onRename(board, title)}
            onShare={() => actions.onShare(board)}
            onTrash={() => actions.onTrash(board)}
            onLeave={() => actions.onLeave(board)}
          />
        </li>
      ))}
    </>
  );
}

function SkeletonGrid() {
  return (
    <ul className={GRID} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <SketchBox seed={hashSeed(`skeleton-${i}`)} boil shadow={0} className="flex flex-col">
            <span className="ud-card__well block aspect-[16/10] w-full" />
            <span className="flex flex-col gap-2 px-4 pt-3 pb-4">
              <span className="h-4 w-2/3 bg-surface-sunken" />
              <span className="h-3 w-1/3 bg-surface-sunken" />
            </span>
          </SketchBox>
        </li>
      ))}
    </ul>
  );
}

/** /boards (DASH-1…5; VISUAL_DESIGN.md §6.2). */
export function DashboardPage() {
  useDocumentTitle("Your boards");
  const navigate = useNavigate();
  const user = useUser();
  const { toast } = useToast();
  const list = useBoardsList();
  const leave = useLeaveBoard();
  const create = useCreateBoard();
  const rename = useRenameBoard();
  const trash = useTrashBoard();
  const restore = useRestoreBoard();
  const [sharing, setSharing] = useState<BoardSummary | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<BoardSummary | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<BoardSummary | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const newBoard = useCallback(() => {
    if (create.isPending) return;
    create.mutate(undefined, {
      onSuccess: (board) => navigate(`/b/${board.id}`),
      onError: () => toast({ message: "Hmm, we couldn't create a board. Try again." }),
    });
  }, [create, navigate, toast]);

  // `N` creates a board (DASH-2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector("dialog[open], [role=menu]")) return;
      e.preventDefault();
      newBoard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newBoard]);

  // Infinite scroll (24 per page).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const actions: CardActions = {
    userId: user.id,
    onRename: (board, title) =>
      rename.mutate(
        { id: board.id, title },
        { onError: () => toast({ message: "Hmm, that rename didn't save. Try again." }) },
      ),
    onShare: (board) => setSharing(board),
    onTrash: (board) => setConfirmTrash(board),
    onLeave: (board) => setConfirmLeave(board),
  };

  const doLeave = (board: BoardSummary) => {
    setConfirmLeave(null);
    leave.mutate(board.id, {
      onSuccess: () => toast({ message: `You left "${board.title}".` }),
      onError: () => toast({ message: "Hmm, we couldn't leave that board. Try again." }),
    });
  };

  const doTrash = (board: BoardSummary) => {
    setConfirmTrash(null);
    trash.mutate(board.id, {
      onSuccess: () =>
        toast({
          message: `Moved "${board.title}" to trash.`,
          duration: 5000,
          action: { label: "Undo", onClick: () => restore.mutate(board.id) },
        }),
      onError: () => toast({ message: "Hmm, we couldn't move that board. Try again." }),
    });
  };

  const boards = list.data?.pages ?? [];
  const isEmpty = list.isSuccess && boards.every((p) => p.length === 0);

  return (
    <div className="ud-shell ud-dot-grid flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-4 tablet:px-6 desktop:px-8">
        <Link to="/boards" className="rounded-sm" aria-label="Uncle Draw, your boards">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          <SketchButton
            variant="primary"
            hand
            icon={<IconPlus size={20} stroke={1.75} />}
            onClick={newBoard}
            disabled={create.isPending}
            className="hidden tablet:inline-flex"
            aria-keyshortcuts="N"
          >
            New board
          </SketchButton>
          <AvatarMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 tablet:px-6 desktop:px-8">
        <h1 className="mt-2 mb-6 font-hand text-h1">Your boards</h1>

        {list.isPending ? (
          <>
            <span className="ud-visually-hidden" role="status">
              Loading your boards…
            </span>
            <SkeletonGrid />
          </>
        ) : list.isError ? (
          <div className="flex flex-col items-start gap-4" role="alert">
            <p>Hmm, we couldn&apos;t load your boards.</p>
            <SketchButton onClick={() => void list.refetch()}>Retry</SketchButton>
          </div>
        ) : isEmpty ? (
          <section
            className="flex flex-col items-center gap-4 py-12 text-center"
            aria-labelledby="empty-title"
          >
            <EmptyBoardsDoodle width={240} />
            <h2 id="empty-title" className="font-hand text-h2">
              No boards yet.
            </h2>
            <p className="text-ink-muted">Every great idea starts as a messy sketch.</p>
            <SketchButton
              variant="primary"
              icon={<IconPlus size={20} stroke={1.75} />}
              onClick={newBoard}
              disabled={create.isPending}
            >
              Draw your first board
            </SketchButton>
          </section>
        ) : (
          <>
            <ul className={GRID}>
              {boards.map((page, i) => (
                <BoardPage key={i} boards={page} actions={actions} />
              ))}
            </ul>
            <div ref={sentinelRef} className="h-px" />
            {isFetchingNextPage ? (
              <p className="mt-6 text-center text-label text-ink-muted" role="status">
                Loading more boards…
              </p>
            ) : null}
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1280px] px-4 pb-6 text-label font-normal text-ink-muted tablet:px-6 desktop:px-8">
        Built with{" "}
        <a
          href="https://github.com/excalidraw/excalidraw"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Excalidraw
        </a>
      </footer>

      {/* Phone: "New board" becomes a floating action button (§11). */}
      <button
        type="button"
        className="ud-fab ud-sketch tablet:hidden"
        aria-label="New board"
        onClick={newBoard}
        disabled={create.isPending}
      >
        <SketchArt seed={hashSeed("fab")} shape="circle" fillStyle="solid" strokeWidth={2} shadow focusRing />
        <IconPlus size={24} stroke={2} aria-hidden="true" />
      </button>

      {sharing ? (
        <ShareDialog
          open
          onClose={() => setSharing(null)}
          boardId={sharing.id}
          title={sharing.title}
          isOwner={sharing.owner_id === user.id}
          onLeft={() => {
            setSharing(null);
            toast({ message: `You left "${sharing.title}".` });
            void list.refetch();
          }}
        />
      ) : null}
      <TrashConfirmDialog
        open={!!confirmTrash}
        title={confirmTrash?.title ?? ""}
        onCancel={() => setConfirmTrash(null)}
        onConfirm={() => confirmTrash && doTrash(confirmTrash)}
      />
      <LeaveConfirmDialog
        open={!!confirmLeave}
        title={confirmLeave?.title ?? ""}
        onCancel={() => setConfirmLeave(null)}
        onConfirm={() => confirmLeave && doLeave(confirmLeave)}
      />
    </div>
  );
}
