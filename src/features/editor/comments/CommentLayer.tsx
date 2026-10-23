import { IconCheck, IconSend, IconTrash, IconX } from "@tabler/icons-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Avatar, IconButton, SketchArt, SketchButton, hashSeed } from "../../../components/sketch";
import { formatRelative } from "../../../lib/time";
import { COMMENT_MAX_LENGTH, type CommentItem, type CommentThread } from "./comments.api";
import type { CommentsController, Pin } from "./CommentsController";

const ICON = { size: 18, stroke: 1.75 } as const;
/** The card keeps clear of Excalidraw's toolbar and footer. */
const TOP_SAFE = 72;
const BOTTOM_SAFE = 72;
const EDGE = 8;
const CARD_WIDTH = 320;
/** The card sits right of its marker, clear of the bubble (which grows right from its spot), or left of it. */
const CARD_GAP_RIGHT = 42;
const CARD_GAP_LEFT = 12;

export interface CommentPeople {
  /** Me. */
  userId: string;
  /** The board's owner may delete any comment. */
  isOwner: boolean;
}

/** Comments on the canvas (CMT-1): a marker per open thread, and the open thread's card. */
export function CommentLayer({
  controller,
  people,
}: {
  controller: CommentsController;
  people: CommentPeople;
}) {
  const ui = useSyncExternalStore(controller.subscribe, controller.getState);
  if (ui.hidden) return null;
  const open = ui.openId ? ui.pins.find((p) => p.id === ui.openId) : undefined;
  return (
    <>
      <div className="ud-comments" aria-label="Comments" role="group">
        {ui.pins.map((pin) => (
          <Marker
            key={pin.id}
            pin={pin}
            open={pin.id === ui.openId}
            onClick={() => controller.toggleThread(pin.id)}
          />
        ))}
        {ui.draft ? (
          <span className="ud-pin ud-pin--draft" style={{ left: ui.draft.left, top: ui.draft.top }} />
        ) : null}
      </div>
      {open ? (
        <Card key={open.id} left={open.left} top={open.top} label="Comment thread" onClose={controller.close}>
          <ThreadCard thread={open.thread} controller={controller} people={people} busy={ui.busy} />
        </Card>
      ) : null}
      {ui.draft ? (
        <Card left={ui.draft.left} top={ui.draft.top} label="New comment" onClose={controller.close}>
          <Composer
            placeholder="Add a comment…"
            submitLabel="Comment"
            busy={ui.busy}
            onSubmit={controller.submitDraft}
            onCancel={controller.close}
          />
        </Card>
      ) : null}
    </>
  );
}

function Marker({ pin, open, onClick }: { pin: Pin; open: boolean; onClick: () => void }) {
  const first = pin.thread.comments[0];
  const replies = pin.thread.comments.length - 1;
  const name = first?.authorName ?? "Someone";
  const summary = `Comment by ${name}: ${first?.body ?? ""}${
    replies > 0 ? ` (${replies} ${replies === 1 ? "reply" : "replies"})` : ""
  }`;
  return (
    <button
      type="button"
      className="ud-pin ud-sketch"
      style={{ left: pin.left, top: pin.top }}
      aria-label={summary}
      aria-expanded={open}
      title={summary}
      data-open={open || undefined}
      onClick={onClick}
    >
      <SketchArt seed={hashSeed(`pin:${pin.id}`)} shape="circle" fillStyle="solid" strokeWidth={1.5} />
      <span className="ud-pin__initial" aria-hidden="true">
        {(name.trim()[0] ?? "?").toUpperCase()}
      </span>
      {replies > 0 ? (
        <span className="ud-pin__count" aria-hidden="true">
          {replies + 1}
        </span>
      ) : null}
    </button>
  );
}

