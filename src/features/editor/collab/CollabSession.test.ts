import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, SceneData, SocketId } from "@excalidraw/excalidraw/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeScreenMedia, fakeVoiceMedia } from "../../../test/fakeVoice";
import { SCREEN_POINTER_IDLE_MS } from "../constants";
import { appStateKey, restoreScene } from "../serialize";
import { CollabSession, type CollabApi, type LiveState } from "./CollabSession";
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
    scrollCb: null as null | (() => void),
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
    onScrollChange: ((cb: () => void) => {
      state.scrollCb = cb;
      return () => undefined;
    }) as unknown as CollabApi["onScrollChange"],
  };
  return { api, state };
}

function setup(opts: { chunkBytes?: number; onCommentsChanged?: () => void } = {}) {
  const elements = scene();
  const { api, state } = fakeApi(elements);
  const sent: Array<{ event: CollabEvent; payload: Record<string, unknown> }> = [];
  const tracked: PresenceMeta[] = [];
  let handlers!: TransportHandlers;
  const onRemoteSaved = vi.fn();
  const onFilesNeeded = vi.fn();
  const onPeersChange = vi.fn();
  const onLiveChange = vi.fn();
  const notify = vi.fn();
  const voice = fakeVoiceMedia();
  const screen = fakeScreenMedia();
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
    onCommentsChanged: opts.onCommentsChanged,
    scheduleFrame: (cb) => cb(),
    voiceMedia: voice.media,
    screenMedia: screen.media,
    onLiveChange,
    notify,
  });
  session.start(api);
  const me: PresenceMeta = {
    sessionId: ME,
    userId: "u-me",
    name: "Me",
    state: "active",
    voice: "off",
    presenting: null,
    sharing: null,
  };
  const peer: PresenceMeta = {
    sessionId: PEER,
    userId: "u-peer",
    name: "Pat",
    avatarUrl: null,
    state: "active",
    voice: "off",
    presenting: null,
    sharing: null,
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
    onLiveChange,
    notify,
    voice,
    screen,
    live: () => onLiveChange.mock.lastCall?.[0] as LiveState | undefined,
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

    // My window resizes: their view is fitted again.
    t.state.appState = { ...t.state.appState, width: 390, height: 844 };
    const zoomBefore = t.state.appState.zoom.value;
    t.session.handleResize();
    expect(t.state.appState.zoom.value).toBeLessThan(zoomBefore);

    t.handlers().onPresence([t.me]);
    expect((t.state.appState.followedBy as Set<string>).size).toBe(0);
  });

  it("passes comment changes on, both ways (CMT-1)", () => {
    const onCommentsChanged = vi.fn();
    const t = setup({ onCommentsChanged });
    t.connect();
    t.session.announceComments();
    expect(t.sent.at(-1)).toEqual({ event: "comments", payload: { s: ME } });
    t.handlers().onMessage("comments", { s: PEER });
    t.handlers().onMessage("comments", { s: ME });
    t.handlers().onMessage("comments", { nope: 1 });
    expect(onCommentsChanged).toHaveBeenCalledTimes(1);
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

describe("CollabSession voice chat (COLLAB-5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("puts my call status in presence and on everyone's avatars", async () => {
    const t = setup();
    t.connect();
    await t.session.joinVoice();
    expect(t.tracked.at(-1)).toMatchObject({ voice: "on" });
    expect(t.state.collaborators.get(ME as SocketId)).toMatchObject({ isInCall: true, isMuted: false });
    expect(t.live()).toMatchObject({ voice: "on", muted: false, inCall: 0 });

    t.session.setMuted(true);
    expect(t.tracked.at(-1)).toMatchObject({ voice: "muted" });
    expect(t.state.collaborators.get(ME as SocketId)).toMatchObject({ isMuted: true });

    t.handlers().onPresence([t.me, { ...t.peer, voice: "muted" }]);
    expect(t.state.collaborators.get(PEER as SocketId)).toMatchObject({ isInCall: true, isMuted: true });
    expect(t.live()).toMatchObject({ inCall: 1 });

    t.session.leaveVoice();
    expect(t.tracked.at(-1)).toMatchObject({ voice: "off" });
    expect(t.voice.mic.tracks[0]!.stopped).toBe(true);
  });

  it("signals over the board channel, one tab to another", async () => {
    const t = setup();
    t.connect();
    await t.session.joinVoice();
    // "session-me" sorts before "session-peer", so I offer.
    t.handlers().onPresence([t.me, { ...t.peer, voice: "on" }]);
    await vi.advanceTimersByTimeAsync(20);
    const offer = t.sent.find((m) => m.event === "rtc")!.payload;
    expect(offer).toMatchObject({ s: ME, to: PEER, kind: "offer" });

    t.handlers().onMessage("rtc", {
      s: PEER,
      to: ME,
      m: "voice",
      id: offer.id,
      kind: "answer",
      sdp: "v=0 answer",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.voice.pcs[0]!.remoteDescription).toEqual({ type: "answer", sdp: "v=0 answer" });
  });

  it("keeps the call going through a channel blip", async () => {
    const t = setup();
    t.connect();
    await t.session.joinVoice();
    t.handlers().onPresence([t.me, { ...t.peer, voice: "on" }]);
    await vi.advanceTimersByTimeAsync(10_000);
    t.handlers().onStatus(false);
    expect(t.voice.pcs[0]!.closed).toBe(false);
  });

  it("after a reconnect, starts over the calls it offers and reloads comments", async () => {
    const onCommentsChanged = vi.fn();
    const t = setup({ onCommentsChanged });
    t.connect();
    await t.session.joinVoice();
    t.handlers().onPresence([t.me, { ...t.peer, voice: "on" }]);
    await vi.advanceTimersByTimeAsync(20);
    const rtc = () => t.sent.filter((m) => m.event === "rtc").map((m) => m.payload);
    const first = rtc().at(-1)!;
    expect(onCommentsChanged).not.toHaveBeenCalled();

    // The channel was gone for a while (say, a hidden tab whose token ran out).
    t.handlers().onStatus(false);
    t.handlers().onStatus(true);
    await vi.advanceTimersByTimeAsync(20);
    const again = rtc().at(-1)!;
    expect(again).toMatchObject({ s: ME, to: PEER, m: "voice", kind: "offer" });
    expect(again.id).not.toBe(first.id);
    expect(t.voice.pcs[0]!.closed).toBe(true);
    expect(onCommentsChanged).toHaveBeenCalledTimes(1);
  });

  it("leaves the call when the editor closes", async () => {
    const t = setup();
    t.connect();
    await t.session.joinVoice();
    await t.session.dispose();
    expect(t.voice.mic.tracks[0]!.stopped).toBe(true);
  });
});

