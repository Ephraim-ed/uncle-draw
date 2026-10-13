import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, SceneData, SocketId } from "@excalidraw/excalidraw/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStateKey, restoreScene } from "../serialize";
import { CollabSession, type CollabApi } from "./CollabSession";
import { chunkElements, type CollabEvent, type PresenceMeta } from "./protocol";
import type { TransportHandlers } from "./transport";

const ME = "session-me";
const PEER = "session-peer";

function scene(): ExcalidrawElement[] {
  const skeleton = convertToExcalidrawElements([
    { type: "rectangle", x: 10, y: 20, width: 120, height: 80 },
    { type: "ellipse", x: 200, y: 40, width: 60, height: 60 },
    { type: "diamond", x: 300, y: 20, width: 40, height: 40 },
  ]);
  return restoreScene(skeleton as unknown[]).elements as ExcalidrawElement[];
}

/** Just enough of Excalidraw's imperative API. */
function fakeApi(elements: ExcalidrawElement[]) {
  const state = {
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridModeEnabled: false,
      gridSize: 20,
      gridStep: 5,
      editingTextElement: null,
      resizingElement: null,
      newElement: null,
      userToFollow: null as AppState["userToFollow"],
      followedBy: new Set(),
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      width: 1000,
      height: 800,
      offsetLeft: 0,
      offsetTop: 0,
    } as unknown as AppState,
    collaborators: new Map<SocketId, Collaborator>(),
    updates: [] as SceneData[],
    followCb: null as
      | null
      | ((p: {
          userToFollow: { socketId: SocketId; username: string };
          action: "FOLLOW" | "UNFOLLOW";
        }) => void),
  };
  const api: CollabApi = {
    getSceneElementsIncludingDeleted: () => state.elements as never,
    getAppState: () => state.appState,
    getFiles: () => ({}),
    updateScene: ((data: SceneData) => {
      state.updates.push(data);
      if (data.elements) state.elements = data.elements as ExcalidrawElement[];
      if (data.appState) state.appState = { ...state.appState, ...data.appState } as AppState;
      if (data.collaborators) state.collaborators = data.collaborators;
    }) as CollabApi["updateScene"],
    onUserFollow: ((cb: typeof state.followCb) => {
      state.followCb = cb;
      return () => undefined;
    }) as unknown as CollabApi["onUserFollow"],
    onScrollChange: (() => () => undefined) as unknown as CollabApi["onScrollChange"],
  };
  return { api, state };
}

function setup(opts: { chunkBytes?: number } = {}) {
  const elements = scene();
  const { api, state } = fakeApi(elements);
  const sent: Array<{ event: CollabEvent; payload: Record<string, unknown> }> = [];
  const tracked: PresenceMeta[] = [];
  let handlers!: TransportHandlers;
  const onRemoteSaved = vi.fn();
  const onFilesNeeded = vi.fn();
  const onPeersChange = vi.fn();
  const session = new CollabSession({
    sessionId: ME,
    identity: { userId: "u-me", name: "Me", avatarUrl: null },
    connect: (h) => {
      handlers = h;
      return {
        send: (event, payload) => sent.push({ event, payload: payload as Record<string, unknown> }),
        track: (meta) => tracked.push(meta),
        close: () => Promise.resolve(),
      };
    },
    knownElements: elements,
    knownBoardKey: appStateKey(state.appState),
    onRemoteSaved,
    onFilesNeeded,
    onPeersChange,
    chunkBytes: opts.chunkBytes,
    scheduleFrame: (cb) => cb(),
  });
  session.start(api);
  const me: PresenceMeta = { sessionId: ME, userId: "u-me", name: "Me", state: "active" };
  const peer: PresenceMeta = {
    sessionId: PEER,
    userId: "u-peer",
    name: "Pat",
    avatarUrl: null,
    state: "active",
  };
  const connect = (withPeer = true) => {
    handlers.onStatus(true);
    handlers.onPresence(withPeer ? [me, peer] : [me]);
  };
  const ticks = () => sent.filter((m) => m.event === "tick");
  return {
    session,
    api,
    state,
    sent,
    tracked,
    ticks,
    connect,
    handlers: () => handlers,
    me,
    peer,
    onRemoteSaved,
    onFilesNeeded,
    onPeersChange,
  };
}

