import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveQueue, type RebaseResult, type SaveQueueState, type SaveResult } from "./saveQueue";

type Snap = { n: number };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(opts: { online?: () => boolean } = {}) {
  const calls: Array<{ snap: Snap; expected: number; done: (r: SaveResult) => void }> = [];
  const rebases: Array<{ snap: Snap; done: (r: RebaseResult<Snap>) => void }> = [];
  const states: SaveQueueState[] = [];
  const saved: number[] = [];
  const queue = new SaveQueue<Snap>({
    initialVersion: 1,
    save: (snap, expected) => {
      const d = deferred<SaveResult>();
      calls.push({ snap, expected, done: d.resolve });
      return d.promise;
    },
    rebase: (snap) => {
      const d = deferred<RebaseResult<Snap>>();
      rebases.push({ snap, done: d.resolve });
      return d.promise;
    },
    onChange: (s) => states.push(s),
    onSaved: (_snap, v) => saved.push(v),
    isOnline: opts.online ?? (() => true),
  });
  queue.setBaseline("fp0");
  return { queue, calls, rebases, states, saved, status: () => queue.getState().status };
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

describe("SaveQueue (tech §7.2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignores changes that match what the server has", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 0 }, "fp0");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(0);
    expect(status()).toBe("saved");
  });

  it("debounces 1.5 s after the last change and saves the latest snapshot", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    expect(status()).toBe("saving");
    await vi.advanceTimersByTimeAsync(1000);
    queue.notifyChange({ n: 2 }, "fp2");
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.snap).toEqual({ n: 2 });
    expect(calls[0]!.expected).toBe(1);
  });

  it("forces a save after at most 10 s of continuous editing", async () => {
    const { queue, calls } = setup();
    for (let t = 0; t < 10_000; t += 500) {
      queue.notifyChange({ n: t }, `edit-${t}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(calls).toHaveLength(1);
  });

  it("stores the returned version and reports saved", async () => {
    const { queue, calls, saved, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(status()).toBe("saved");
    expect(saved).toEqual([2]);
    expect(queue.getState().expectedVersion).toBe(2);
  });

  it("keeps one request in flight and coalesces changes into the next save", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);

    queue.notifyChange({ n: 2 }, "fp2");
    queue.notifyChange({ n: 3 }, "fp3");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1); // still waiting on the first

    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(status()).toBe("saving");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snap).toEqual({ n: 3 });
    expect(calls[1]!.expected).toBe(2);
  });

  it("flush() saves right away and waits for an in-flight save first", async () => {
    const { queue, calls } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    const first = queue.flush();
    expect(calls).toHaveLength(1);
    queue.notifyChange({ n: 2 }, "fp2");
    const second = queue.flush();
    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    calls[1]!.done({ kind: "ok", version: 3 });
    await Promise.all([first, second]);
    expect(queue.hasPending()).toBe(false);
    expect(queue.getState().expectedVersion).toBe(3);
  });

  it("a conflict merges with the server's copy, then saves the union (COLLAB-2)", async () => {
    const { queue, calls, rebases, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "conflict" });
    await flushMicrotasks();
    expect(rebases).toHaveLength(1);
    expect(rebases[0]!.snap).toEqual({ n: 1 });
    expect(status()).toBe("saving");

    rebases[0]!.done({
      kind: "merged",
      version: 5,
      serverFingerprint: "srv",
      snapshot: { n: 9 },
      fingerprint: "fp9",
    });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.expected).toBe(5);
    expect(calls[1]!.snap).toEqual({ n: 9 });
    calls[1]!.done({ kind: "ok", version: 6 });
    await flushMicrotasks();
    expect(status()).toBe("saved");
    expect(queue.getState().expectedVersion).toBe(6);
  });

  it("a merge that equals the server's copy needs no second save", async () => {
    const { queue, calls, rebases, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1", "remote");
    await vi.advanceTimersByTimeAsync(15_000);
    calls[0]!.done({ kind: "conflict" });
    await flushMicrotasks();
    rebases[0]!.done({
      kind: "merged",
      version: 4,
      serverFingerprint: "srv",
      snapshot: { n: 4 },
      fingerprint: "srv",
    });
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    expect(status()).toBe("saved");
    expect(queue.getState().expectedVersion).toBe(4);

    // Changes on top of the merged scene save against the server's version.
    queue.notifyChange({ n: 5 }, "fp5");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[1]!.expected).toBe(4);
  });

  it("changes made during a merge are covered by the merged canvas", async () => {
    const { queue, calls, rebases } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "conflict" });
    await flushMicrotasks();
    queue.notifyChange({ n: 2 }, "fp2"); // drawn while the server copy loads
    rebases[0]!.done({
      kind: "merged",
      version: 3,
      serverFingerprint: "srv",
      snapshot: { n: 22 },
      fingerprint: "fp22",
    });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snap).toEqual({ n: 22 });
  });

  it("a board that's gone (trashed or unshared) stops saving", async () => {
    const { queue, calls, rebases, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "conflict" });
    await flushMicrotasks();
    rebases[0]!.done({ kind: "gone" });
    await flushMicrotasks();
    expect(status()).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it("an offline merge retries with backoff", async () => {
    const { queue, calls, rebases, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "conflict" });
    await flushMicrotasks();
    rebases[0]!.done({ kind: "offline" });
    await flushMicrotasks();
    expect(status()).toBe("offline");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snap).toEqual({ n: 1 });
  });

  it("a collaborator's change waits for their save, then falls back after 15 s", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fpR", "remote");
    expect(status()).toBe("saved");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls).toHaveLength(0);
    queue.notifyChange({ n: 2 }, "fpR2", "remote"); // more of theirs: the fallback doesn't restart
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.snap).toEqual({ n: 2 });
  });

  it("adopting a collaborator's save cancels the fallback and moves the version", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fpR", "remote");
    queue.adoptRemoteSave(4, "fpR");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(0);
    expect(status()).toBe("saved");
    expect(queue.getState().expectedVersion).toBe(4);

    // Their scene is now the baseline: going back to it is a no-op, changes save on top.
    queue.notifyChange({ n: 1 }, "fpR");
    expect(queue.hasPending()).toBe(false);
    queue.notifyChange({ n: 5 }, "fp5");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[0]!.expected).toBe(4);
  });

  it("ignores stale or mid-save adoptions", async () => {
    const { queue, calls } = setup();
    queue.adoptRemoteSave(1, "old");
    expect(queue.getState().expectedVersion).toBe(1);
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    queue.adoptRemoteSave(9, "theirs"); // our save is in flight: it will conflict and merge instead
    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(queue.getState().expectedVersion).toBe(2);
  });

  it("my own change saves promptly even while a collaborator's waits", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fpR", "remote");
    queue.notifyChange({ n: 2 }, "fp2", "local");
    expect(status()).toBe("saving");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.snap).toEqual({ n: 2 });
  });

  it("goes offline, retries with exponential backoff (2 s → 30 s cap)", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = Date.now();
      calls[i]!.done({ kind: "offline" });
      await flushMicrotasks();
      expect(status()).toBe("offline");
      while (calls.length === i + 1) await vi.advanceTimersByTimeAsync(100);
      delays.push(Math.round((Date.now() - before) / 1000));
    }
    expect(delays).toEqual([2, 4, 8, 16, 30, 30]);
  });

  it("offline: new changes ride along with the next retry", async () => {
    const { queue, calls } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "offline" });
    await flushMicrotasks();
    queue.notifyChange({ n: 2 }, "fp2");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snap).toEqual({ n: 2 });
  });

  it("retries right away when the browser comes back online", async () => {
    let online = true;
    const { queue, calls, status } = setup({ online: () => online });
    online = false;
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(0); // never hit the network while offline
    expect(status()).toBe("offline");

    online = true;
    queue.handleOnline();
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(status()).toBe("saved");
  });

  it("errors wait for a manual retry", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "error", message: "RLS" });
    await flushMicrotasks();
    expect(status()).toBe("error");
    expect(queue.getState().errorReason).toBe("failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);

    void queue.retry();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snap).toEqual({ n: 1 });
  });

  it("a thrown save is treated as an error, not an unhandled rejection", async () => {
    const queue = new SaveQueue<Snap>({
      initialVersion: 1,
      save: () => Promise.reject(new Error("boom")),
      rebase: () => Promise.resolve({ kind: "gone" }),
      isOnline: () => true,
    });
    queue.notifyChange({ n: 1 }, "fp1");
    await queue.flush();
    expect(queue.getState().status).toBe("error");
  });

  it("too large: stops cloud saves until the next change (SAVE-6)", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.done({ kind: "tooLarge" });
    await flushMicrotasks();
    expect(status()).toBe("error");
    expect(queue.getState().errorReason).toBe("tooLarge");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);

    queue.notifyChange({ n: 2 }, "fp2");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
  });

  it("undoing back to the saved state cancels the pending save", async () => {
    const { queue, calls, status } = setup();
    queue.notifyChange({ n: 1 }, "fp1");
    queue.notifyChange({ n: 0 }, "fp0");
    expect(status()).toBe("saved");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(0);
  });

  it("reports pending work for beforeunload", async () => {
    const { queue, calls } = setup();
    expect(queue.hasPending()).toBe(false);
    queue.notifyChange({ n: 1 }, "fp1");
    expect(queue.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(queue.hasPending()).toBe(true); // in flight
    calls[0]!.done({ kind: "ok", version: 2 });
    await flushMicrotasks();
    expect(queue.hasPending()).toBe(false);
  });
});