describe("CollabSession presenter mode (COLLAB-6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const following = (t: ReturnType<typeof setup>) => t.state.appState.userToFollow?.socketId;
  /** What Excalidraw does when userToFollow changes. */
  const excalidrawFollows = (t: ReturnType<typeof setup>, on: boolean) =>
    t.state.followCb?.({
      userToFollow: { socketId: PEER as SocketId, username: "Pat" },
      action: on ? "FOLLOW" : "UNFOLLOW",
    });

  it("presenting goes in presence, and my view goes out as I move, followed or not", async () => {
    const t = setup();
    t.connect();
    t.session.startPresenting();
    expect(t.tracked.at(-1)!.presenting).toEqual(expect.any(Number));
    expect(t.live()).toMatchObject({ presenter: { sessionId: ME, isMe: true } });
    expect(t.ticks().at(-1)?.payload.v).toHaveLength(4);

    t.sent.length = 0;
    t.state.scrollCb?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ticks().at(-1)?.payload.v).toHaveLength(4);

    t.handlers().onMessage("follow", { s: PEER, target: ME, on: true });
    expect(t.live()).toMatchObject({ followers: 1 });

    t.session.stopPresenting();
    expect(t.tracked.at(-1)!.presenting).toBeNull();
    expect(t.live()?.presenter).toBeNull();
    t.sent.length = 0;
    t.handlers().onMessage("follow", { s: PEER, target: ME, on: false });
    t.state.scrollCb?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ticks()).toHaveLength(0);
  });

  it("everyone follows the presenter, and stops when they finish", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, presenting: 1000 }]);
    // Followed in the same update that adds Pat, so Excalidraw knows who that is.
    const update = t.state.updates.find((u) => u.appState?.userToFollow);
    expect(update?.collaborators?.has(PEER as SocketId)).toBe(true);
    expect(following(t)).toBe(PEER);
    expect(t.notify).toHaveBeenCalledWith("Pat is presenting. You're following their view.");

    excalidrawFollows(t, true);
    expect(t.sent.at(-1)).toEqual({ event: "follow", payload: { s: ME, target: PEER, on: true } });
    expect(t.live()).toMatchObject({
      presenter: { sessionId: PEER, name: "Pat", isMe: false },
      following: true,
    });

    t.handlers().onPresence([t.me, t.peer]);
    expect(following(t)).toBeUndefined();
    expect(t.notify).toHaveBeenLastCalledWith("Pat stopped presenting.");
    expect(t.live()?.presenter).toBeNull();
  });

  it("follows the presenter again after looking around", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, presenting: 1000 }]);
    excalidrawFollows(t, true);
    // Panning away: Excalidraw stops following.
    t.state.appState = { ...t.state.appState, userToFollow: null };
    excalidrawFollows(t, false);
    expect(t.live()).toMatchObject({ following: false });

    t.session.followPresenter();
    expect(following(t)).toBe(PEER);
  });

  it("only one presents: I can't start over someone, and the earlier start wins a tie", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, presenting: 1000 }]);
    t.session.startPresenting();
    expect(t.tracked.at(-1)!.presenting).toBeNull();

    const u = setup();
    u.connect();
    u.session.startPresenting();
    // Pat pressed Present a moment before me.
    u.handlers().onPresence([u.me, { ...u.peer, presenting: Date.now() - 50 }]);
    expect(u.tracked.at(-1)!.presenting).toBeNull();
    expect(u.notify).toHaveBeenCalledTimes(1);
    expect(u.notify).toHaveBeenCalledWith("Pat is already presenting.");
    expect(u.state.appState.userToFollow?.socketId).toBe(PEER);
  });

  it("a channel blip doesn't end the presentation for followers", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, presenting: 1000 }]);
    excalidrawFollows(t, true);
    t.handlers().onStatus(false);
    // Excalidraw drops the follow when Pat disappears from the collaborators.
    t.state.appState = { ...t.state.appState, userToFollow: null };
    excalidrawFollows(t, false);
    expect(t.notify).toHaveBeenCalledTimes(1);

    t.handlers().onStatus(true);
    t.handlers().onPresence([t.me, { ...t.peer, presenting: 1000 }]);
    expect(following(t)).toBe(PEER);
    expect(t.notify).toHaveBeenCalledTimes(1);
  });
});