/** A sketch-framed card next to its marker, kept inside the editor. */
function Card({
  left,
  top,
  label,
  onClose,
  children,
}: {
  left: number;
  top: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [place, setPlace] = useState({ left: left + CARD_GAP_RIGHT, top });
  useLayoutEffect(() => {
    const card = ref.current;
    const host = card?.offsetParent as HTMLElement | null;
    if (!card || !host) return;
    const fit = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      // Right of the marker, or left of it when there's no room.
      let x = left + CARD_GAP_RIGHT;
      if (x + CARD_WIDTH > width - EDGE) x = left - CARD_GAP_LEFT - CARD_WIDTH;
      x = Math.max(EDGE, Math.min(x, width - CARD_WIDTH - EDGE));
      const y = Math.max(TOP_SAFE, Math.min(top - 16, height - BOTTOM_SAFE - card.offsetHeight));
      setPlace((p) => (p.left === x && p.top === y ? p : { left: x, top: y }));
    };
    fit();
    // Replies make it taller.
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    return () => observer.disconnect();
  }, [left, top]);
  return (
    <section
      ref={ref}
      className="ud-comment ud-sketch"
      role="dialog"
      aria-label={label}
      style={{ left: place.left, top: place.top, width: CARD_WIDTH }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <SketchArt seed={hashSeed("comment-card")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
      {children}
    </section>
  );
}

function ThreadCard({
  thread,
  controller,
  people,
  busy,
}: {
  thread: CommentThread;
  controller: CommentsController;
  people: CommentPeople;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const canDeleteThread = people.isOwner || thread.createdBy === people.userId;
  const listRef = useRef<HTMLOListElement>(null);
  // New replies show at the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread.comments.length]);
  return (
    <>
      <header className="ud-comment__head">
        <span className="ud-comment__title">Comment</span>
        {confirming ? (
          <span className="ud-comment__confirm" role="alert">
            Delete the whole thread?
            <SketchButton size="sm" variant="danger" onClick={() => void controller.deleteThread(thread.id)}>
              Delete
            </SketchButton>
            <SketchButton size="sm" onClick={() => setConfirming(false)}>
              Keep
            </SketchButton>
          </span>
        ) : (
          <>
            <IconButton label="Resolve" disabled={busy} onClick={() => void controller.resolve(thread.id)}>
              <IconCheck {...ICON} />
            </IconButton>
            {canDeleteThread ? (
              <IconButton label="Delete thread" onClick={() => setConfirming(true)}>
                <IconTrash {...ICON} />
              </IconButton>
            ) : null}
            <IconButton label="Close" onClick={controller.close}>
              <IconX {...ICON} />
            </IconButton>
          </>
        )}
      </header>
      <ol className="ud-comment__list" ref={listRef}>
        {thread.comments.map((comment, i) => (
          <Comment
            key={comment.id}
            comment={comment}
            canDelete={i > 0 && (people.isOwner || comment.authorId === people.userId)}
            onDelete={() => void controller.deleteComment(thread.id, comment.id)}
          />
        ))}
      </ol>
      <Composer
        placeholder="Reply…"
        submitLabel="Reply"
        busy={busy}
        onSubmit={(body) => controller.reply(thread.id, body)}
      />
    </>
  );
}

function Comment({
  comment,
  canDelete,
  onDelete,
}: {
  comment: CommentItem;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="ud-comment__item">
      <Avatar
        name={comment.authorName}
        url={comment.authorAvatarUrl}
        size={26}
        seedKey={`avatar:${comment.authorId}`}
      />
      <div className="ud-comment__main">
        <div className="ud-comment__meta">
          <span className="ud-comment__author">{comment.authorName}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {formatRelative(comment.createdAt)}
          </time>
          {canDelete ? (
            <button type="button" className="ud-comment__delete" aria-label="Delete reply" onClick={onDelete}>
              <IconTrash size={14} stroke={1.75} />
            </button>
          ) : null}
        </div>
        <p className="ud-comment__body">{comment.body}</p>
      </div>
    </li>
  );
}

/** A comment box: Enter posts, Shift+Enter starts a new line. */
function Composer({
  placeholder,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const empty = !text.trim();
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (empty || busy) return;
    if (await onSubmit(text)) setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <form className="ud-comment__compose" onSubmit={(e) => void submit(e)}>
      <textarea
        ref={ref}
        className="ud-comment__input"
        aria-label={placeholder.replace("…", "")}
        placeholder={placeholder}
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="ud-comment__actions">
        {onCancel ? (
          <SketchButton size="sm" onClick={onCancel}>
            Cancel
          </SketchButton>
        ) : null}
        <SketchButton
          size="sm"
          variant="primary"
          type="submit"
          icon={<IconSend size={16} stroke={1.75} />}
          disabled={empty || busy}
        >
          {submitLabel}
        </SketchButton>
      </div>
    </form>
  );
}
