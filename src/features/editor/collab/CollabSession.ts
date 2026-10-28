import {
  CaptureUpdateAction,
  getVisibleSceneBounds,
  reconcileElements,
  restoreElements,
  zoomToFitBounds,
  type UserIdleState,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { SceneBounds } from "@excalidraw/excalidraw/element/bounds";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import {
  COLLAB_CHUNK_BYTES,
  COLLAB_IDLE_MS,
  COLLAB_TICK_MS,
  SCREEN_MAX_VIEWERS,
  SCREEN_POINTER_IDLE_MS,
  VOICE_MAX_PEOPLE,
} from "../constants";
import { appStateKey, isSyncable, pickDbAppState, type DbAppState } from "../serialize";
import {
  chunkElements,
  commentsSchema,
  filesSchema,
  followSchema,
  helloSchema,
  pointerSchema,
  rtcSchema,
  savedSchema,
  tickSchema,
  type CollabEvent,
  type PointerPayload,
  type PresenceMeta,
  type TickPayload,
} from "./protocol";
import { ScreenShare, type ScreenMedia, type ScreenStatus } from "./ScreenShare";
import type { CollabTransport, ConnectFn } from "./transport";
import { VoiceChat, type VoiceMedia, type VoiceStatus } from "./VoiceChat";
import { CONNECTOR_SESSION_PREFIX } from "../../connector/marks";

/** The parts of Excalidraw's API the session uses (a fake in tests). */
export type CollabApi = Pick<
  ExcalidrawImperativeAPI,
  | "getSceneElementsIncludingDeleted"
  | "getAppState"
  | "getFiles"
  | "updateScene"
  | "onUserFollow"
  | "onScrollChange"
>;

export interface CollabIdentity {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/** Voice chat, presenter mode and screen sharing, for the live bar (COLLAB-5…7). */
export interface LiveState {
  /** Other tabs on this board. */
  others: number;
  voice: VoiceStatus;
  muted: boolean;
  /** Other people in the voice chat. */
  inCall: number;
  /** The call has room for no one else (and I'm not in it). */
  voiceFull: boolean;
  presenter: { sessionId: string; name: string; isMe: boolean } | null;
  /** I'm following the presenter's view. */
  following: boolean;
  /** People following my view while I present. */
  followers: number;
  /** My screen sharing. */
  screen: ScreenStatus;
  /** This browser can share a screen. */
  canShareScreen: boolean;
  sharer: { sessionId: string; name: string; isMe: boolean } | null;
  /** The shared screen I'm watching, once its video arrives. */
  screenStream: MediaStream | null;
  /** People watching my screen. */
  watchers: number;
  /** Someone shares, but enough people are watching already. */
  screenFull: boolean;
  /** My pointer on the shared screen I watch (COLLAB-8). */
  pointerAccess: PointerAccess;
  /** People asking to point at my screen, while I share. */
  pointerRequests: Array<{ sessionId: string; name: string }>;
  /** Viewers' pointers on my screen, while I share. */
  pointers: ScreenPointer[];
}

export type PointerAccess = "none" | "requested" | "granted" | "denied";

/** A viewer's pointer on my shared screen, as fractions of the picture. */
export interface ScreenPointer {
  sessionId: string;
  name: string;
  x: number;
  y: number;
}

export const NO_LIVE_STATE: LiveState = {
  others: 0,
  voice: "off",
  muted: false,
  inCall: 0,
  voiceFull: false,
  presenter: null,
  following: false,
  followers: 0,
  screen: "off",
  canShareScreen: false,
  sharer: null,
  screenStream: null,
  watchers: 0,
  screenFull: false,
  pointerAccess: "none",
  pointerRequests: [],
  pointers: [],
};

function pointerKey(live: LiveState): string {
  const requests = live.pointerRequests.map((r) => `${r.sessionId}:${r.name}`).join(",");
  const pointers = live.pointers.map((p) => `${p.sessionId}:${p.name}:${p.x}:${p.y}`).join(",");
  return `${requests}|${pointers}`;
}

function sameLive(a: LiveState, b: LiveState): boolean {
  return (
    a.others === b.others &&
    a.voice === b.voice &&
    a.muted === b.muted &&
    a.inCall === b.inCall &&
    a.voiceFull === b.voiceFull &&
    a.presenter?.sessionId === b.presenter?.sessionId &&
    a.presenter?.name === b.presenter?.name &&
    a.following === b.following &&
    a.followers === b.followers &&
    a.screen === b.screen &&
    a.canShareScreen === b.canShareScreen &&
    a.sharer?.sessionId === b.sharer?.sessionId &&
    a.sharer?.name === b.sharer?.name &&
    a.screenStream === b.screenStream &&
    a.watchers === b.watchers &&
    a.screenFull === b.screenFull &&
    a.pointerAccess === b.pointerAccess &&
    pointerKey(a) === pointerKey(b)
  );
}

export interface CollabSessionOptions {
  /** This tab; collaborators see it as the cursor's socket id. */
  sessionId: string;
  identity: CollabIdentity;
  connect: ConnectFn;
  /** The scene as the server has it: those versions never need sending. */
  knownElements: readonly ExcalidrawElement[];
  /** appStateKey() of the board settings the server has. */
  knownBoardKey: string;
  /** A collaborator saved; adopt their version if our canvas matches. */
  onRemoteSaved: (version: number, fingerprint: string) => void;
  /** Image elements arrived whose files we don't have yet. */
  onFilesNeeded: (fileIds: string[]) => void;
  /** Number of other tabs on this board. */
  onPeersChange?: (others: number) => void;
  /** A collaborator changed the board's comments (CMT-1). */
  onCommentsChanged?: () => void;
  /** Microphone and WebRTC for voice chat (COLLAB-5). */
  voiceMedia: VoiceMedia;
  /** Screen capture and WebRTC for screen sharing (COLLAB-7). */
  screenMedia: ScreenMedia;
  /** Voice chat, presenter mode or screen sharing changed (COLLAB-5…7). */
  onLiveChange?: (state: LiveState) => void;
  /** Worth telling the person, e.g. "Pat is presenting." */
  notify?: (message: string) => void;
  tickMs?: number;
  chunkBytes?: number;
  idleMs?: number;
  /** requestAnimationFrame, swapped for a sync call in tests. */
  scheduleFrame?: (cb: () => void) => void;
}

type ActivityState = PresenceMeta["state"];
type Presenter = { id: string; name: string; since: number };

/**
 * The next animation frame, or 100 ms, whichever comes first: background
 * tabs pause animation frames, but their collaborator list should still be
 * current when someone switches back.
 */
function nextFrame(cb: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cb();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  setTimeout(run, 100);
}
type Pointer = NonNullable<TickPayload["p"]>;

/**
 * Live collaboration on one board (COLLAB-2…4, tech §15).
 *
 * - Local edits go out as changed elements (version-tracked, so nothing
 *   echoes back), batched with the pointer and selection into one message
 *   per tick, and only while someone else is here.
 * - Remote elements are merged per element with Excalidraw's
 *   reconcileElements() and applied without entering undo history, so undo
 *   only affects my own changes.
 * - Presence feeds Excalidraw's collaborators (avatars, named cursors,
 *   idle/away); following someone mirrors their viewport.
 * - A newcomer says "hello" and everyone answers with their scene, covering
 *   anything not yet saved. Reconnecting does the same.
 * - Voice chat (COLLAB-5) signals over the same channel; presence says who's
 *   in the call and muted, and feeds Excalidraw's call badges on avatars.
 * - Presenter mode (COLLAB-6): presence says who's presenting, and everyone
 *   else follows them, newcomers included. The earliest presenter wins.
 * - Screen sharing (COLLAB-7): presence says who's sharing (the earliest
 *   wins); they send their screen to the first few other tabs by session id.
 * - Screen pointers (COLLAB-8): a viewer asks the sharer to point; once
 *   allowed, their mouse over the shared picture goes to the sharer as
 *   fractions of it, shown there as a named cursor.
 */
export class CollabSession {
  private api: CollabApi | null = null;
  private transport: CollabTransport | null = null;
  private connected = false;
  private everConnected = false;
  /** Reconnected: send the whole scene once someone is here, in case messages were lost. */
  private resyncPending = false;
  private suspended = false;
  private disposed = false;

  /** Element id → the version collaborators already have. */
  private readonly known = new Map<string, number>();
  private knownBoardKey: string;
  private readonly outElements = new Map<string, ExcalidrawElement>();
  private outBoard: DbAppState | null = null;
  private outPointer: Pointer | null = null;
  private outSelection: string[] | null = null;
  private outView: SceneBounds | null = null;
  private lastTick = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  /** Other tabs, by session id. */
  private peers = new Map<string, PresenceMeta>();
  private readonly pointers = new Map<string, Pointer>();
  private readonly selections = new Map<string, Record<string, true>>();
  private readonly followers = new Set<string>();

  private readonly voice: VoiceChat;
  /** What presence last said about my voice chat. */
  private trackedVoice: PresenceMeta["voice"] = "off";
  /** When I started presenting (COLLAB-6). */
  private presentingSince: number | null = null;
  private presenter: Presenter | null = null;
  /** The presenter people were last told about (no repeat after a reconnect). */
  private announcedPresenter: string | null = null;
  /** Follow the new presenter with the next collaborators update (they must be in it). */
  private pendingFollow: { socketId: SocketId; username: string } | null = null;
  private followingId: string | null = null;
  private readonly screen: ScreenShare;
  /** When I started sharing my screen (COLLAB-7). */
  private sharingSince: number | null = null;
  private sharer: Presenter | null = null;
  private screenFull = false;
  /** Viewer side (COLLAB-8): the sharer I asked, and where that stands. */
  private pointerTarget: string | null = null;
  private pointerAccess: PointerAccess = "none";
  private lastPointerSent = 0;
  /** Sharer side: who asked, who may point, and where they point now. */
  private readonly pointerRequests = new Set<string>();
  private readonly pointerGrants = new Set<string>();
  private readonly pointerPositions = new Map<string, { x: number; y: number }>();
  private readonly pointerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The last view of whoever I follow, to fit again when my window resizes. */
  private followedView: { from: string; bounds: NonNullable<TickPayload["v"]> } | null = null;
  private live: LiveState = NO_LIVE_STATE;

  private identity: CollabIdentity;
  private activity: ActivityState = "active";
  private lastActivityAt = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private renderQueued = false;
  private readonly cleanups: Array<() => void> = [];

  private readonly tickMs: number;
  private readonly chunkBytes: number;
  private readonly idleMs: number;
  private readonly scheduleFrame: (cb: () => void) => void;

  constructor(private readonly o: CollabSessionOptions) {
    for (const el of o.knownElements) this.known.set(el.id, el.version);
    this.knownBoardKey = o.knownBoardKey;
    this.identity = o.identity;
    this.tickMs = o.tickMs ?? COLLAB_TICK_MS;
    this.chunkBytes = o.chunkBytes ?? COLLAB_CHUNK_BYTES;
    this.idleMs = o.idleMs ?? COLLAB_IDLE_MS;
    this.scheduleFrame = o.scheduleFrame ?? nextFrame;
    this.voice = new VoiceChat({
      sessionId: o.sessionId,
      media: o.voiceMedia,
      signal: (message) => {
        if (this.connected) this.transport?.send("rtc", message);
      },
      onChange: () => this.handleVoiceChange(),
      onMicLost: () => o.notify?.("Your microphone stopped, so you left voice."),
    });
    this.screen = new ScreenShare({
      sessionId: o.sessionId,
      media: o.screenMedia,
      signal: (message) => {
        if (this.connected) this.transport?.send("rtc", message);
      },
      onChange: () => this.handleScreenChange(),
    });
  }

  start(api: CollabApi) {
    if (this.disposed) return;
    this.api = api;
    this.cleanups.push(
      api.onUserFollow(({ userToFollow, action }) => {
        const id = userToFollow.socketId;
        if (action === "FOLLOW") this.followingId = id;
        else if (this.followingId === id) this.followingId = null;
        this.sendFollow(id, action === "FOLLOW");
        this.emitLive();
      }),
      api.onScrollChange(() => this.queueViewport(false)),
    );
    if (typeof document !== "undefined") {
      const onVisibility = () => this.markActive();
      const onKey = () => this.markActive();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("keydown", onKey, true);
      this.cleanups.push(() => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("keydown", onKey, true);
      });
    }
    this.idleTimer = setInterval(() => this.checkIdle(), Math.min(5000, this.idleMs));

    this.transport = this.o.connect({
      onMessage: (event, payload) => this.receive(event, payload),
      onPresence: (peers) => this.handlePresence(peers),
      onStatus: (connected) => this.handleStatus(connected),
    });
    // Edits made before the channel existed still need to go out.
    this.captureLocalChanges(api.getSceneElementsIncludingDeleted(), api.getAppState());
  }

  /** Leaving the editor (or a StrictMode remount): ignore remote edits meanwhile. */
  suspend() {
    this.suspended = true;
  }

  resume() {
    this.suspended = false;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  setIdentity(identity: CollabIdentity) {
    this.identity = identity;
    this.trackPresence();
    this.queueRender();
  }

  // --- local → collaborators ------------------------------------------------

  /**
   * Called when the scene fingerprint changed. Queues elements whose version
   * collaborators don't have yet; returns false when the change was all theirs.
   */
  captureLocalChanges(elements: readonly ExcalidrawElement[], appState: Partial<AppState>): boolean {
    if (this.disposed) return true;
    let changed = false;
    const now = Date.now();
    for (const el of elements) {
      if (this.known.get(el.id) === el.version || !isSyncable(el, now)) continue;
      this.outElements.set(el.id, el);
      changed = true;
    }
    const key = appStateKey(appState);
    if (key !== this.knownBoardKey) {
      this.knownBoardKey = key;
      this.outBoard = pickDbAppState(appState);
      changed = true;
    }
    if (changed) this.scheduleTick();
    return changed;
  }

  /** Excalidraw's onPointerUpdate. */
  setPointer(pointer: { x: number; y: number; tool: "pointer" | "laser" }, button: "up" | "down") {
    this.markActive();
    if (this.peers.size === 0) return;
    this.outPointer = { x: pointer.x, y: pointer.y, tool: pointer.tool, button };
    this.scheduleTick();
  }

  setSelection(selectedElementIds: Readonly<Record<string, boolean>>) {
    this.outSelection = Object.keys(selectedElementIds)
      .filter((id) => selectedElementIds[id])
      .slice(0, 2000);
    if (this.peers.size > 0) this.scheduleTick();
  }

  /** After my save: send pending edits first, so "saved" arrives after them. */
  announceSaved(version: number, fingerprint: string) {
    if (!this.canSend()) return;
    this.flushTick();
    this.transport!.send("saved", { s: this.o.sessionId, version, fp: fingerprint });
  }

  /** I changed the board's comments; collaborators reload them (CMT-1). */
  announceComments() {
    if (this.canSend()) this.transport!.send("comments", { s: this.o.sessionId });
  }

  /** My image upload finished; collaborators waiting for it can fetch it now. */
  announceFiles(ids: string[]) {
    if (this.canSend() && ids.length > 0) this.transport!.send("files", { s: this.o.sessionId, ids });
  }

  // --- voice chat and presenter mode (COLLAB-5/6) -------------------------------

  /** Joins the voice chat. Rejects with the browser's error if the microphone isn't available. */
  joinVoice(): Promise<void> {
    if (this.disposed || this.live.voiceFull) return Promise.resolve();
    return this.voice.join();
  }

  leaveVoice() {
    this.voice.leave();
  }

  setMuted(muted: boolean) {
    this.voice.setMuted(muted);
  }

  /** Everyone else on the board follows my view until I stop. */
  startPresenting() {
    if (this.disposed || this.presentingSince) return;
    if (this.presenter && this.presenter.id !== this.o.sessionId) return;
    this.presentingSince = Date.now();
    // Presenters lead; they don't follow anyone.
    if (this.api?.getAppState().userToFollow) this.api.updateScene({ appState: { userToFollow: null } });
    this.trackPresence();
    this.updatePresenter();
    this.queueViewport(true);
  }

  stopPresenting() {
    if (!this.presentingSince) return;
    this.presentingSince = null;
    this.trackPresence();
    this.updatePresenter();
  }

  /** Shares my screen with everyone here. Rejects with the browser's error (NotAllowedError when cancelled). */
  startScreenShare(): Promise<void> {
    if (this.disposed || (this.sharer && this.sharer.id !== this.o.sessionId)) return Promise.resolve();
    return this.screen.start();
  }

  stopScreenShare() {
    this.screen.stop();
  }

  /** Asks the sharer to let me point at their screen. */
  requestPointer() {
    const sharer = this.sharer;
    if (this.disposed || !sharer || sharer.id === this.o.sessionId || !this.connected) return;
    if (this.pointerAccess === "requested" || this.pointerAccess === "granted") return;
    this.pointerTarget = sharer.id;
    this.pointerAccess = "requested";
    this.sendPointer(sharer.id, "request");
    this.emitLive();
  }

  /** Gives up my pointer (or a request still waiting). */
  stopPointer() {
    if (this.pointerAccess === "none") return;
    if (this.pointerTarget) this.sendPointer(this.pointerTarget, "stop");
    this.pointerAccess = "none";
    this.emitLive();
  }

  /** My mouse is over the shared picture; x and y are fractions of it. */
  sendPointerMove(x: number, y: number) {
    if (this.pointerAccess !== "granted" || !this.pointerTarget) return;
    const now = Date.now();
    if (now - this.lastPointerSent < this.tickMs) return;
    this.lastPointerSent = now;
    this.sendPointer(this.pointerTarget, "move", Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  /** As the sharer: let a viewer point at my screen, or don't. */
  answerPointer(sessionId: string, allow: boolean) {
    if (!this.pointerRequests.delete(sessionId)) return;
    if (allow) this.pointerGrants.add(sessionId);
    this.sendPointer(sessionId, allow ? "allow" : "deny");
    this.emitLive();
  }

  /** My window changed size: fit the view I follow into it again. */
  handleResize() {
    const view = this.followedView;
    if (view && this.api && !this.disposed && !this.suspended) this.applyViewport(view.from, view.bounds);
  }

  /** Back to the presenter's view after looking around. */
  followPresenter() {
    const presenter = this.presenter;
    if (!presenter || presenter.id === this.o.sessionId || !this.peers.has(presenter.id)) return;
    this.api?.updateScene({
      appState: { userToFollow: { socketId: presenter.id as SocketId, username: presenter.name } },
    });
  }

  /** Sends whatever is queued now (also used right before leaving). */
  flushTick() {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    if (!this.canSend()) {
      // Nobody to tell: pointer and viewport are stale by the time anyone joins,
      // but elements and settings stay queued (a joiner also gets our scene on "hello").
      this.outPointer = null;
      this.outView = null;
      return;
    }
    const payload: TickPayload = { s: this.o.sessionId };
    if (this.outPointer) payload.p = this.outPointer;
    if (this.outSelection) payload.sel = this.outSelection;
    if (this.outBoard) payload.b = this.outBoard;
    if (this.outView) payload.v = [...this.outView] as TickPayload["v"];
    let rest: ExcalidrawElement[][] = [];
    if (this.outElements.size > 0) {
      const elements = [...this.outElements.values()];
      for (const el of elements) this.known.set(el.id, el.version);
      const [first, ...others] = chunkElements(elements, this.chunkBytes);
      payload.e = first as unknown as TickPayload["e"];
      rest = others;
    }
    this.outElements.clear();
    this.outPointer = null;
    this.outSelection = null;
    this.outBoard = null;
    this.outView = null;
    this.lastTick = Date.now();
    if (Object.keys(payload).length > 1) this.transport!.send("tick", payload);
    for (const chunk of rest) this.transport!.send("tick", { s: this.o.sessionId, e: chunk });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.flushTick();
    this.voice.leave();
    this.screen.dispose();
    this.disposed = true;
    for (const timer of this.pointerTimers.values()) clearTimeout(timer);
    this.pointerTimers.clear();
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const transport = this.transport;
    this.transport = null;
    this.connected = false;
    await transport?.close();
  }

  // --- collaborators → local ------------------------------------------------

  private receive(event: CollabEvent, raw: unknown) {
    if (this.disposed || this.suspended || !this.api) return;
    switch (event) {
      case "tick": {
        const msg = tickSchema.safeParse(raw);
        if (msg.success && msg.data.s !== this.o.sessionId) {
          this.applyTick(msg.data);
          // The Claude connector's edits (AI-6) arrive like a collaborator's; say who made them.
          if (msg.data.s.startsWith(CONNECTOR_SESSION_PREFIX) && msg.data.e?.length) {
            this.o.notify?.("Claude updated this board.");
          }
        }
        return;
      }
      case "hello": {
        const msg = helloSchema.safeParse(raw);
        if (msg.success && msg.data.s !== this.o.sessionId) {
          this.sendScene();
          this.queueViewport(true);
        }
        return;
      }
      case "saved": {
        const msg = savedSchema.safeParse(raw);
        if (msg.success) this.o.onRemoteSaved(msg.data.version, msg.data.fp);
        return;
      }
      case "files": {
        const msg = filesSchema.safeParse(raw);
        if (msg.success) this.o.onFilesNeeded(msg.data.ids);
        return;
      }
      case "follow": {
        const msg = followSchema.safeParse(raw);
        if (!msg.success || msg.data.target !== this.o.sessionId) return;
        if (msg.data.on) this.followers.add(msg.data.s);
        else this.followers.delete(msg.data.s);
        this.syncFollowers();
        if (msg.data.on) this.queueViewport(true);
        return;
      }
      case "comments": {
        const msg = commentsSchema.safeParse(raw);
        if (msg.success && msg.data.s !== this.o.sessionId) this.o.onCommentsChanged?.();
        return;
      }
      case "pointer": {
        const msg = pointerSchema.safeParse(raw);
        if (msg.success && msg.data.to === this.o.sessionId && msg.data.s !== this.o.sessionId)
          this.receivePointer(msg.data);
        return;
      }
      case "rtc": {
        const msg = rtcSchema.safeParse(raw);
        if (!msg.success) return;
        if (msg.data.m === "screen") this.screen.receive(msg.data);
        else this.voice.receive(msg.data);
        return;
      }
    }
  }

  private applyTick(tick: TickPayload) {
    if (tick.e && tick.e.length > 0) this.applyElements(tick.e);
    if (tick.b) this.applyBoard(tick.b);
    if (tick.p) this.pointers.set(tick.s, tick.p);
    if (tick.sel) this.selections.set(tick.s, Object.fromEntries(tick.sel.map((id) => [id, true as const])));
    if (tick.p || tick.sel) this.queueRender();
    if (tick.v) this.applyViewport(tick.s, tick.v);
  }

  private applyElements(raw: NonNullable<TickPayload["e"]>) {
    const api = this.api!;
    const remote = restoreElements(raw as unknown as ExcalidrawElement[], null);
    for (const el of remote) this.known.set(el.id, el.version);
    const merged = reconcileElements(
      api.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[],
      remote as unknown as RemoteExcalidrawElement[],
      api.getAppState(),
    );
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });

    const files = api.getFiles();
    const missing = new Set<string>();
    for (const el of remote) {
      if (el.type === "image" && !el.isDeleted && el.fileId && !files[el.fileId]) missing.add(el.fileId);
    }
    if (missing.size > 0) this.o.onFilesNeeded([...missing]);
  }

  private applyBoard(raw: NonNullable<TickPayload["b"]>) {
    const api = this.api!;
    const next = pickDbAppState(raw);
    this.knownBoardKey = appStateKey({ ...api.getAppState(), ...next });
    api.updateScene({
      appState: next as Pick<AppState, keyof DbAppState>,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  private applyViewport(from: string, bounds: NonNullable<TickPayload["v"]>) {
    const api = this.api!;
    const appState = api.getAppState();
    if (appState.userToFollow?.socketId !== from) return;
    this.followedView = { from, bounds };
    const { appState: next } = zoomToFitBounds({
      appState,
      bounds: bounds as unknown as SceneBounds,
      fitToViewport: true,
      viewportZoomFactor: 1,
    });
    api.updateScene({
      appState: { scrollX: next.scrollX, scrollY: next.scrollY, zoom: next.zoom },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  // --- channel lifecycle --------------------------------------------------------

  private handleStatus(connected: boolean) {
    if (this.disposed) return;
    this.connected = connected;
    if (!connected) {
      // Collaborators reappear with the next presence sync.
      this.handlePresence([]);
      return;
    }
    this.trackPresence();
    // Everyone answers with their scene, so we catch up on what we missed.
    this.transport?.send("hello", { s: this.o.sessionId });
    if (this.everConnected) {
      this.resyncPending = true;
      // Calls carry on peer to peer, but collaborators may have hung up on us
      // while we were gone (a hidden tab's channel can be away for minutes).
      this.voice.reconnected();
      this.screen.reconnected();
      // Comments may have changed meanwhile.
      this.o.onCommentsChanged?.();
    }
    this.everConnected = true;
  }

  private handlePresence(all: PresenceMeta[]) {
    if (this.disposed) return;
    const before = this.peers.size;
    this.peers = new Map(all.filter((p) => p.sessionId !== this.o.sessionId).map((p) => [p.sessionId, p]));
    for (const id of [...this.pointers.keys()]) if (!this.peers.has(id)) this.pointers.delete(id);
    for (const id of [...this.selections.keys()]) if (!this.peers.has(id)) this.selections.delete(id);
    let lostFollower = false;
    for (const id of [...this.followers]) {
      if (!this.peers.has(id)) {
        this.followers.delete(id);
        lostFollower = true;
      }
    }
    if (lostFollower) this.syncFollowers();
    if (this.peers.size !== before) this.o.onPeersChange?.(this.peers.size);
    // While disconnected, calls carry on peer to peer; presence catches up on reconnect.
    if (this.connected) {
      this.voice.setMembers(
        [...this.peers.values()].filter((p) => p.voice !== "off").map((p) => p.sessionId),
      );
    }
    this.updatePresenter();
    this.updateSharer();
    this.syncPointers();
    if (this.peers.size > 0 && this.resyncPending) {
      // Back after a disconnect: our offline edits, and anything lost on the way.
      this.resyncPending = false;
      this.sendScene();
    } else if (this.peers.size > 0) {
      // Someone arrived: edits queued while alone go out now.
      this.scheduleTick();
    }
    this.queueRender();
    this.emitLive();
  }

  /** My whole scene, in chunks (an answer to "hello", or after reconnecting). */
  private sendScene() {
    const api = this.api;
    if (!api || !this.connected || !this.transport) return;
    const now = Date.now();
    const elements = api.getSceneElementsIncludingDeleted().filter((el) => isSyncable(el, now));
    for (const el of elements) this.known.set(el.id, el.version);
    this.outElements.clear();
    const chunks = chunkElements(elements, this.chunkBytes);
    const board = pickDbAppState(api.getAppState());
    this.transport.send("tick", { s: this.o.sessionId, b: board, e: chunks[0] ?? [] });
    for (const chunk of chunks.slice(1)) this.transport.send("tick", { s: this.o.sessionId, e: chunk });
  }

  private sendFollow(target: string, on: boolean) {
    if (this.connected) this.transport?.send("follow", { s: this.o.sessionId, target, on });
  }

  // --- presence, cursors, follow mode ------------------------------------------------

  private canSend(): boolean {
    return !this.disposed && this.connected && !!this.transport && this.peers.size > 0;
  }

  private scheduleTick() {
    if (this.tickTimer || !this.canSend()) return;
    const wait = Math.max(0, this.lastTick + this.tickMs - Date.now());
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.flushTick();
    }, wait);
  }

  /** People following me, or watching me present, see what I see (COLLAB-4/6). */
  private queueViewport(now: boolean) {
    const api = this.api;
    if (!api || (this.followers.size === 0 && !this.presentingSince)) return;
    this.outView = getVisibleSceneBounds(api.getAppState());
    if (now) this.flushTick();
    else this.scheduleTick();
  }

  private syncFollowers() {
    this.api?.updateScene({ appState: { followedBy: new Set(this.followers) as AppState["followedBy"] } });
    this.emitLive();
  }

  /** What presence should say about my voice chat. */
  private voiceState(): PresenceMeta["voice"] {
    if (this.voice.getStatus() !== "on") return "off";
    return this.voice.isMuted() ? "muted" : "on";
  }

  private handleVoiceChange() {
    if (this.disposed) return;
    const voice = this.voiceState();
    if (voice !== this.trackedVoice) {
      this.trackedVoice = voice;
      this.trackPresence();
    }
    this.queueRender();
    this.emitLive();
  }

  /** Whoever started `key` first, me included; ties go to the lower session id. */
  private earliest(key: "presenting" | "sharing", mine: number | null): Presenter | null {
    const all: Presenter[] = [];
    for (const peer of this.peers.values()) {
      const since = peer[key];
      if (since) all.push({ id: peer.sessionId, name: peer.name, since });
    }
    if (mine) all.push({ id: this.o.sessionId, name: this.identity.name, since: mine });
    all.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return all[0] ?? null;
  }

  private resolvePresenter(): Presenter | null {
    return this.earliest("presenting", this.presentingSince);
  }

  private handleScreenChange() {
    if (this.disposed) return;
    const sharing = this.screen.getStatus() === "sharing";
    if (sharing !== !!this.sharingSince) {
      this.sharingSince = sharing ? Date.now() : null;
      this.trackPresence();
      this.updateSharer();
    }
    this.syncPointers();
    this.emitLive();
  }

  /** Presence changed: who shares, who gets my screen, and whose screen I watch. */
  private updateSharer() {
    // While disconnected, screens carry on peer to peer; presence catches up on reconnect.
    if (!this.connected) return void this.emitLive();
    const me = this.o.sessionId;
    const next = this.earliest("sharing", this.sharingSince);
    if (next && next.id !== me && this.sharingSince) {
      // Someone else started first.
      this.sharingSince = null;
      this.trackPresence();
      this.screen.stop();
      this.o.notify?.(`${next.name} is already sharing their screen.`);
    }
    this.sharer = next;
    // The first few tabs by session id watch, so the sharer and every viewer agree.
    const audience = [...this.peers.keys(), me]
      .filter((id) => id !== next?.id)
      .sort()
      .slice(0, SCREEN_MAX_VIEWERS);
    const watching = !!next && next.id !== me;
    this.screenFull = watching && !audience.includes(me);
    this.screen.setViewers(next?.id === me ? audience : []);
    this.screen.watch(watching && !this.screenFull ? next.id : null);
    this.syncPointers();
    this.emitLive();
  }

  // --- screen pointers (COLLAB-8) ------------------------------------------------

  private sendPointer(to: string, kind: PointerPayload["kind"], x?: number, y?: number) {
    if (!this.connected) return;
    this.transport?.send("pointer", {
      s: this.o.sessionId,
      to,
      kind,
      ...(x === undefined || y === undefined ? {} : { x, y }),
    });
  }

  private receivePointer(msg: PointerPayload) {
    const from = msg.s;
    switch (msg.kind) {
      case "request": {
        const peer = this.peers.get(from);
        if (!this.sharingSince || !peer) return;
        if (this.pointerGrants.has(from)) return this.sendPointer(from, "allow");
        if (this.pointerRequests.has(from)) return;
        this.pointerRequests.add(from);
        this.o.notify?.(`${peer.name} wants to point at your screen.`);
        this.emitLive();
        return;
      }
      case "stop":
        if (this.dropPointer(from)) this.emitLive();
        return;
      case "move": {
        if (!this.pointerGrants.has(from) || msg.x === undefined || msg.y === undefined) return;
        this.pointerPositions.set(from, { x: msg.x, y: msg.y });
        clearTimeout(this.pointerTimers.get(from));
        this.pointerTimers.set(
          from,
          setTimeout(() => {
            this.pointerTimers.delete(from);
            if (this.pointerPositions.delete(from)) this.emitLive();
          }, SCREEN_POINTER_IDLE_MS),
        );
        this.emitLive();
        return;
      }
      case "allow":
      case "deny":
        if (this.pointerAccess !== "requested" || this.pointerTarget !== from) return;
        this.pointerAccess = msg.kind === "allow" ? "granted" : "denied";
        this.emitLive();
        return;
    }
  }

  /** Forgets a viewer's request, permission and pointer; true if there was any. */
  private dropPointer(id: string): boolean {
    clearTimeout(this.pointerTimers.get(id));
    this.pointerTimers.delete(id);
    const a = this.pointerRequests.delete(id);
    const b = this.pointerGrants.delete(id);
    const c = this.pointerPositions.delete(id);
    return a || b || c;
  }

  /** Sharer, viewers or the connection changed: end pointers that no longer make sense. */
  private syncPointers() {
    const watching =
      this.connected && this.sharer && this.sharer.id !== this.o.sessionId ? this.sharer.id : null;
    if (this.pointerTarget !== watching) {
      this.pointerTarget = watching;
      this.pointerAccess = "none";
    }
    for (const id of new Set([...this.pointerRequests, ...this.pointerGrants])) {
      if (!this.sharingSince || !this.peers.has(id)) this.dropPointer(id);
    }
  }

  /** Presence changed: follow a new presenter, or stop following one who finished. */
  private updatePresenter() {
    const me = this.o.sessionId;
    const self = this.presentingSince
      ? { id: me, name: this.identity.name, since: this.presentingSince }
      : null;
    const next = this.connected ? this.resolvePresenter() : self;
    if (next && next.id !== me && this.presentingSince) {
      // Someone else started first. That's all there is to say; I follow them below.
      this.presentingSince = null;
      this.trackPresence();
      this.o.notify?.(`${next.name} is already presenting.`);
      this.announcedPresenter = next.id;
    }
    const prev = this.presenter;
    this.presenter = next;
    // A disconnect isn't the end of a presentation: Excalidraw drops the
    // follow by itself, and we follow again once presence is back.
    if (!this.connected) return void this.emitLive();
    if (prev?.id !== next?.id) {
      if (next && next.id !== me) {
        this.pendingFollow = { socketId: next.id as SocketId, username: next.name };
        this.queueRender();
        if (this.announcedPresenter !== next.id) {
          this.o.notify?.(`${next.name} is presenting. You're following their view.`);
        }
      } else if (prev && prev.id !== me) {
        if (this.followingId === prev.id) this.api?.updateScene({ appState: { userToFollow: null } });
        if (this.announcedPresenter === prev.id) this.o.notify?.(`${prev.name} stopped presenting.`);
      }
    }
    this.announcedPresenter = next && next.id !== me ? next.id : null;
    this.emitLive();
  }

  private emitLive() {
    if (this.disposed) return;
    const status = this.voice.getStatus();
    let inCall = 0;
    for (const peer of this.peers.values()) if (peer.voice !== "off") inCall++;
    const presenter = this.presenter;
    const next: LiveState = {
      others: this.peers.size,
      voice: status,
      muted: this.voice.isMuted(),
      inCall,
      voiceFull: status === "off" && inCall >= VOICE_MAX_PEOPLE,
      presenter: presenter
        ? { sessionId: presenter.id, name: presenter.name, isMe: presenter.id === this.o.sessionId }
        : null,
      following: !!presenter && this.followingId === presenter.id,
      followers: this.presentingSince ? this.followers.size : 0,
      screen: this.screen.getStatus(),
      canShareScreen: this.o.screenMedia.canShare,
      sharer: this.sharer
        ? { sessionId: this.sharer.id, name: this.sharer.name, isMe: this.sharer.id === this.o.sessionId }
        : null,
      screenStream: this.screen.getStream(),
      watchers: this.sharingSince ? this.screen.viewerCount : 0,
      screenFull: this.screenFull,
      pointerAccess: this.pointerAccess,
      pointerRequests: this.sharingSince
        ? [...this.pointerRequests].map((id) => ({
            sessionId: id,
            name: this.peers.get(id)?.name ?? "Someone",
          }))
        : [],
      pointers: this.sharingSince
        ? [...this.pointerPositions].map(([id, at]) => ({
            sessionId: id,
            name: this.peers.get(id)?.name ?? "Someone",
            ...at,
          }))
        : [],
    };
    if (sameLive(next, this.live)) return;
    this.live = next;
    this.o.onLiveChange?.(next);
  }

  private markActive() {
    this.lastActivityAt = Date.now();
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    this.setActivity(hidden ? "away" : "active");
  }

  private checkIdle() {
    if (this.activity === "active" && Date.now() - this.lastActivityAt >= this.idleMs)
      this.setActivity("idle");
  }

  private setActivity(state: ActivityState) {
    if (state === this.activity) return;
    this.activity = state;
    this.trackPresence();
    this.queueRender();
  }

  private trackPresence() {
    if (!this.connected || !this.transport) return;
    this.transport.track({
      sessionId: this.o.sessionId,
      userId: this.identity.userId,
      name: this.identity.name,
      avatarUrl: this.identity.avatarUrl,
      state: this.activity,
      voice: this.voiceState(),
      presenting: this.presentingSince,
      sharing: this.sharingSince,
    });
  }

  private queueRender() {
    if (this.renderQueued || this.disposed) return;
    this.renderQueued = true;
    this.scheduleFrame(() => {
      this.renderQueued = false;
      this.renderCollaborators();
    });
  }

  /** Excalidraw's collaborators map: avatars top-right, named cursors, selections. */
  private renderCollaborators() {
    const api = this.api;
    if (!api || this.disposed || this.suspended) return;
    const map = new Map<SocketId, Collaborator>();
    if (this.peers.size > 0) {
      map.set(this.o.sessionId as SocketId, {
        socketId: this.o.sessionId as SocketId,
        id: this.identity.userId,
        username: this.identity.name,
        avatarUrl: this.identity.avatarUrl ?? undefined,
        userState: this.activity as UserIdleState,
        isCurrentUser: true,
        isInCall: this.voice.getStatus() === "on",
        isMuted: this.voice.isMuted(),
        isSpeaking: this.voice.isSpeaking(this.o.sessionId),
      });
    }
    for (const [id, peer] of this.peers) {
      const pointer = this.pointers.get(id);
      map.set(id as SocketId, {
        socketId: id as SocketId,
        id: peer.userId,
        username: peer.name,
        avatarUrl: peer.avatarUrl ?? undefined,
        userState: peer.state as UserIdleState,
        pointer: pointer ? { x: pointer.x, y: pointer.y, tool: pointer.tool } : undefined,
        button: pointer?.button,
        selectedElementIds: this.selections.get(id),
        isInCall: peer.voice !== "off",
        isMuted: peer.voice === "muted",
        isSpeaking: this.voice.isSpeaking(id),
      });
    }
    // Following the presenter goes with the update that adds them, or
    // Excalidraw would drop the follow for someone it doesn't know yet.
    const follow = this.pendingFollow;
    this.pendingFollow = null;
    const followNow = follow && this.presenter?.id === follow.socketId && map.has(follow.socketId);
    api.updateScene({ collaborators: map, ...(followNow ? { appState: { userToFollow: follow } } : {}) });
  }
}
