import { RETRY_MAX_MS, RETRY_MIN_MS, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS } from "./constants";

/** Save-status pill states (tech §7.3). */
export type SaveStatus = "saved" | "saving" | "offline" | "error" | "conflict";

export type SaveResult =
  | { kind: "ok"; version: number }
  /** save_board returned null: the board changed elsewhere (or was trashed). */
  | { kind: "conflict" }
  /** The server couldn't be reached. Retried with backoff. */
  | { kind: "offline" }
  /** Payload over the hard limit (SAVE-6). Not retried until the next change. */
  | { kind: "tooLarge" }
  | { kind: "error"; message?: string };

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
  onChange?: (state: SaveQueueState) => void;
  onSaved?: (snapshot: S, version: number) => void;
  isOnline?: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
}

/**
 * Autosave queue (tech §7.2): debounced 1.5 s after the last change, forced
 * after at most 10 s of continuous editing, one request in flight at a time,
 * and changes made during a save coalesced into the next one. A conflict
 * pauses autosave until the user chooses; offline retries with backoff.
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
  private pending: { snapshot: S; fingerprint: string } | null = null;
  private inFlight: Promise<void> | null = null;
  private paused = false;
  private disposed = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay: number;

  constructor(options: SaveQueueOptions<S>) {
    this.opts = {
      debounceMs: SAVE_DEBOUNCE_MS,
      maxWaitMs: SAVE_MAX_WAIT_MS,
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
  notifyChange(snapshot: S, fingerprint: string) {
    if (this.disposed) return;
    if (fingerprint === this.savedFingerprint && !this.inFlight) {
      // Back to what the server has (e.g. undo): nothing to save.
      if (this.pending) {
        this.pending = null;
        this.clearDebounce();
        if (!this.paused && this.status !== "offline") this.setStatus("saved", null);
      }
      return;
    }
    this.pending = { snapshot, fingerprint };
    if (this.paused) return; // conflict: wait for the user's choice
    if (this.status === "offline" && this.retryTimer) return; // the retry picks up the latest change
    if (this.status !== "saving") this.setStatus("saving", null);
    this.schedule();
  }

  /** Save right away (Ctrl/Cmd+S, tab hidden, leaving the editor, sign-out). */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearDebounce();
    this.clearRetry();
    if (this.paused) return Promise.resolve();
    if (this.inFlight) {
      // Coalesce: once the current request settles, save whatever is newest.
      return this.inFlight.then(() => (this.pending && !this.paused ? this.flush() : undefined));
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

  /** Conflict → "Keep my version": overwrite using the server's current version. */
  resumeWith(version: number, snapshot: S, fingerprint: string): Promise<void> {
    this.paused = false;
    this.expectedVersion = version;
    this.pending = { snapshot, fingerprint };
    return this.flush();
  }

  /** Conflict → "Load the latest": the canvas now matches the server. */
  resetTo(version: number, fingerprint: string) {
    this.paused = false;
    this.clearDebounce();
    this.clearRetry();
    this.pending = null;
    this.expectedVersion = version;
    this.savedFingerprint = fingerprint;
    this.setStatus("saved", null);
  }

  dispose() {
    this.disposed = true;
    this.clearDebounce();
    this.clearRetry();
  }

  // ---------------------------------------------------------------------

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
    if (this.status !== "saving") this.setStatus("saving", null);

    if (!this.opts.isOnline()) {
      this.handleResult(job, { kind: "offline" });
      return;
    }

    let release!: () => void;
    this.inFlight = new Promise<void>((resolve) => (release = resolve));
    try {
      const result = await this.opts
        .save(job.snapshot, this.expectedVersion)
        .catch((e: unknown): SaveResult => ({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }));
      this.inFlight = null;
      this.handleResult(job, result);
    } finally {
      this.inFlight = null;
      release();
    }
  }

  private handleResult(job: { snapshot: S; fingerprint: string }, result: SaveResult) {
    if (this.disposed) return;
    switch (result.kind) {
      case "ok": {
        this.expectedVersion = result.version;
        this.savedFingerprint = job.fingerprint;
        this.retryDelay = this.opts.retryMinMs;
        this.opts.onSaved?.(job.snapshot, result.version);
        if (this.pending && this.pending.fingerprint === this.savedFingerprint) this.pending = null;
        if (this.pending) {
          // Changes arrived mid-save: coalesce them into the next save.
          this.setStatus("saving", null);
          this.schedule();
        } else {
          this.setStatus("saved", null);
        }
        return;
      }
      case "conflict":
        this.pending ??= job;
        this.paused = true;
        this.clearDebounce();
        this.setStatus("conflict", null);
        return;
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