describe("CollabSession (COLLAB-2…4, tech §15)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins with presence and says hello", () => {
    const t = setup();
    t.connect();
    expect(t.tracked.at(-1)).toMatchObject({ sessionId: ME, name: "Me", state: "active" });
    expect(t.sent.some((m) => m.event === "hello")).toBe(true);
    expect(t.onPeersChange).toHaveBeenCalledWith(1);
  });

  it("sends only the elements I changed, batched into one tick", async () => {
    const t = setup();
    t.connect();
    const [first, ...rest] = t.state.elements;
    const moved = newElementWith(first!, { x: 50 });
    expect(t.session.captureLocalChanges([moved, ...rest], t.state.appState)).toBe(true);
    t.session.setPointer({ x: 1, y: 2, tool: "pointer" }, "down");
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ticks()).toHaveLength(1);
    const tick = t.ticks()[0]!.payload;
    expect((tick.e as ExcalidrawElement[]).map((e) => e.id)).toEqual([moved.id]);
    expect(tick.p).toEqual({ x: 1, y: 2, tool: "pointer", button: "down" });

    // Already sent: the same scene again is not a local change.
    expect(t.session.captureLocalChanges([moved, ...rest], t.state.appState)).toBe(false);
  });

  it("sends nothing while alone, then catches up when someone arrives", async () => {
    const t = setup();
    t.connect(false);
    const [first, ...rest] = t.state.elements;
    const moved = newElementWith(first!, { x: 50 });
    t.session.captureLocalChanges([moved, ...rest], t.state.appState);
    t.session.setPointer({ x: 1, y: 2, tool: "pointer" }, "up");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.ticks()).toHaveLength(0);

    t.handlers().onPresence([t.me, t.peer]);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ticks()).toHaveLength(1);
    expect((t.ticks()[0]!.payload.e as ExcalidrawElement[]).map((e) => e.id)).toEqual([moved.id]);
    expect(t.ticks()[0]!.payload.p).toBeUndefined();
  });

  it("merges a collaborator's elements without undo history or echo", () => {
    const t = setup();
    t.connect();
    const theirs = newElementWith(t.state.elements[1]!, { x: 999 });
    t.handlers().onMessage("tick", { s: PEER, e: [theirs] });

    const update = t.state.updates.find((u) => u.elements);
    expect(update?.captureUpdate).toBe(CaptureUpdateAction.NEVER);
    expect(t.state.elements.find((e) => e.id === theirs.id)?.x).toBe(999);
    // Their edit is now on my canvas, but it's not mine to send or save.
    expect(t.session.captureLocalChanges(t.state.elements, t.state.appState)).toBe(false);
  });

  it("keeps my newer version when a stale copy arrives", () => {
    const t = setup();
    t.connect();
    const mine = newElementWith(newElementWith(t.state.elements[0]!, { x: 1 }), { x: 2 });
    t.state.elements = [mine, ...t.state.elements.slice(1)];
    const stale = newElementWith(t.state.elements[0]!, { x: -5 });
    t.handlers().onMessage("tick", { s: PEER, e: [{ ...stale, version: mine.version - 1 }] });
    expect(t.state.elements.find((e) => e.id === mine.id)?.x).toBe(2);
  });

  it("shows collaborators with names, cursors, selection and idle state", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, state: "idle" }]);
    t.handlers().onMessage("tick", {
      s: PEER,
      p: { x: 10, y: 20, tool: "laser", button: "down" },
      sel: [t.state.elements[0]!.id],
    });
    const self = t.state.collaborators.get(ME as SocketId);
    const pat = t.state.collaborators.get(PEER as SocketId);
    expect(self).toMatchObject({ isCurrentUser: true, username: "Me" });
    expect(pat).toMatchObject({
      username: "Pat",
      id: "u-peer",
      userState: "idle",
      pointer: { x: 10, y: 20, tool: "laser" },
      button: "down",
      selectedElementIds: { [t.state.elements[0]!.id]: true },
    });

    t.handlers().onPresence([t.me]);
    expect(t.state.collaborators.size).toBe(0);
  });

  it("answers hello with the whole scene, split under the size limit", () => {
    const t = setup({ chunkBytes: 900 });
    t.connect();
    t.sent.length = 0;
    t.handlers().onMessage("hello", { s: PEER });
    const ids = t.ticks().flatMap((m) => (m.payload.e as ExcalidrawElement[]).map((e) => e.id));
    expect(t.ticks().length).toBeGreaterThan(1);
    expect(ids.sort()).toEqual(t.state.elements.map((e) => e.id).sort());
    expect(t.ticks()[0]!.payload.b).toMatchObject({ viewBackgroundColor: "#ffffff" });
  });

  it("syncs the board background and grid", async () => {
    const t = setup();
    t.connect();
    t.session.captureLocalChanges(t.state.elements, { ...t.state.appState, viewBackgroundColor: "#fff9db" });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ticks()[0]!.payload.b).toMatchObject({ viewBackgroundColor: "#fff9db" });

    t.handlers().onMessage("tick", { s: PEER, b: { viewBackgroundColor: "#e7f5ff", gridModeEnabled: true } });
    expect(t.state.appState.viewBackgroundColor).toBe("#e7f5ff");
    expect(t.session.captureLocalChanges(t.state.elements, t.state.appState)).toBe(false);
  });

  it("passes saves and file uploads to the editor, and asks for missing images", () => {
    const t = setup();
    t.connect();
    t.handlers().onMessage("saved", { s: PEER, version: 7, fp: "abc" });
    expect(t.onRemoteSaved).toHaveBeenCalledWith(7, "abc");
    t.handlers().onMessage("files", { s: PEER, ids: ["f1"] });
    expect(t.onFilesNeeded).toHaveBeenCalledWith(["f1"]);

    const [image] = convertToExcalidrawElements([
      { type: "image", x: 0, y: 0, width: 10, height: 10, fileId: "file-9" as never },
    ]);
    t.handlers().onMessage("tick", { s: PEER, e: [{ ...image, index: "a9" }] });
    expect(t.onFilesNeeded).toHaveBeenLastCalledWith(["file-9"]);
  });

  it("follow mode: followers get my view, and I mirror whoever I follow (COLLAB-4)", () => {
    const t = setup();
    t.connect();
    t.sent.length = 0;
    t.handlers().onMessage("follow", { s: PEER, target: ME, on: true });
    expect([...(t.state.appState.followedBy as Set<string>)]).toEqual([PEER]);
    expect(t.ticks().at(-1)?.payload.v).toHaveLength(4);

    t.state.followCb?.({ userToFollow: { socketId: PEER as SocketId, username: "Pat" }, action: "FOLLOW" });
    expect(t.sent.at(-1)).toEqual({ event: "follow", payload: { s: ME, target: PEER, on: true } });

    t.state.appState = { ...t.state.appState, userToFollow: { socketId: PEER as SocketId, username: "Pat" } };
    t.handlers().onMessage("tick", { s: PEER, v: [1000, 1000, 1500, 1400] });
    expect(t.state.appState.scrollX).not.toBe(0);

    t.handlers().onPresence([t.me]);
    expect((t.state.appState.followedBy as Set<string>).size).toBe(0);
  });

  it("ignores malformed or own messages", () => {
    const t = setup();
    t.connect();
    const before = t.state.updates.length;
    t.handlers().onMessage("tick", { s: PEER, e: [{ nope: true }] });
    t.handlers().onMessage("tick", { s: ME, e: [t.state.elements[0]] });
    t.handlers().onMessage("saved", { version: "x" });
    expect(t.state.updates.length).toBe(before);
    expect(t.onRemoteSaved).not.toHaveBeenCalled();
  });

  it("re-sends my scene after a reconnect, once someone is there", () => {
    const t = setup();
    t.connect();
    t.handlers().onStatus(false);
    expect(t.state.collaborators.size).toBe(0);
    t.sent.length = 0;
    t.handlers().onStatus(true);
    expect(t.ticks()).toHaveLength(0);
    t.handlers().onPresence([t.me, t.peer]);
    const ids = t.ticks().flatMap((m) => (m.payload.e as ExcalidrawElement[]).map((e) => e.id));
    expect(ids.sort()).toEqual(t.state.elements.map((e) => e.id).sort());
  });
});

describe("chunkElements", () => {
  it("keeps every element, in order, with each chunk under the limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, pad: "x".repeat(100) }));
    const chunks = chunkElements(items, 1000);
    expect(chunks.flat()).toEqual(items);
    for (const chunk of chunks) expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(1000 + chunk.length);
  });

  it("never drops an element bigger than the limit", () => {
    const big = { id: "big", pad: "x".repeat(5000) };
    expect(chunkElements([big], 1000)).toEqual([[big]]);
  });
});
