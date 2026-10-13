import { CaptureUpdateAction, getNonDeletedElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { cacheKeys, removeCache, writeCache } from "../../lib/localCache";
import type { LocalBackup, Prefs, Viewport } from "../../lib/schemas";
import { createThrottledWriter } from "../../lib/throttle";
import {
  LOCAL_WRITE_THROTTLE_MS,
  PREF_KEYS,
  SCENE_WARN_BYTES,
  VIEWPORT_WRITE_THROTTLE_MS,
} from "./constants";
import {
  fetchBoard,
  fetchBoardFiles,
  fetchBoardVersion,
  clearThumbnail,
  loadBoardFiles,
  saveBoard,
  uploadBoardFile,
  uploadThumbnail,
} from "./editor.api";
import { FileSync } from "./fileSync";
import { SaveQueue, type SaveQueueState } from "./saveQueue";
import { pickDbAppState, restoreScene, sceneFingerprint, toDbPayload } from "./serialize";
import { ThumbnailScheduler, renderThumbnail, type ThumbnailSnapshot } from "./thumbnail";

/** Save state plus a nonce that changes on every save, so "Saved" can re-appear. */
export type EditorStatus = SaveQueueState & { nonce: number };

export interface Snapshot {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
}

export interface EditorSessionOptions {
  userId: string;
  boardId: string;
  initialVersion: number;
  /** Fingerprint of the scene the server has; null forces a first save (restored local changes). */
  baselineFingerprint: string | null;
  knownFileIds: string[];
  initialTheme: "light" | "dark";
  initialPrefsKey: string;
  /** Excalidraw switched theme by itself; the app keeps "System" if it already matches. */
  onThemeChange: (theme: "light" | "dark") => void;
  notify: (message: string, opts?: { duration?: number; id?: string }) => void;
  /** Board row changed on the server (save or thumbnail): refresh the dashboard. */
  onServerChange: () => void;
  /** The board was trashed or deleted elsewhere. */
  onGone: () => void;
}

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

/**
 * One open board: wires Excalidraw's onChange to autosave (tech §7.2), the
 * IndexedDB backup (§7.6), image uploads (§7.4), thumbnails (§7.5), personal
 * view/style memory (EDIT-5) and theme sync (SET-1).
 */
export class EditorSession {
  readonly queue: SaveQueue<Snapshot>;
  private api: ExcalidrawImperativeAPI | null = null;
  private readonly files: FileSync;
  private readonly thumbs: ThumbnailScheduler;
  private readonly backupWriter;
  private readonly viewportWriter;
  private readonly prefsWriter;

  private lastFingerprint: string | null;
  /** The newest scene seen in onChange (the local backup always stores this). */
  private latest: Snapshot | null = null;
  private lastViewportKey = "";
  private lastPrefsKey: string;
  private lastSeenTheme: "light" | "dark";
  private backupOk = true;
  private warnedLarge = false;
  private disposed = false;

  private state: EditorStatus;
  private nonce = 0;
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
      onChange: (state) => this.emit(state),
      onSaved: (snap) => {
        // Re-record the backup with the new serverVersion. Use the newest scene,
        // not the saved one: changes made during the save must stay backed up.
        this.writeBackup(this.latest ?? snap);
        if (!this.disposed) this.thumbs.markChanged();
        o.onServerChange();
      },
    });
    this.queue.setBaseline(o.baselineFingerprint);
    this.state = { ...this.queue.getState(), nonce: 0 };

    this.files = new FileSync({
      knownIds: o.knownFileIds,
      upload: (file) =>
        uploadBoardFile(o.userId, o.boardId, file, (replaced) => {
          if (!this.disposed) this.api?.addFiles([replaced]);
        }),
      onRejected: (fileId) => this.removeImage(fileId),
    });

    this.thumbs = new ThumbnailScheduler(
      () =>
        this.api
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

  // --- status store (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorStatus => this.state;

  private emit(state: SaveQueueState) {
    this.state = { ...state, nonce: ++this.nonce };
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
      const snapshot = { elements, appState };
      this.latest = snapshot;
      this.queue.notifyChange(snapshot, fingerprint);
      this.writeBackup(snapshot);
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

  /** Conflict → "Load the latest". */
  async loadLatest(): Promise<void> {
    const api = this.api;
    if (!api) return;
    const row = await fetchBoard(this.o.boardId);
    if (!row || row.deleted_at) {
      this.o.onGone();
      return;
    }
    const { elements, dbAppState } = restoreScene(row.scene.elements, row.app_state);
    api.updateScene({
      elements,
      appState: dbAppState as Pick<AppState, keyof typeof dbAppState>,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.history.clear();

    const rows = await fetchBoardFiles(this.o.boardId);
    const have = api.getFiles();
    const missing = rows.filter((r) => !have[r.file_id]);
    this.files.markUploaded(rows.map((r) => r.file_id));
    if (missing.length > 0) api.addFiles(await loadBoardFiles(missing));

    const fingerprint = sceneFingerprint(api.getSceneElementsIncludingDeleted(), api.getAppState());
    this.lastFingerprint = fingerprint;
    this.queue.resetTo(row.version, fingerprint);
    await removeCache(cacheKeys.board(this.o.userId, this.o.boardId));
  }

  /** Conflict → "Keep my version". */
  async keepMine(): Promise<void> {
    const api = this.api;
    if (!api) return;
    const version = await fetchBoardVersion(this.o.boardId);
    if (version === null) {
      this.o.onGone();
      return;
    }
    const elements = api.getSceneElementsIncludingDeleted();
    const appState = api.getAppState();
    await this.queue.resumeWith(version, { elements, appState }, sceneFingerprint(elements, appState));
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

  // --- internals -------------------------------------------------------------

  private writeBackup(snapshot: Snapshot) {
    this.backupWriter.schedule({
      elements: getNonDeletedElements(snapshot.elements) as unknown as LocalBackup["elements"],
      appState: pickDbAppState(snapshot.appState),
      localSavedAt: Date.now(),
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
