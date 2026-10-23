import {
  getCommonBounds,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { CommentAnchor, CommentThread } from "./comments.api";

export const COMMENT_TOOL = "comment";
const HIDDEN_KEY = "ud:comments-hidden";
/** A collaborator's announcements come in bursts; reload once. */
const RELOAD_DEBOUNCE_MS = 150;
/** Reach around shapes, in screen px, when clicking with the comment tool. */
const HIT_SLOP_PX = 4;
const EXCERPT_LENGTH = 60;

/** Reading and writing comments (comments.api.ts; fakes in tests). */
export interface CommentsApi {
  fetch: () => Promise<CommentThread[]>;
  start: (anchor: CommentAnchor, body: string) => Promise<string>;
  reply: (threadId: string, body: string) => Promise<void>;
  resolve: (threadId: string, resolved: boolean) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

/** The parts of Excalidraw's API comments use (a fake in tests). */
export type CanvasApi = Pick<
  ExcalidrawImperativeAPI,
  | "getAppState"
  | "getSceneElements"
  | "setActiveTool"
  | "setCursor"
  | "onChange"
  | "onScrollChange"
  | "updateScene"
>;

export interface CommentsOptions {
  /** Me: comments by anyone else are news. */
  userId: string;
  api: CommentsApi;
  /** Tells collaborators to reload comments (over the board channel). */
  announce: () => void;
  notify: (message: string, action?: { label: string; onClick: () => void }) => void;
  /** requestAnimationFrame, swapped for a sync call in tests. */
  scheduleFrame?: (cb: () => void) => void;
  /** Where "hide comments" is remembered (this device). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

/** An open thread's marker on the canvas, in px from the editor's top-left. */
export interface Pin {
  id: string;
  left: number;
  top: number;
  thread: CommentThread;
}

export interface CommentsUi {
  hidden: boolean;
  toolActive: boolean;
  /** Open (unresolved) threads, where their markers go. */
  pins: Pin[];
  /** The thread whose card is open. */
  openId: string | null;
  /** A new comment being written, and where. */
  draft: { anchor: CommentAnchor; left: number; top: number } | null;
  /** A write is on its way. */
  busy: boolean;
}

type Element = ExcalidrawElement;

const toolOn = (s: AppState) => s.activeTool.type === "custom" && s.activeTool.customType === COMMENT_TOOL;
const plain = (e: KeyboardEvent) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
const typingIn = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLInputElement && !["radio", "checkbox", "button"].includes(t.type)));

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

/** Comments on a shape sit at its top-right corner. */
function cornerOf(el: Element): { x: number; y: number } {
  const [, minY, maxX] = getCommonBounds([el]);
  return { x: maxX, y: minY };
}

/** Where a thread's marker goes: on its shape while the shape is there, else its spot. */
export function anchorPoint(
  anchor: CommentAnchor,
  byId: ReadonlyMap<string, Element>,
): { x: number; y: number } {
  const el = anchor.elementId ? byId.get(anchor.elementId) : undefined;
  return el && !el.isDeleted ? cornerOf(el) : { x: anchor.x, y: anchor.y };
}

/**
 * What a click at (x, y) comments on: the smallest shape or text under it (so
 * a label wins over its box, and a box over its frame), or else the spot.
 */
export function anchorAt(elements: readonly Element[], x: number, y: number, slop = 0): CommentAnchor {
  let best: { el: Element; area: number } | null = null;
  for (const el of elements) {
    if (el.isDeleted) continue;
    const [x1, y1, x2, y2] = getCommonBounds([el]);
    if (x < x1 - slop || x > x2 + slop || y < y1 - slop || y > y2 + slop) continue;
    const area = Math.max(1, (x2 - x1) * (y2 - y1));
    // Later elements are drawn on top: they win a tie.
    if (!best || area <= best.area) best = { el, area };
  }
  if (!best) return { elementId: null, x, y };
  return { elementId: best.el.id, ...cornerOf(best.el) };
}

/** The selection to comment on: its biggest shape (a group's frame, a box over its label). */
export function selectionAnchor(
  elements: readonly Element[],
  selectedIds: Readonly<Record<string, boolean>>,
): CommentAnchor | null {
  let best: { el: Element; area: number } | null = null;
  for (const el of elements) {
    if (el.isDeleted || !selectedIds[el.id]) continue;
    const [x1, y1, x2, y2] = getCommonBounds([el]);
    const area = (x2 - x1) * (y2 - y1);
    if (!best || area > best.area) best = { el, area };
  }
  return best ? { elementId: best.el.id, ...cornerOf(best.el) } : null;
}

function readHidden(storage: CommentsOptions["storage"]): boolean {
  try {
    return storage?.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Comments on the canvas (CMT-1): markers that follow their shapes, the
 * comment tool (C), writing, replying, resolving and deleting, and "hide
 * comments". Collaborators are told to reload after every change, so
 * everyone sees new comments right away; window focus reloads too.
 */
export class CommentsController {
  private threads: CommentThread[] = [];
  private loaded = false;
  /** Comment ids already seen: anything else from someone else is news. */
  private readonly known = new Set<string>();
  private loading: Promise<void> | null = null;
  private loadAgain = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  private canvas: CanvasApi | null = null;
  private host: HTMLElement | null = null;
  private frameQueued = false;
  private hidden: boolean;
  private openId: string | null = null;
  private draftAnchor: CommentAnchor | null = null;
  private busy = false;
  private ui: CommentsUi;
  private readonly listeners = new Set<() => void>();
  private readonly storage: CommentsOptions["storage"];
  private readonly scheduleFrame: (cb: () => void) => void;

  constructor(private readonly o: CommentsOptions) {
    this.storage = o.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    this.hidden = readHidden(this.storage);
    this.scheduleFrame = o.scheduleFrame ?? ((cb) => requestAnimationFrame(cb));
    this.ui = { hidden: this.hidden, toolActive: false, pins: [], openId: null, draft: null, busy: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.ui;

  attach(canvas: CanvasApi, host: HTMLElement): () => void {
    this.canvas = canvas;
    this.host = host;
    const stopChange = canvas.onChange(() => this.schedule());
    const stopScroll = canvas.onScrollChange(() => this.schedule());
    const capture = { capture: true };
    host.addEventListener("pointerdown", this.handlePointerDown, capture);
    host.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("keydown", this.handleKey, capture);
    window.addEventListener("resize", this.schedule);
    window.addEventListener("focus", this.reload);
    window.addEventListener("online", this.reload);
    void this.load();
    this.schedule();
    return () => {
      stopChange();
      stopScroll();
      host.removeEventListener("pointerdown", this.handlePointerDown, capture);
      host.removeEventListener("pointermove", this.handlePointerMove);
      window.removeEventListener("keydown", this.handleKey, capture);
      window.removeEventListener("resize", this.schedule);
      window.removeEventListener("focus", this.reload);
      window.removeEventListener("online", this.reload);
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
      this.canvas = null;
      this.host = null;
    };
  }

  /** The thread with this id, resolved or not. */
  thread(id: string): CommentThread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  // --- loading ----------------------------------------------------------------------

  /** Fetches every thread; calls made meanwhile get one more fetch afterwards. */
  load = (): Promise<void> => {
    if (this.loading) {
      this.loadAgain = true;
      return this.loading;
    }
    this.loading = (async () => {
      try {
        do {
          this.loadAgain = false;
          this.apply(await this.o.api.fetch());
        } while (this.loadAgain);
      } catch {
        // Offline or signed out: window focus and "online" try again.
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };

  /** A collaborator changed something (or the window came back): reload soon. */
  reload = () => {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.load();
    }, RELOAD_DEBOUNCE_MS);
  };

  private apply(threads: CommentThread[]) {
    const news: { thread: CommentThread; first: boolean }[] = [];
    for (const thread of threads) {
      thread.comments.forEach((comment, i) => {
        if (this.known.has(comment.id)) return;
        this.known.add(comment.id);
        if (this.loaded && comment.authorId !== this.o.userId) news.push({ thread, first: i === 0 });
      });
    }
    this.threads = threads;
    this.loaded = true;
    if (this.openId && !threads.some((t) => t.id === this.openId && !t.resolvedAt)) this.openId = null;
    const latest = news.at(-1);
    if (latest && !latest.thread.resolvedAt) {
      const comment = latest.first ? latest.thread.comments[0]! : latest.thread.comments.at(-1)!;
      const what = latest.first ? "commented" : "replied";
      this.o.notify(`${comment.authorName} ${what}: “${excerpt(comment.body)}”`, {
        label: "Show",
        onClick: () => this.show(latest.thread.id),
      });
    }
    this.schedule();
  }

  // --- the comment tool and the cards --------------------------------------------------

  /** Comments on the selection, or picks the comment tool: the next click places a comment. */
  activateTool = () => {
    const canvas = this.canvas;
    if (!canvas) return;
    const s = canvas.getAppState();
    if (s.viewModeEnabled) return;
    const anchor = selectionAnchor(canvas.getSceneElements(), s.selectedElementIds);
    if (anchor) {
      this.startDraft(anchor);
      return;
    }
    this.setHidden(false);
    canvas.setActiveTool({ type: "custom", customType: COMMENT_TOOL });
  };

  startDraft(anchor: CommentAnchor) {
    this.openId = null;
    this.draftAnchor = anchor;
    this.setHidden(false);
    this.schedule();
  }

  /** Opens a thread's card, or closes it if it's open. */
  toggleThread = (id: string) => {
    this.draftAnchor = null;
    this.openId = this.openId === id ? null : id;
    this.schedule();
  };

  /** Opens a thread, and brings it into view if it's off screen. */
  show = (id: string) => {
    const thread = this.thread(id);
    if (!thread || thread.resolvedAt) return;
    this.setHidden(false);
    this.draftAnchor = null;
    this.openId = id;
    const canvas = this.canvas;
    if (canvas) {
      const s = canvas.getAppState();
      const at = anchorPoint(thread, new Map(canvas.getSceneElements().map((el) => [el.id, el])));
      const zoom = s.zoom.value;
      const left = (at.x + s.scrollX) * zoom;
      const top = (at.y + s.scrollY) * zoom;
      if (left < 0 || top < 0 || left > s.width || top > s.height) {
        canvas.updateScene({
          appState: { scrollX: s.width / 2 / zoom - at.x, scrollY: s.height / 2 / zoom - at.y },
        });
      }
    }
    this.schedule();
  };

  close = () => {
    if (!this.openId && !this.draftAnchor) return;
    this.openId = null;
    this.draftAnchor = null;
    this.schedule();
  };

  toggleHidden = () => this.setHidden(!this.hidden);

  // --- writing ---------------------------------------------------------------------------

  /** Posts the new comment; true once it's saved. */
  submitDraft = (body: string): Promise<boolean> =>
    this.write("Hmm, that comment didn't save. Try again.", async () => {
      const anchor = this.draftAnchor;
      const text = body.trim();
      if (!anchor || !text) return false;
      const id = await this.o.api.start(anchor, text);
      this.draftAnchor = null;
      this.openId = id;
      return true;
    });

  reply = (threadId: string, body: string): Promise<boolean> =>
    this.write("Hmm, that reply didn't save. Try again.", async () => {
      const text = body.trim();
      if (!text) return false;
      await this.o.api.reply(threadId, text);
      return true;
    });

  /** Resolves a thread: it leaves the canvas, with Undo. */
  resolve = async (threadId: string) => {
    const done = await this.write("Hmm, that didn't work. Try again.", async () => {
      await this.o.api.resolve(threadId, true);
      if (this.openId === threadId) this.openId = null;
      return true;
    });
    if (done) {
      this.o.notify("Comment resolved.", { label: "Undo", onClick: () => void this.reopen(threadId) });
    }
  };

  reopen = (threadId: string): Promise<boolean> =>
    this.write("Hmm, that didn't work. Try again.", async () => {
      await this.o.api.resolve(threadId, false);
      return true;
    });

  /** Deletes a reply; the first comment takes its thread with it. */
  deleteComment = (threadId: string, commentId: string): Promise<boolean> => {
    const thread = this.thread(threadId);
    if (thread?.comments[0]?.id === commentId) return this.deleteThread(threadId);
    return this.write("Hmm, that didn't delete. Try again.", async () => {
      await this.o.api.deleteComment(commentId);
      return true;
    });
  };

  deleteThread = (threadId: string): Promise<boolean> =>
    this.write("Hmm, that didn't delete. Try again.", async () => {
      await this.o.api.deleteThread(threadId);
      if (this.openId === threadId) this.openId = null;
      return true;
    });

  /** One write at a time; reloads and tells collaborators when it worked. */
  private async write(failure: string, run: () => Promise<boolean>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.emit();
    try {
      if (!(await run())) return false;
      await this.load();
      this.o.announce();
      return true;
    } catch {
      this.o.notify(failure);
      return false;
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.openId = null;
      this.draftAnchor = null;
    }
    try {
      if (hidden) this.storage?.setItem(HIDDEN_KEY, "1");
      else this.storage?.removeItem(HIDDEN_KEY);
    } catch {
      // Remembered for this visit only.
    }
    this.schedule();
  }

  // --- canvas events -----------------------------------------------------------------------

  private readonly handlePointerDown = (e: PointerEvent) => {
    const canvas = this.canvas;
    if (!canvas || !(e.target instanceof HTMLCanvasElement)) return;
    const s = canvas.getAppState();
    if (toolOn(s)) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const at = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, s);
      canvas.setActiveTool({ type: "selection" });
      this.startDraft(anchorAt(canvas.getSceneElements(), at.x, at.y, HIT_SLOP_PX / s.zoom.value));
      return;
    }
    // Clicking the canvas puts an open card away.
    this.close();
  };

  private readonly handlePointerMove = (e: PointerEvent) => {
    const canvas = this.canvas;
    if (canvas && e.target instanceof HTMLCanvasElement && toolOn(canvas.getAppState())) {
      canvas.setCursor("crosshair");
    }
  };

  private readonly handleKey = (e: KeyboardEvent) => {
    const canvas = this.canvas;
    if (!canvas || typingIn(e.target)) return;
    if (e.key === "Escape" && (this.openId || this.draftAnchor)) {
      this.close();
      return;
    }
    if ((e.key !== "c" && e.key !== "C") || !plain(e) || e.repeat) return;
    const s = canvas.getAppState();
    if (s.viewModeEnabled || s.editingTextElement) return;
    e.preventDefault();
    e.stopPropagation();
    this.activateTool();
  };

  // --- where things go ------------------------------------------------------------------

  private readonly schedule = () => {
    if (this.frameQueued) return;
    this.frameQueued = true;
    this.scheduleFrame(() => {
      this.frameQueued = false;
      this.refresh();
    });
  };

  private refresh() {
    const canvas = this.canvas;
    const host = this.host;
    let pins: Pin[] = [];
    let draft: CommentsUi["draft"] = null;
    let toolActive = false;
    if (canvas && host) {
      const s = canvas.getAppState();
      toolActive = toolOn(s);
      const origin = host.getBoundingClientRect();
      const byId = new Map(canvas.getSceneElements().map((el) => [el.id, el]));
      const place = (at: { x: number; y: number }) => {
        const v = sceneCoordsToViewportCoords({ sceneX: at.x, sceneY: at.y }, s);
        return { left: Math.round(v.x - origin.left), top: Math.round(v.y - origin.top) };
      };
      pins = this.threads
        .filter((t) => !t.resolvedAt)
        .map((thread) => ({ id: thread.id, thread, ...place(anchorPoint(thread, byId)) }));
      if (this.draftAnchor)
        draft = { anchor: this.draftAnchor, ...place(anchorPoint(this.draftAnchor, byId)) };
    }
    const next: CommentsUi = {
      hidden: this.hidden,
      toolActive,
      pins,
      openId: this.openId,
      draft,
      busy: this.busy,
    };
    if (sameUi(next, this.ui)) return;
    this.ui = next;
    this.emit();
  }

  private emit() {
    this.ui = { ...this.ui, busy: this.busy };
    this.listeners.forEach((l) => l());
  }
}

function sameUi(a: CommentsUi, b: CommentsUi): boolean {
  if (
    a.hidden !== b.hidden ||
    a.toolActive !== b.toolActive ||
    a.openId !== b.openId ||
    a.busy !== b.busy ||
    a.pins.length !== b.pins.length ||
    !!a.draft !== !!b.draft
  ) {
    return false;
  }
  if (a.draft && b.draft) {
    if (a.draft.anchor !== b.draft.anchor || a.draft.left !== b.draft.left || a.draft.top !== b.draft.top) {
      return false;
    }
  }
  return a.pins.every((p, i) => {
    const q = b.pins[i]!;
    return p.id === q.id && p.thread === q.thread && p.left === q.left && p.top === q.top;
  });
}
