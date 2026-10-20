import {
  CaptureUpdateAction,
  newElementWith,
  reconcileElements,
  restoreAppState,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { cacheKeys, writeCache } from "../../lib/localCache";
import type { LocalBackup, Prefs, Viewport } from "../../lib/schemas";
import { createThrottledWriter } from "../../lib/throttle";
import { CollabSession, type CollabIdentity } from "./collab/CollabSession";
import { boardChannel, type ConnectFn } from "./collab/transport";
import {
  LOCAL_WRITE_THROTTLE_MS,
  PREF_KEYS,
  SCENE_WARN_BYTES,
  VIEWPORT_WRITE_THROTTLE_MS,
} from "./constants";
import {
  clearThumbnail,
  fetchBoard,
  fetchBoardFilesByIds,
  loadBoardFiles,
  looksOffline,
  saveBoard,
  uploadBoardFile,
  uploadThumbnail,
} from "./editor.api";
import { FileSync } from "./fileSync";
import { SaveQueue, type RebaseResult, type SaveQueueState } from "./saveQueue";
import {
  appStateKey,
  isSyncable,
  pickDbAppState,
  restoreScene,
  sceneFingerprint,
  toDbPayload,
} from "./serialize";
import { ThumbnailScheduler, renderThumbnail, type ThumbnailSnapshot } from "./thumbnail";

/**
 * Save state, a nonce that changes on every save (so "Saved" can re-animate),
 * and when the board was last saved (by me or a collaborator).
 */
export type EditorStatus = SaveQueueState & { nonce: number; savedAt: number | null };

export interface Snapshot {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
}

export interface EditorSessionOptions {
  userId: string;
  boardId: string;
  initialVersion: number;
  /** When the server copy was last written (the board's updated_at), for the status tooltip. */
  lastSavedAt?: number | null;
  /** Fingerprint of the scene the server has; null forces a first save (restored local changes). */
  baselineFingerprint: string | null;
  /** The scene as the server has it (collaborators already have these versions). */
  serverElements: readonly ExcalidrawElement[];
  serverAppState: Record<string, unknown>;
  knownFileIds: string[];
  initialTheme: "light" | "dark";
  initialPrefsKey: string;
  /** Excalidraw switched theme by itself; the app keeps "System" if it already matches. */
  onThemeChange: (theme: "light" | "dark") => void;
  notify: (message: string, opts?: { duration?: number; id?: string }) => void;
  /** Board row changed on the server (save or thumbnail): refresh the dashboard. */
  onServerChange: () => void;
  /** The board was trashed, deleted, or is no longer shared with me. */
  onGone: () => void;
}

export interface CollabStartOptions {
  identity: CollabIdentity;
  onPeersChange: (others: number) => void;
  /** Swapped in tests. */
  connect?: ConnectFn;
}

/** Another try for images whose upload hadn't finished when we asked. */
const FILE_RETRY_MS = 4000;
const FILE_MAX_TRIES = 4;

export function prefsKey(appState: Partial<AppState>): string {
  return PREF_KEYS.map((k) => String((appState as Record<string, unknown>)[k])).join("|");
}

export function pickPrefs(appState: Partial<AppState>): Prefs {
  const out: Record<string, unknown> = {};
  for (const k of PREF_KEYS) {
    const v = (appState as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as Prefs;
}

/** Identifies this tab on the board's channel (collaborators see it as a socket id). */
function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One open board: wires Excalidraw's onChange to autosave (tech §7.2), the
 * IndexedDB backup (§7.6), image uploads (§7.4), thumbnails (§7.5), personal
 * view/style memory (EDIT-5), theme sync (SET-1) and live collaboration (§15).
 */
export class EditorSession {
  readonly queue: SaveQueue<Snapshot>;
  readonly sessionId = newSessionId();
  private api: ExcalidrawImperativeAPI | null = null;
  private collab: CollabSession | null = null;
  private readonly files: FileSync;
  private readonly thumbs: ThumbnailScheduler;
  private readonly backupWriter;
  private readonly viewportWriter;
  private readonly prefsWriter;

  private lastFingerprint: string | null;
  /** The newest scene seen in onChange (the local backup always stores this). */
  private latest: Snapshot | null = null;
  private lastSelection: AppState["selectedElementIds"] | null = null;
  private lastViewportKey = "";
  private lastPrefsKey: string;
  private lastSeenTheme: "light" | "dark";
  private backupOk = true;
  private warnedLarge = false;
  /** Excalidraw is unmounting (or remounting): use captured snapshots, not the live canvas. */
  private suspended = false;
  private disposed = false;
  private readonly fileTries = new Map<string, number>();
  private readonly fileRequests = new Set<string>();

  private state: EditorStatus;
  private nonce = 0;
  /** Last real save to the server, mine or an adopted collaborator's. */
  private savedAt: number | null;
  private listeners = new Set<() => void>();

  constructor(private readonly o: EditorSessionOptions) {
    this.lastFingerprint = o.baselineFingerprint;
    this.lastPrefsKey = o.initialPrefsKey;
    this.lastSeenTheme = o.initialTheme;

    this.queue = new SaveQueue<Snapshot>({
      initialVersion: o.initialVersion,
      save: (snap, expected) => {
        const payload = toDbPayload(snap.elements, snap.appState);
        if (payload.bytes > SCENE_WARN_BYTES && !this.warnedLarge) {
          this.warnedLarge = true;
          o.notify("This board is getting big. Consider splitting it.", { duration: 6000, id: "big-board" });
        }
        return saveBoard(o.boardId, expected, payload);
      },
      rebase: (snap) => this.rebase(snap),
      onChange: (state) => this.emit(state),
      onSaved: (snap, version, fingerprint) => {
        this.savedAt = Date.now();
        // Re-record the backup with the new serverVersion. Use the newest scene,
        // not the saved one: changes made during the save must stay backed up.
        this.writeBackup(this.latest ?? snap);
        if (!this.disposed) this.thumbs.markChanged();
        this.collab?.announceSaved(version, fingerprint);
        o.onServerChange();
      },
    });
    this.queue.setBaseline(o.baselineFingerprint);
    this.savedAt = o.lastSavedAt ?? null;
    this.state = { ...this.queue.getState(), nonce: 0, savedAt: this.savedAt };

    this.files = new FileSync({
      knownIds: o.knownFileIds,
      upload: (file) =>
        uploadBoardFile(o.userId, o.boardId, file, (replaced) => {
          if (!this.disposed) this.api?.addFiles([replaced]);
        }),
      onRejected: (fileId) => this.removeImage(fileId),
      onUploaded: (fileId) => this.collab?.announceFiles([fileId]),
    });

    this.thumbs = new ThumbnailScheduler(
      () =>
        this.api && !this.suspended
          ? {
              elements: this.api.getSceneElements(),
              appState: this.api.getAppState(),
              files: this.api.getFiles(),
            }
          : null,
      async (snapshot) => {
        const blob = await renderThumbnail(snapshot);
        if (blob) await uploadThumbnail(o.userId, o.boardId, blob);
        else await clearThumbnail(o.boardId);
        o.onServerChange();
      },
    );

    this.backupWriter = createThrottledWriter<LocalBackup>(async (backup) => {
      this.backupOk = await writeCache(cacheKeys.board(o.userId, o.boardId), backup);
    }, LOCAL_WRITE_THROTTLE_MS);
    this.viewportWriter = createThrottledWriter<Viewport>(
      (v) => writeCache(cacheKeys.viewport(o.userId, o.boardId), v),
      VIEWPORT_WRITE_THROTTLE_MS,
    );
    this.prefsWriter = createThrottledWriter<Prefs>(
      (p) => writeCache(cacheKeys.prefs(o.userId), p),
      VIEWPORT_WRITE_THROTTLE_MS,
    );
  }

  attach(api: ExcalidrawImperativeAPI) {
    this.api = api;
  }

  /** The editor (re)mounted: the live canvas is usable again. */
  resume() {
    this.suspended = false;
    this.collab?.resume();
  }

  // --- live collaboration (COLLAB-2…4) ----------------------------------------

  /** Joins the board's channel; returns the function that leaves it. */
  startCollab(api: ExcalidrawImperativeAPI, opts: CollabStartOptions): () => void {
    const collab = new CollabSession({
      sessionId: this.sessionId,
      identity: opts.identity,
      connect: opts.connect ?? boardChannel(this.o.boardId, this.sessionId),
      knownElements: this.o.serverElements,
      knownBoardKey: appStateKey(
        pickDbAppState(restoreAppState(pickDbAppState(this.o.serverAppState), null)),
      ),
      onRemoteSaved: (version, fingerprint) => this.handleRemoteSave(version, fingerprint),
      onFilesNeeded: (ids) => this.fetchMissingFiles(ids),
      onPeersChange: opts.onPeersChange,
    });
    this.collab = collab;
    collab.start(api);
    return () => {
      if (this.collab === collab) this.collab = null;
      void collab.dispose();
    };
  }

  setIdentity(identity: CollabIdentity) {
    this.collab?.setIdentity(identity);
  }

  /** Excalidraw's onPointerUpdate: my cursor for collaborators. */
  handlePointer = (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "up" | "down";
  }) => {
    this.collab?.setPointer(payload.pointer, payload.button);
  };

  // --- status store (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorStatus => this.state;

  private emit(state: SaveQueueState) {
    this.state = { ...state, nonce: ++this.nonce, savedAt: this.savedAt };
    this.listeners.forEach((l) => l());
  }

  // --- onChange ------------------------------------------------------------

  /** Excalidraw's onChange. Fires on every pointer move, so it stays cheap. */
  handleChange(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    if (this.disposed) return;

    // Theme: only react when Excalidraw's theme changed between two calls,
    // never because the prop hasn't caught up with the app yet.
    if (appState.theme !== this.lastSeenTheme) {
      this.lastSeenTheme = appState.theme;
      this.o.onThemeChange(appState.theme);
    }

    const fingerprint = sceneFingerprint(elements, appState);
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint;
      // Collaborators' edits are theirs to save; mine get sent to them.
      const local = this.collab ? this.collab.captureLocalChanges(elements, appState) : true;
      const snapshot = { elements, appState };
      this.latest = snapshot;
      this.queue.notifyChange(snapshot, fingerprint, local ? "local" : "remote");
      this.writeBackup(snapshot);
    }

    if (this.collab && appState.selectedElementIds !== this.lastSelection) {
      this.lastSelection = appState.selectedElementIds;
      this.collab.setSelection(appState.selectedElementIds);
    }

    this.files.notify(files);

    const viewportKey = `${appState.scrollX}|${appState.scrollY}|${appState.zoom.value}`;
    if (viewportKey !== this.lastViewportKey) {
      this.lastViewportKey = viewportKey;
      this.viewportWriter.schedule({
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      });
    }

    const pk = prefsKey(appState);
    if (pk !== this.lastPrefsKey) {
      this.lastPrefsKey = pk;
      this.prefsWriter.schedule(pickPrefs(appState));
    }
  }

  // --- actions ---------------------------------------------------------------

  flush(): Promise<void> {
    void this.backupWriter.flush();
    void this.viewportWriter.flush();
    void this.prefsWriter.flush();
    return this.queue.flush();
  }

  /** Ctrl/Cmd+S: save now and show "Saved" (SAVE-1). */
  forceSave(): Promise<void> {
    return this.flush().then(() => {
      if (this.queue.getState().status === "saved") this.emit(this.queue.getState());
    });
  }

  retry = () => {
    void this.queue.retry();
  };

  handleOnline() {
    this.queue.handleOnline();
  }

  /** beforeunload prompts only if a save is pending and the local backup failed (tech §7.2). */
  shouldBlockUnload(): boolean {
    return (this.queue.hasPending() && !this.backupOk) || this.files.pendingCount > 0;
  }

  /**
   * Leaving the editor, step 1: capture the scene synchronously. Must run
   * before Excalidraw unmounts, because its componentWillUnmount swaps in an
   * empty scene. Returns step 2, which saves, refreshes the thumbnail and
   * stops timers; it can be deferred (and skipped on a StrictMode remount).
   */
  beginLeave(): () => Promise<void> {
    const api = this.api;
    const snapshot = api
      ? { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() }
      : null;
    this.suspended = true;
    this.collab?.suspend();
    return () => this.dispose(snapshot);
  }

  private dispose(snapshot: ThumbnailSnapshot | null): Promise<void> {
    if (this.disposed) return Promise.resolve();
    // A change still in the debounce window hasn't marked the thumbnail stale yet.
    if (this.queue.hasPending()) this.thumbs.markDirty();
    const saved = this.flush();
    const thumb = this.thumbs.leave(snapshot);
    this.disposed = true;
    return Promise.allSettled([saved, thumb]).then(() => {
      this.queue.dispose();
      this.thumbs.dispose();
    });
  }

  // --- merging ---------------------------------------------------------------

  /**
   * After a save conflict: merge the server's copy into ours per element
   * (Excalidraw's reconcile, COLLAB-2) and show the result. Tombstones make
   * deletions win over stale copies.
   */
  private async rebase(snapshot: Snapshot): Promise<RebaseResult<Snapshot>> {
    let row;
    try {
      row = await fetchBoard(this.o.boardId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return looksOffline(0, message) ? { kind: "offline" } : { kind: "error", message };
    }
    if (!row || row.deleted_at) {
      this.o.onGone();
      return { kind: "gone" };
    }

    const { elements: remote, dbAppState } = restoreScene(row.scene.elements, row.app_state);
    const serverFingerprint = sceneFingerprint(remote, pickDbAppState(restoreAppState(dbAppState, null)));

    const api = this.api;
    const live = !!api && !this.suspended && !this.disposed;
    const local = live ? api.getSceneElementsIncludingDeleted() : snapshot.elements;
    const appState = (live ? api.getAppState() : snapshot.appState) as AppState;
    const merged = reconcileElements(
      local as readonly OrderedExcalidrawElement[],
      remote as unknown as RemoteExcalidrawElement[],
      appState,
    );
    if (live) {
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
      this.fetchMissingFiles(
        merged.flatMap((el) => (el.type === "image" && !el.isDeleted && el.fileId ? [el.fileId] : [])),
      );
    }
    return {
      kind: "merged",
      version: row.version,
      serverFingerprint,
      snapshot: { elements: merged, appState },
      fingerprint: sceneFingerprint(merged, appState),
    };
  }

  /** A collaborator saved. If my canvas is exactly that scene, build on their version. */
  private handleRemoteSave(version: number, fingerprint: string) {
    const api = this.api;
    if (!api || this.suspended || this.disposed) return;
    if (sceneFingerprint(api.getSceneElementsIncludingDeleted(), api.getAppState()) === fingerprint) {
      this.savedAt = Date.now();
      this.queue.adoptRemoteSave(version, fingerprint);
      this.o.onServerChange();
    }
  }

  /** Images added by collaborators: signed URLs → data URLs → addFiles. */
  private fetchMissingFiles(ids: string[]) {
    const api = this.api;
    if (!api || this.disposed) return;
    const have = api.getFiles();
    const referenced = new Set(
      api
        .getSceneElementsIncludingDeleted()
        .flatMap((el) => (el.type === "image" && !el.isDeleted && el.fileId ? [el.fileId as string] : [])),
    );
    const wanted = [...new Set(ids)].filter(
      (id) => referenced.has(id) && !have[id] && !this.fileRequests.has(id),
    );
    if (wanted.length === 0) return;
    for (const id of wanted) this.fileRequests.add(id);

    void (async () => {
      let loaded: Awaited<ReturnType<typeof loadBoardFiles>> = [];
      try {
        const rows = await fetchBoardFilesByIds(this.o.boardId, wanted);
        // Never upload these again from here: they're already stored.
        this.files.markUploaded(rows.map((r) => r.file_id));
        loaded = await loadBoardFiles(rows);
      } catch {
        // retried below
      }
      if (this.disposed) return;
      if (loaded.length > 0) this.api?.addFiles(loaded);
      const got = new Set(loaded.map((f) => f.id as string));
      const retry: string[] = [];
      for (const id of wanted) {
        this.fileRequests.delete(id);
        if (got.has(id)) continue;
        // Probably still uploading: its "files" announcement or this timer tries again.
        const tries = (this.fileTries.get(id) ?? 0) + 1;
        this.fileTries.set(id, tries);
        if (tries < FILE_MAX_TRIES) retry.push(id);
      }
      if (retry.length > 0) setTimeout(() => this.fetchMissingFiles(retry), FILE_RETRY_MS);
    })();
  }

  // --- internals -------------------------------------------------------------

  private writeBackup(snapshot: Snapshot) {
    const now = Date.now();
    this.backupWriter.schedule({
      elements: snapshot.elements.filter((el) => isSyncable(el, now)) as unknown as LocalBackup["elements"],
      appState: pickDbAppState(snapshot.appState),
      localSavedAt: now,
      serverVersion: this.queue.getState().expectedVersion,
    });
  }

  private removeImage(fileId: string) {
    const api = this.api;
    this.o.notify("That image is too big (over 5 MB). Try a smaller one.", { duration: 5000 });
    if (!api || this.disposed) return;
    const elements = api
      .getSceneElementsIncludingDeleted()
      .map((el) =>
        el.type === "image" && el.fileId === fileId ? newElementWith(el, { isDeleted: true }) : el,
      );
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }
}