describe("CollabSession screen sharing (COLLAB-7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const viewer = (n: number): PresenceMeta => ({
    sessionId: `session-v${String(n).padStart(2, "0")}`,
    userId: `u-${n}`,
    name: `Viewer ${n}`,
    state: "active",
    voice: "off",
    presenting: null,
    sharing: null,
  });

  it("sharing goes in presence, and my screen goes to everyone here", async () => {
    const t = setup();
    t.connect();
    await t.session.startScreenShare();
    expect(t.tracked.at(-1)!.sharing).toEqual(expect.any(Number));
    expect(t.live()).toMatchObject({ screen: "sharing", sharer: { sessionId: ME, isMe: true } });
    await vi.advanceTimersByTimeAsync(20);
    const offer = t.sent.find((m) => m.event === "rtc")!.payload;
    expect(offer).toMatchObject({ s: ME, to: PEER, m: "screen", kind: "offer" });

    t.session.stopScreenShare();
    expect(t.tracked.at(-1)!.sharing).toBeNull();
    expect(t.live()).toMatchObject({ screen: "off", sharer: null });
  });

  it("caps how many watch: the first tabs by session id", async () => {
    const t = setup();
    t.connect();
    const crowd = Array.from({ length: 10 }, (_, i) => viewer(i));
    t.handlers().onPresence([t.me, ...crowd]);
    await t.session.startScreenShare();
    await vi.advanceTimersByTimeAsync(20);
    const offeredTo = t.sent.filter((m) => m.event === "rtc").map((m) => m.payload.to);
    expect(offeredTo).toEqual(crowd.slice(0, 8).map((p) => p.sessionId));
  });

  it("watches whoever shares, routing their signaling to the screen", async () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, sharing: 1000 }]);
    expect(t.live()).toMatchObject({
      sharer: { sessionId: PEER, name: "Pat", isMe: false },
      screenFull: false,
    });

    t.handlers().onMessage("rtc", { s: PEER, to: ME, m: "screen", id: "s1", kind: "offer", sdp: "v=0" });
    await vi.advanceTimersByTimeAsync(20);
    expect(t.screen.pcs).toHaveLength(1);
    expect(t.voice.pcs).toHaveLength(0);
    expect(t.sent.at(-1)).toMatchObject({ event: "rtc", payload: { m: "screen", kind: "answer", to: PEER } });

    const stream = { getTracks: () => [] };
    t.screen.pcs[0]!.dispatchEvent(
      Object.assign(new Event("track"), { streams: [stream], track: { kind: "video" } }),
    );
    expect(t.live()?.screenStream).toBe(stream);

    t.handlers().onPresence([t.me, t.peer]);
    expect(t.live()).toMatchObject({ sharer: null, screenStream: null });
  });

  it("says when there's no room to watch", () => {
    const t = setup();
    t.connect();
    // Eight tabs sort before mine ("session-me").
    const crowd = Array.from({ length: 8 }, (_, i) => viewer(i)).map((p) => ({
      ...p,
      sessionId: `session-a${p.sessionId}`,
    }));
    t.handlers().onPresence([t.me, { ...t.peer, sharing: 1000 }, ...crowd]);
    expect(t.live()).toMatchObject({ sharer: { sessionId: PEER }, screenFull: true });
  });

  it("only one shares: the earlier start wins a tie", async () => {
    const t = setup();
    t.connect();
    await t.session.startScreenShare();
    t.handlers().onPresence([t.me, { ...t.peer, sharing: Date.now() - 50 }]);
    expect(t.tracked.at(-1)!.sharing).toBeNull();
    expect(t.screen.display.tracks[0]!.stopped).toBe(true);
    expect(t.notify).toHaveBeenCalledWith("Pat is already sharing their screen.");
    expect(t.live()).toMatchObject({ screen: "off", sharer: { sessionId: PEER } });
  });
});

