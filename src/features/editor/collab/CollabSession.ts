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
import { COLLAB_CHUNK_BYTES, COLLAB_IDLE_MS, COLLAB_TICK_MS } from "../constants";
import { appStateKey, isSyncable, pickDbAppState, type DbAppState } from "../serialize";
import {
  chunkElements,
  filesSchema,
  followSchema,
  helloSchema,
  savedSchema,
  tickSchema,
  type CollabEvent,
  type PresenceMeta,
  type TickPayload,
} from "./protocol";
import type { CollabTransport, ConnectFn } from "./transport";

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
  tickMs?: number;
  chunkBytes?: number;
  idleMs?: number;
  /** requestAnimationFrame, swapped for a sync call in tests. */
  scheduleFrame?: (cb: () => void) => void;
}

type ActivityState = PresenceMeta["state"];

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
  }

  start(api: CollabApi) {
    if (this.disposed) return;
    this.api = api;
    this.cleanups.push(
      api.onUserFollow(({ userToFollow, action }) =>
        this.sendFollow(userToFollow.socketId, action === "FOLLOW"),
      ),
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

  /** My image upload finished; collaborators waiting for it can fetch it now. */
  announceFiles(ids: string[]) {
    if (this.canSend() && ids.length > 0) this.transport!.send("files", { s: this.o.sessionId, ids });
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
    this.disposed = true;
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
        if (msg.success && msg.data.s !== this.o.sessionId) this.applyTick(msg.data);
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
    if (this.everConnected) this.resyncPending = true;
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
    if (this.peers.size > 0 && this.resyncPending) {
      // Back after a disconnect: our offline edits, and anything lost on the way.
      this.resyncPending = false;
      this.sendScene();
    } else if (this.peers.size > 0) {
      // Someone arrived: edits queued while alone go out now.
      this.scheduleTick();
    }
    this.queueRender();
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

  /** People following me see what I see (COLLAB-4). */
  private queueViewport(now: boolean) {
    const api = this.api;
    if (!api || this.followers.size === 0) return;
    this.outView = getVisibleSceneBounds(api.getAppState());
    if (now) this.flushTick();
    else this.scheduleTick();
  }

  private syncFollowers() {
    this.api?.updateScene({ appState: { followedBy: new Set(this.followers) as AppState["followedBy"] } });
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
      });
    }
    api.updateScene({ collaborators: map });
  }
}
