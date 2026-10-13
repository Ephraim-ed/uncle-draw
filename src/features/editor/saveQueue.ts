import {
  REMOTE_SAVE_DELAY_MS,
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  SAVE_DEBOUNCE_MS,
  SAVE_MAX_WAIT_MS,
} from "./constants";

/** Save-status pill states (tech §7.3). */
export type SaveStatus = "saved" | "saving" | "offline" | "error";

export type SaveResult =
  | { kind: "ok"; version: number }
  /** save_board returned null: the board changed elsewhere (or was trashed). */
  | { kind: "conflict" }
  /** The server couldn't be reached. Retried with backoff. */
  | { kind: "offline" }
  /** Payload over the hard limit (SAVE-6). Not retried until the next change. */
  | { kind: "tooLarge" }
  | { kind: "error"; message?: string };

/** Outcome of merging with the server's copy after a conflict. */
export type RebaseResult<S> =
  /** The canvas now holds local ∪ server; `serverFingerprint` is what the server has. */
  | { kind: "merged"; version: number; serverFingerprint: string; snapshot: S; fingerprint: string }
  | { kind: "offline" }
  /** Trashed, deleted or no longer shared with me. */
  | { kind: "gone" }
  | { kind: "error"; message?: string };

/** Who made a change: me, or a collaborator (who saves it themselves). */
export type ChangeOrigin = "local" | "remote";

export type ErrorReason = "tooLarge" | "failed" | null;

export interface SaveQueueState {
  status: SaveStatus;
  errorReason: ErrorReason;
  expectedVersion: number;
  /** A change is waiting or a request is in flight. */
  hasPending: boolean;
}

export interface SaveQueueOptions<S> {
  initialVersion: number;
  /** Performs one save; must classify failures instead of throwing. */
  save: (snapshot: S, expectedVersion: number) => Promise<SaveResult>;
  /** After a conflict: merge with the server's copy (COLLAB-2, SAVE-4). */
  rebase: (snapshot: S) => Promise<RebaseResult<S>>;
  onChange?: (state: SaveQueueState) => void;
  onSaved?: (snapshot: S, version: number, fingerprint: string) => void;
  isOnline?: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  remoteDelayMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
}

interface Job<S> {
  snapshot: S;
  fingerprint: string;
  origin: ChangeOrigin;
}

/**
 * Autosave queue (tech §7.2): debounced 1.5 s after the last change, forced
 * after at most 10 s of continuous editing, one request in flight at a time,
 * and changes made during a save coalesced into the next one. A conflict is
 * resolved by merging with the server's copy and saving again; offline
 * retries with backoff.
 *
 * Collaborators' changes (origin "remote") are saved by them. We only save
 * them as a fallback, after REMOTE_SAVE_DELAY_MS, if their save hasn't shown up.
 *
 * Pure and framework-free so it can be tested with fake timers.
 */
export class SaveQueue<S> {
  private readonly opts: Required<Omit<SaveQueueOptions<S>, "onChange" | "onSaved">> &
    Pick<SaveQueueOptions<S>, "onChange" | "onSaved">;

  private status: SaveStatus = "saved";
  private errorReason: ErrorReason = null;
  private expectedVersion: number;
  private savedFingerprint: string | null = null;
  private pending: Job<S> | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay: number;

  constructor(options: SaveQueueOptions<S>) {
    this.opts = {
      debounceMs: SAVE_DEBOUNCE_MS,
      maxWaitMs: SAVE_MAX_WAIT_MS,
      remoteDelayMs: REMOTE_SAVE_DELAY_MS,
      retryMinMs: RETRY_MIN_MS,
      retryMaxMs: RETRY_MAX_MS,
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      ...options,
    };
    this.expectedVersion = options.initialVersion;
    this.retryDelay = this.opts.retryMinMs;
  }

  /** The fingerprint the server already has. Changes matching it are no-ops. */
  setBaseline(fingerprint: string | null) {
    this.savedFingerprint = fingerprint;
  }

  getState(): SaveQueueState {
    return {
      status: this.status,
      errorReason: this.errorReason,
      expectedVersion: this.expectedVersion,
      hasPending: !!this.pending || !!this.inFlight,
    };
  }

  hasPending(): boolean {
    return !!this.pending || !!this.inFlight;
  }

  /** Called for every scene change; cheap. */
  notifyChange(snapshot: S, fingerprint: string, origin: ChangeOrigin = "local") {
    if (this.disposed) return;
    if (fingerprint === this.savedFingerprint && !this.inFlight) {
      // Back to what the server has (e.g. undo, or a collaborator's save): nothing to save.
      if (this.pending) {
        this.pending = null;
        this.clearDebounce();
        if (this.status === "saving") this.setStatus("saved", null);
      }
      return;
    }
    // A local change still waiting keeps the whole job local.
    const local = origin === "local" || this.pending?.origin === "local";
    this.pending = { snapshot, fingerprint, origin: local ? "local" : "remote" };
    if (this.inFlight) {
      // Coalesced into the next save; show it as ours right away.
      if (local && this.status !== "saving") this.setStatus("saving", null);
      return;
    }
    if (this.status === "offline" && this.retryTimer) return; // the retry picks up the latest change
    this.queuePending();
  }

  /**
   * A collaborator saved `version`, and our canvas holds exactly that scene
   * (the caller checks). Save on top of it from now on, without a conflict.
   */
  adoptRemoteSave(version: number, fingerprint: string) {
    if (this.disposed || this.inFlight || version <= this.expectedVersion) return;
    this.expectedVersion = version;
    this.savedFingerprint = fingerprint;
    this.pending = null;
    this.clearDebounce();
    this.clearRetry();
    this.retryDelay = this.opts.retryMinMs;
    if (this.errorReason !== "tooLarge") this.setStatus("saved", null);
  }