describe("CollabSession screen pointers (COLLAB-8)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pointerMsgs = (t: ReturnType<typeof setup>) =>
    t.sent.filter((m) => m.event === "pointer").map((m) => m.payload);

  it("a viewer asks, the sharer allows, and the pointer follows their mouse", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, sharing: 1000 }]);
    t.session.requestPointer();
    expect(pointerMsgs(t).at(-1)).toEqual({ s: ME, to: PEER, kind: "request" });
    expect(t.live()?.pointerAccess).toBe("requested");

    // Nothing goes out before they say yes.
    t.session.sendPointerMove(0.5, 0.5);
    expect(pointerMsgs(t)).toHaveLength(1);

    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "allow" });
    expect(t.live()?.pointerAccess).toBe("granted");
    t.session.sendPointerMove(0.25, 2);
    expect(pointerMsgs(t).at(-1)).toEqual({ s: ME, to: PEER, kind: "move", x: 0.25, y: 1 });
    // Throttled to the tick rate.
    t.session.sendPointerMove(0.3, 0.3);
    expect(pointerMsgs(t)).toHaveLength(2);

    t.session.stopPointer();
    expect(pointerMsgs(t).at(-1)).toMatchObject({ kind: "stop" });
    expect(t.live()?.pointerAccess).toBe("none");
  });

  it("a denied viewer can ask again; a new sharer resets it", () => {
    const t = setup();
    t.connect();
    t.handlers().onPresence([t.me, { ...t.peer, sharing: 1000 }]);
    t.session.requestPointer();
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "deny" });
    expect(t.live()?.pointerAccess).toBe("denied");
    t.session.requestPointer();
    expect(t.live()?.pointerAccess).toBe("requested");
    t.handlers().onPresence([t.me, t.peer]);
    expect(t.live()?.pointerAccess).toBe("none");
  });

  it("the sharer sees the request, allows it, and shows the pointer until it goes idle", async () => {
    const t = setup();
    t.connect();
    await t.session.startScreenShare();
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "request" });
    expect(t.notify).toHaveBeenCalledWith("Pat wants to point at your screen.");
    expect(t.live()?.pointerRequests).toEqual([{ sessionId: PEER, name: "Pat" }]);

    // Moves from someone not allowed yet are ignored.
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "move", x: 0.1, y: 0.2 });
    expect(t.live()?.pointers).toEqual([]);

    t.session.answerPointer(PEER, true);
    expect(pointerMsgs(t).at(-1)).toEqual({ s: ME, to: PEER, kind: "allow" });
    expect(t.live()?.pointerRequests).toEqual([]);

    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "move", x: 0.1, y: 0.2 });
    expect(t.live()?.pointers).toEqual([{ sessionId: PEER, name: "Pat", x: 0.1, y: 0.2 }]);
    await vi.advanceTimersByTimeAsync(SCREEN_POINTER_IDLE_MS + 10);
    expect(t.live()?.pointers).toEqual([]);
  });

  it("denying, stopping, leaving or ending the share clears pointers", async () => {
    const t = setup();
    t.connect();
    await t.session.startScreenShare();
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "request" });
    t.session.answerPointer(PEER, false);
    expect(pointerMsgs(t).at(-1)).toMatchObject({ kind: "deny" });
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "move", x: 0.1, y: 0.2 });
    expect(t.live()?.pointers).toEqual([]);

    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "request" });
    t.session.answerPointer(PEER, true);
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "move", x: 0.1, y: 0.2 });
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "stop" });
    expect(t.live()?.pointers).toEqual([]);

    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "request" });
    t.session.answerPointer(PEER, true);
    t.handlers().onPresence([t.me]);
    t.handlers().onPresence([t.me, t.peer]);
    t.handlers().onMessage("pointer", { s: PEER, to: ME, kind: "move", x: 0.1, y: 0.2 });
    expect(t.live()?.pointers).toEqual([]);
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
