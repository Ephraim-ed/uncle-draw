import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentAnchor, CommentThread } from "./comments.api";
import {
  COMMENT_TOOL,
  CommentsController,
  anchorAt,
  selectionAnchor,
  type CanvasApi,
  type CommentsApi,
} from "./CommentsController";

const ME = "u-me";
const PAT = "u-pat";

function shapes() {
  const [box, dot] = convertToExcalidrawElements([
    { type: "rectangle", x: 100, y: 100, width: 300, height: 200 },
    { type: "ellipse", x: 150, y: 150, width: 40, height: 40 },
  ]) as ExcalidrawElement[];
  return { box: box!, dot: dot! };
}

/** Just enough of Excalidraw's API. */
function fakeCanvas(elements: ExcalidrawElement[]) {
  const state = {
    elements,
    appState: {
      activeTool: { type: "selection" },
      selectedElementIds: {} as Record<string, boolean>,
      viewModeEnabled: false,
      editingTextElement: null,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
      width: 1000,
      height: 800,
    },
    change: null as null | (() => void),
    cursor: null as string | null,
  };
  const canvas: CanvasApi = {
    getAppState: () => state.appState as unknown as AppState,
    getSceneElements: () => state.elements as never,
    setActiveTool: ((tool: { type: string; customType?: string }) => {
      state.appState.activeTool =
        tool.type === "custom" ? { type: "custom", customType: tool.customType } : tool;
      state.change?.();
    }) as CanvasApi["setActiveTool"],
    setCursor: (cursor: string) => {
      state.cursor = cursor;
    },
    onChange: ((cb: () => void) => {
      state.change = cb;
      return () => undefined;
    }) as unknown as CanvasApi["onChange"],
    onScrollChange: (() => () => undefined) as unknown as CanvasApi["onScrollChange"],
    updateScene: ((data: { appState?: object }) => {
      if (data.appState) Object.assign(state.appState, data.appState);
      state.change?.();
    }) as CanvasApi["updateScene"],
  };
  return { canvas, state };
}