  /** Save right away (Ctrl/Cmd+S, tab hidden, leaving the editor, sign-out). */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearDebounce();
    this.clearRetry();
    if (this.inFlight) {
      // Coalesce: once the current request settles, save whatever is newest.
      return this.inFlight.then(() => (this.pending ? this.flush() : undefined));
    }
    if (!this.pending) {
      if (this.status === "saving") this.setStatus("saved", null);
      return Promise.resolve();
    }
    return this.run();
  }

  /** Manual retry from the `error` pill. */
  retry(): Promise<void> {
    this.retryDelay = this.opts.retryMinMs;
    return this.flush();
  }

  /** The browser came back online: retry right away. */
  handleOnline() {
    if (this.status === "offline") void this.retry();
  }

  dispose() {
    this.disposed = true;
    this.clearDebounce();
    this.clearRetry();
  }

  // ---------------------------------------------------------------------

  /** Starts the right timer for the waiting change. */
  private queuePending() {
    if (!this.pending) return;
    if (this.pending.origin === "local") {
      if (this.status !== "saving") this.setStatus("saving", null);
      this.schedule();
    } else {
      if (this.status === "saving") this.setStatus("saved", null);
      if (!this.remoteTimer && !this.debounceTimer) {
        this.remoteTimer = setTimeout(() => {
          this.remoteTimer = null;
          void this.flush();
        }, this.opts.remoteDelayMs);
      }
    }
  }

  private schedule() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), this.opts.debounceMs);
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => void this.flush(), this.opts.maxWaitMs);
    }
  }

  private async run(): Promise<void> {
    const job = this.pending!;
    this.pending = null;
    if (job.origin === "local" && this.status !== "saving") this.setStatus("saving", null);

    if (!this.opts.isOnline()) {
      this.handleFailure(job, { kind: "offline" });
      return;
    }

    let release!: () => void;
    this.inFlight = new Promise<void>((resolve) => (release = resolve));
    try {
      const result = await this.opts.save(job.snapshot, this.expectedVersion).catch(toError);
      if (result.kind === "conflict") {
        // Someone else saved first: merge their copy into ours, then save the union.
        const rebased = await this.opts.rebase(job.snapshot).catch(toError);
        this.inFlight = null;
        this.handleRebase(job, rebased);
      } else {
        this.inFlight = null;
        this.handleResult(job, result);
      }
    } finally {
      this.inFlight = null;
      release();
    }
  }

  private handleResult(job: Job<S>, result: Exclude<SaveResult, { kind: "conflict" }>) {
    if (this.disposed) return;
    if (result.kind !== "ok") {
      this.handleFailure(job, result);
      return;
    }
    this.expectedVersion = result.version;
    this.savedFingerprint = job.fingerprint;
    this.retryDelay = this.opts.retryMinMs;
    this.opts.onSaved?.(job.snapshot, result.version, job.fingerprint);
    if (this.pending && this.pending.fingerprint === this.savedFingerprint) this.pending = null;
    if (this.pending) {
      // Changes arrived mid-save: coalesce them into the next save.
      this.queuePending();
    } else {
      this.setStatus("saved", null);
    }
  }

  private handleRebase(job: Job<S>, result: RebaseResult<S> | { kind: "error"; message?: string }) {
    if (this.disposed) return;
    switch (result.kind) {
      case "merged":
        this.expectedVersion = result.version;
        this.savedFingerprint = result.serverFingerprint;
        this.retryDelay = this.opts.retryMinMs;
        // The merged canvas is newer than anything queued while the merge ran.
        if (result.fingerprint === result.serverFingerprint) {
          this.pending = null;
          this.setStatus("saved", null);
        } else {
          this.pending = { snapshot: result.snapshot, fingerprint: result.fingerprint, origin: "local" };
          void this.flush();
        }
        return;
      case "gone":
        this.pending = null;
        this.setStatus("error", "failed");
        return;
      case "offline":
      case "error":
        this.handleFailure(job, result);
        return;
    }
  }

  private handleFailure(
    job: Job<S>,
    result: { kind: "offline" } | { kind: "tooLarge" } | { kind: "error"; message?: string },
  ) {
    if (this.disposed) return;
    switch (result.kind) {
      case "offline": {
        this.pending ??= job;
        this.setStatus("offline", null);
        this.clearRetry();
        const delay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, this.opts.retryMaxMs);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.flush();
        }, delay);
        return;
      }
      case "tooLarge":
        // Stop cloud saves until the next change; the local backup keeps working.
        this.setStatus("error", "tooLarge");
        return;
      case "error":
        this.pending ??= job;
        this.setStatus("error", "failed");
        return;
    }
  }

  private setStatus(status: SaveStatus, reason: ErrorReason) {
    const changed = status !== this.status || reason !== this.errorReason;
    this.status = status;
    this.errorReason = reason;
    if (status !== "saving") this.clearMaxWait();
    if (changed || status === "saved") this.opts.onChange?.(this.getState());
  }

  private clearDebounce() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = null;
    this.clearMaxWait();
  }

  private clearMaxWait() {
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.maxWaitTimer = null;
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

function toError(e: unknown): { kind: "error"; message: string } {
  return { kind: "error", message: e instanceof Error ? e.message : String(e) };
}
