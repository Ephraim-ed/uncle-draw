import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardChannel, type CollabTransport, type RealtimeClient, type TransportHandlers } from "./transport";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

/** A Realtime channel that reports whatever status the test says. */
class FakeChannel {
  private statusCb: ((status: Status) => void) | null = null;
  readonly listeners: Array<{ type: string; filter: { event: string }; cb: (m: unknown) => void }> = [];
  readonly sent: unknown[] = [];
  presence: Record<string, unknown[]> = {};
  constructor(
    readonly topic: string,
    readonly opts: unknown,
  ) {}
  on(type: string, filter: { event: string }, cb: (m: unknown) => void) {
    this.listeners.push({ type, filter, cb });
    return this;
  }
  subscribe(cb: (status: Status) => void) {
    this.statusCb = cb;
    return this;
  }
  presenceState() {
    return this.presence;
  }
  send(message: unknown) {
    this.sent.push(message);
    return Promise.resolve("ok");
  }
  track() {
    return Promise.resolve("ok");
  }
  report(status: Status) {
    this.statusCb?.(status);
  }
  emit(type: string, event: string, message: unknown) {
    for (const l of this.listeners) if (l.type === type && l.filter.event === event) l.cb(message);
  }
}

function setup() {
  const channels: FakeChannel[] = [];
  const client = {
    channel: (topic: string, opts: unknown) => {
      const ch = new FakeChannel(topic, opts);
      channels.push(ch);
      return ch as unknown as RealtimeChannel;
    },
    removeChannel: vi.fn(async () => "ok"),
    realtime: { setAuth: vi.fn(async () => undefined) },
  } as unknown as RealtimeClient;
  const handlers: TransportHandlers = { onMessage: vi.fn(), onPresence: vi.fn(), onStatus: vi.fn() };
  const transport: CollabTransport = boardChannel("b1", "me", client)(handlers);
  const latest = () => channels.at(-1)!;
  return { client, channels, handlers, transport, latest };
}

describe("boardChannel (tech §15)", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    vi.useFakeTimers();
    t = setup();
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(async () => {
    await t.transport.close();
    vi.useRealTimers();
  });

  it("joins the board's private channel and passes messages and presence on", () => {
    expect(t.channels).toHaveLength(1);
    expect(t.latest().topic).toBe("board:b1");
    expect(t.latest().opts).toMatchObject({ config: { private: true, presence: { key: "me" } } });

    t.transport.send("tick", { s: "me" });
    expect(t.latest().sent).toHaveLength(0); // not joined yet

    t.latest().report("SUBSCRIBED");
    expect(t.handlers.onStatus).toHaveBeenLastCalledWith(true);
    t.transport.send("tick", { s: "me" });
    expect(t.latest().sent).toEqual([{ type: "broadcast", event: "tick", payload: { s: "me" } }]);

    t.latest().emit("broadcast", "hello", { payload: { s: "pat" } });
    expect(t.handlers.onMessage).toHaveBeenCalledWith("hello", { s: "pat" });
    t.latest().presence = { pat: [{ sessionId: "pat", userId: "u", name: "Pat" }] };
    t.latest().emit("presence", "sync", {});
    expect(t.handlers.onPresence).toHaveBeenCalledWith([expect.objectContaining({ sessionId: "pat" })]);
  });

  it("a channel the server closes (an expired token) is replaced, with a fresh token", async () => {
    const first = t.latest();
    first.report("SUBSCRIBED");
    first.report("CLOSED");
    expect(t.handlers.onStatus).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(t.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.client.removeChannel).toHaveBeenCalledWith(first);
    expect(t.client.realtime.setAuth).toHaveBeenCalledWith();
    expect(t.channels).toHaveLength(2);

    t.latest().report("SUBSCRIBED");
    expect(t.handlers.onStatus).toHaveBeenLastCalledWith(true);
    // The old channel has nothing more to say.
    vi.mocked(t.handlers.onStatus).mockClear();
    first.report("CLOSED");
    first.emit("broadcast", "tick", { payload: {} });
    expect(t.handlers.onStatus).not.toHaveBeenCalled();
    expect(t.handlers.onMessage).not.toHaveBeenCalled();
  });

  it("backs off while rejoining keeps failing, and starts over once it works", async () => {
    t.latest().report("CLOSED");
    await vi.advanceTimersByTimeAsync(1000);
    t.latest().report("CLOSED");
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.channels).toHaveLength(3);
    t.latest().report("CLOSED");
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.channels).toHaveLength(4);

    t.latest().report("SUBSCRIBED");
    t.latest().report("CLOSED");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.channels).toHaveLength(5);
  });

  it("an errored channel gets a chance to rejoin by itself before it's replaced", async () => {
    t.latest().report("SUBSCRIBED");
    t.latest().report("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(5000);
    t.latest().report("SUBSCRIBED"); // realtime-js rejoined after the connection came back
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.channels).toHaveLength(1);

    t.latest().report("TIMED_OUT");
    await vi.advanceTimersByTimeAsync(10_000 + 1000);
    expect(t.channels).toHaveLength(2);
  });

  it("coming back to the tab, or back online, rejoins right away", async () => {
    for (let i = 0; i < 4; i++) {
      t.latest().report("CLOSED");
      await vi.advanceTimersByTimeAsync(2 ** i * 1000);
    }
    t.latest().report("CLOSED"); // the next try is 16 s away
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.channels).toHaveLength(6);

    // Already joining: no second channel.
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.channels).toHaveLength(6);

    t.latest().report("CLOSED");
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.channels).toHaveLength(7);
  });

  it("once closed, it stays closed", async () => {
    const ch = t.latest();
    ch.report("SUBSCRIBED");
    await t.transport.close();
    expect(t.client.removeChannel).toHaveBeenCalledWith(ch);
    ch.report("CLOSED");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.channels).toHaveLength(1);
  });
});