/** Comments kept in memory, as the database would. */
function fakeApi() {
  const threads: CommentThread[] = [];
  let n = 0;
  const comment = (authorId: string, body: string) => ({
    id: `c${++n}`,
    authorId,
    authorName: authorId === ME ? "Me" : "Pat",
    authorAvatarUrl: null,
    body,
    createdAt: new Date().toISOString(),
  });
  const api: CommentsApi = {
    fetch: vi.fn(async () => structuredClone(threads)),
    start: vi.fn(async (anchor: CommentAnchor, body: string) => {
      const id = `t${++n}`;
      threads.push({
        id,
        ...anchor,
        createdBy: ME,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        comments: [comment(ME, body)],
      });
      return id;
    }),
    reply: vi.fn(async (threadId: string, body: string) => {
      threads.find((t) => t.id === threadId)!.comments.push(comment(ME, body));
    }),
    resolve: vi.fn(async (threadId: string, resolved: boolean) => {
      const t = threads.find((x) => x.id === threadId)!;
      t.resolvedAt = resolved ? new Date().toISOString() : null;
      t.resolvedBy = resolved ? ME : null;
    }),
    deleteComment: vi.fn(async (commentId: string) => {
      for (const t of threads) t.comments = t.comments.filter((c) => c.id !== commentId);
    }),
    deleteThread: vi.fn(async (threadId: string) => {
      threads.splice(
        threads.findIndex((t) => t.id === threadId),
        1,
      );
    }),
  };
  /** Pat writes something, straight into the database. */
  const patWrites = (anchor: CommentAnchor, body: string, replyTo?: string) => {
    if (replyTo) {
      threads.find((t) => t.id === replyTo)!.comments.push(comment(PAT, body));
      return replyTo;
    }
    const id = `t${++n}`;
    threads.push({
      id,
      ...anchor,
      createdBy: PAT,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      comments: [comment(PAT, body)],
    });
    return id;
  };
  return { api, threads, patWrites };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

async function setup(opts: { storage?: ReturnType<typeof memoryStorage> } = {}) {
  const { box, dot } = shapes();
  const { canvas, state } = fakeCanvas([box, dot]);
  const { api, threads, patWrites } = fakeApi();
  const announce = vi.fn();
  const notify = vi.fn();
  const storage = opts.storage ?? memoryStorage();
  const controller = new CommentsController({
    userId: ME,
    api,
    announce,
    notify,
    scheduleFrame: (cb) => cb(),
    storage,
  });
  const host = document.createElement("div");
  const surface = document.createElement("canvas");
  host.append(surface);
  document.body.append(host);
  const detach = controller.attach(canvas, host);
  await controller.load();
  const click = (x: number, y: number) => {
    const e = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    surface.dispatchEvent(e);
    return e;
  };
  const ui = () => controller.getState();
  return {
    controller,
    canvas,
    state,
    api,
    threads,
    patWrites,
    announce,
    notify,
    storage,
    host,
    click,
    ui,
    detach,
    box,
    dot,
  };
}

describe("CommentsController (CMT-1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("puts markers at their shape's top-right corner, and they follow the shape", async () => {
    const t = await setup();
    t.patWrites({ elementId: t.box.id, x: 400, y: 100 }, "Too wide?");
    t.patWrites({ elementId: null, x: 700, y: 500 }, "Empty corner");
    await t.controller.load();
    expect(t.ui().pins.map((p) => [p.left, p.top])).toEqual([
      [400, 100],
      [700, 500],
    ]);

    t.state.elements = [newElementWith(t.box, { x: 150 }), t.dot];
    t.state.change?.();
    expect(t.ui().pins[0]).toMatchObject({ left: 450, top: 100 });

    // The shape is gone: the marker stays where it was.
    t.state.elements = [newElementWith(t.box, { isDeleted: true }), t.dot];
    t.state.change?.();
    expect(t.ui().pins[0]).toMatchObject({ left: 400, top: 100 });
  });

  it("the comment tool: a click comments on the smallest shape under it, or on the spot", async () => {
    const t = await setup();
    t.controller.activateTool();
    expect(t.state.appState.activeTool).toEqual({ type: "custom", customType: COMMENT_TOOL });
    expect(t.ui().toolActive).toBe(true);

    const e = t.click(170, 170); // inside the dot, which is inside the box
    expect(e.defaultPrevented).toBe(true);
    expect(t.state.appState.activeTool).toEqual({ type: "selection" });
    expect(t.ui().draft?.anchor).toEqual({ elementId: t.dot.id, x: 190, y: 150 });

    t.controller.close();
    t.controller.activateTool();
    t.click(800, 700);
    expect(t.ui().draft?.anchor).toEqual({ elementId: null, x: 800, y: 700 });
  });

  it("with shapes selected, Comment writes on them right away", async () => {
    const t = await setup();
    t.state.appState.selectedElementIds = { [t.box.id]: true, [t.dot.id]: true };
    t.controller.activateTool();
    expect(t.state.appState.activeTool).toEqual({ type: "selection" });
    expect(t.ui().draft?.anchor).toEqual({ elementId: t.box.id, x: 400, y: 100 });
  });

  it("C picks the comment tool, but not while typing", async () => {
    const t = await setup();
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    expect(t.ui().toolActive).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    expect(t.ui().toolActive).toBe(true);
  });

  it("posting saves, opens the new thread, and tells collaborators", async () => {
    const t = await setup();
    t.controller.startDraft({ elementId: null, x: 10, y: 20 });
    expect(await t.controller.submitDraft("   ")).toBe(false);
    expect(await t.controller.submitDraft("  Let's move this  ")).toBe(true);
    expect(t.api.start).toHaveBeenCalledWith({ elementId: null, x: 10, y: 20 }, "Let's move this");
    expect(t.ui().draft).toBeNull();
    expect(t.ui().openId).toBe(t.threads[0]!.id);
    expect(t.ui().pins).toHaveLength(1);
    expect(t.announce).toHaveBeenCalledTimes(1);

    expect(await t.controller.reply(t.threads[0]!.id, "Done")).toBe(true);
    expect(t.ui().pins[0]!.thread.comments.map((c) => c.body)).toEqual(["Let's move this", "Done"]);
    // My own comments aren't news to me.
    expect(t.notify).not.toHaveBeenCalled();
  });

  it("a failed post says so and keeps the draft", async () => {
    const t = await setup();
    vi.mocked(t.api.start).mockRejectedValueOnce(new Error("offline"));
    t.controller.startDraft({ elementId: null, x: 10, y: 20 });
    expect(await t.controller.submitDraft("Hello")).toBe(false);
    expect(t.notify).toHaveBeenCalledWith("Hmm, that comment didn't save. Try again.");
    expect(t.ui().draft).not.toBeNull();
    expect(t.announce).not.toHaveBeenCalled();
  });

  it("someone else's comments and replies arrive live, with Show", async () => {
    const t = await setup();
    const id = t.patWrites({ elementId: null, x: 5000, y: 5000 }, "Look over here");
    t.controller.reload();
    await vi.advanceTimersByTimeAsync(200);
    expect(t.notify).toHaveBeenLastCalledWith("Pat commented: “Look over here”", {
      label: "Show",
      onClick: expect.any(Function),
    });

    t.patWrites(
      { elementId: null, x: 0, y: 0 },
      "and this, which is a very long comment that goes on and on",
      id,
    );
    const fetches = vi.mocked(t.api.fetch).mock.calls.length;
    t.controller.reload();
    t.controller.reload(); // a burst reloads once
    await vi.advanceTimersByTimeAsync(200);
    expect(t.api.fetch).toHaveBeenCalledTimes(fetches + 1);
    const [message, action] = t.notify.mock.lastCall!;
    expect(message).toBe("Pat replied: “and this, which is a very long comment that goes on and on”");

    // Show opens it and scrolls it into view.
    action.onClick();
    expect(t.ui().openId).toBe(id);
    expect(t.state.appState.scrollX).toBe(500 - 5000);
    expect(t.state.appState.scrollY).toBe(400 - 5000);
  });

  it("resolving takes a thread off the canvas, with Undo", async () => {
    const t = await setup();
    const id = t.patWrites({ elementId: null, x: 1, y: 2 }, "Fix the colors");
    await t.controller.load();
    t.controller.toggleThread(id);
    await t.controller.resolve(id);
    expect(t.ui().pins).toHaveLength(0);
    expect(t.ui().openId).toBeNull();
    const [message, undo] = t.notify.mock.lastCall!;
    expect(message).toBe("Comment resolved.");
    undo.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.api.resolve).toHaveBeenLastCalledWith(id, false);
    expect(t.ui().pins).toHaveLength(1);
  });

  it("deleting a reply keeps the thread; deleting the first comment deletes the thread", async () => {
    const t = await setup();
    const id = t.patWrites({ elementId: null, x: 1, y: 2 }, "First");
    t.patWrites({ elementId: null, x: 0, y: 0 }, "Second", id);
    await t.controller.load();
    const [first, second] = t.controller.thread(id)!.comments;
    await t.controller.deleteComment(id, second!.id);
    expect(t.api.deleteComment).toHaveBeenCalledWith(second!.id);
    expect(t.ui().pins).toHaveLength(1);
    await t.controller.deleteComment(id, first!.id);
    expect(t.api.deleteThread).toHaveBeenCalledWith(id);
    expect(t.ui().pins).toHaveLength(0);
  });

  it("hide comments is remembered on this device, and the tool shows them again", async () => {
    const storage = memoryStorage();
    const t = await setup({ storage });
    t.controller.toggleThread("whatever");
    t.controller.toggleHidden();
    expect(t.ui()).toMatchObject({ hidden: true, openId: null });
    t.detach();

    const again = await setup({ storage });
    expect(again.ui().hidden).toBe(true);
    again.controller.activateTool();
    expect(again.ui().hidden).toBe(false);
  });

  it("clicking the canvas or Escape puts an open card away", async () => {
    const t = await setup();
    const id = t.patWrites({ elementId: null, x: 1, y: 2 }, "Hi");
    await t.controller.load();
    t.controller.toggleThread(id);
    t.click(500, 500);
    expect(t.ui().openId).toBeNull();
    t.controller.toggleThread(id);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(t.ui().openId).toBeNull();
  });
});

describe("anchorAt / selectionAnchor", () => {
  it("prefers the smallest shape under the point, and comments on spots elsewhere", () => {
    const { box, dot } = shapes();
    expect(anchorAt([box, dot], 120, 120)).toEqual({ elementId: box.id, x: 400, y: 100 });
    expect(anchorAt([box, dot], 160, 160)).toEqual({ elementId: dot.id, x: 190, y: 150 });
    expect(anchorAt([box, dot], 99, 99)).toEqual({ elementId: null, x: 99, y: 99 });
    expect(anchorAt([box, dot], 99, 99, 2)).toEqual({ elementId: box.id, x: 400, y: 100 });
  });

  it("a selection comments on its biggest shape", () => {
    const { box, dot } = shapes();
    expect(selectionAnchor([box, dot], { [dot.id]: true })).toEqual({ elementId: dot.id, x: 190, y: 150 });
    expect(selectionAnchor([box, dot], {})).toBeNull();
  });
});
