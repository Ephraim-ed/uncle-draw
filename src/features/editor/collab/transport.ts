import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase";
import { COLLAB_EVENTS, presenceSchema, type CollabEvent, type PresenceMeta } from "./protocol";

export interface TransportHandlers {
  onMessage: (event: CollabEvent, payload: unknown) => void;
  /** Everyone in the channel, this tab included. */
  onPresence: (peers: PresenceMeta[]) => void;
  /** True once joined (again, after a reconnect); false while disconnected. */
  onStatus: (connected: boolean) => void;
}

export interface CollabTransport {
  /** Fire-and-forget; dropped while disconnected (callers keep what must be resent). */
  send: (event: CollabEvent, payload: object) => void;
  track: (meta: PresenceMeta) => void;
  close: () => Promise<void>;
}

export type ConnectFn = (handlers: TransportHandlers) => CollabTransport;

/** The parts of the Supabase client the channel uses (a fake in tests). */
export interface RealtimeClient {
  channel: (typeof supabase)["channel"];
  removeChannel: (channel: RealtimeChannel) => Promise<unknown>;
  /** With no token: fetches a fresh one (refreshing an expired session) for new joins. */
  realtime: { setAuth: () => Promise<void> };
}

/** Rejoining a closed channel waits 1 s, then 2 s, 4 s … up to 30 s. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** A channel that errored and hasn't rejoined by itself after this is rebuilt. */
const STUCK_MS = 10_000;

/** Channels still leaving, by topic. A new channel on the same topic waits for them. */
const closing = new Map<string, Promise<unknown>>();

/**
 * The board's private Realtime channel (tech §15). Realtime RLS on
 * `realtime.messages` lets only the owner and editors join.
 *
 * It keeps itself joined. realtime-js rejoins after a dropped connection,
 * but a channel the server closes (as it does when the access token
 * expires, which happens in hidden tabs: supabase-js only refreshes tokens
 * while the tab is visible) is gone for good, and a rejoin with an expired
 * token keeps failing. So a closed or stuck channel is replaced by a new one
 * with a fresh token, backing off up to 30 s, and right away when the tab
 * becomes visible or the browser comes back online.
 */
export function boardChannel(
  boardId: string,
  sessionId: string,
  client: RealtimeClient = supabase,
): ConnectFn {
  return (handlers) => {
    const topic = `board:${boardId}`;
    let channel: RealtimeChannel | null = null;
    /** Bumped for every new channel: callbacks from an older one are ignored. */
    let generation = 0;
    let joined = false;
    /** A channel was created and hasn't reported back yet. */
    let joining = false;
    let closed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stuckTimer: ReturnType<typeof setTimeout> | null = null;

    const setJoined = (now: boolean) => {
      if (now !== joined || now) {
        joined = now;
        handlers.onStatus(now);
      }
    };

    const clearTimers = () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (stuckTimer) clearTimeout(stuckTimer);
      retryTimer = null;
      stuckTimer = null;
    };

    const leave = (ch: RealtimeChannel) => {
      const done: Promise<unknown> = client
        .removeChannel(ch)
        .catch(() => undefined)
        .finally(() => {
          if (closing.get(topic) === done) closing.delete(topic);
        });
      closing.set(topic, done);
      return done;
    };

    const open = async () => {
      const gen = ++generation;
      joining = true;
      await closing.get(topic);
      if (closed || gen !== generation) return;
      const ch = client.channel(topic, {
        config: { private: true, broadcast: { self: false }, presence: { key: sessionId } },
      });
      channel = ch;
      for (const event of COLLAB_EVENTS) {
        ch.on("broadcast", { event }, (message: { payload?: unknown }) => {
          if (gen === generation) handlers.onMessage(event, message.payload);
        });
      }
      ch.on("presence", { event: "sync" }, () => {
        if (gen !== generation) return;
        const peers: PresenceMeta[] = [];
        for (const entries of Object.values(ch.presenceState())) {
          const parsed = presenceSchema.safeParse(entries[0]);
          if (parsed.success) peers.push(parsed.data);
        }
        handlers.onPresence(peers);
      });
      ch.subscribe((status) => {
        if (closed || gen !== generation) return;
        joining = false;
        if (status === "SUBSCRIBED") {
          attempts = 0;
          clearTimers();
          setJoined(true);
          return;
        }
        setJoined(false);
        if (status === "CLOSED") {
          // Closed by the server: realtime-js won't rejoin it.
          scheduleRebuild();
        } else {
          // CHANNEL_ERROR or TIMED_OUT: realtime-js retries by itself, but not with a fresh token.
          stuckTimer ??= setTimeout(() => {
            stuckTimer = null;
            if (!joined) scheduleRebuild();
          }, STUCK_MS);
        }
      });
    };

    /** Replaces the channel with a new one, joined with a fresh token. */
    const rebuild = async () => {
      if (closed) return;
      clearTimers();
      const old = channel;
      channel = null;
      generation++;
      joining = true;
      if (old) await leave(old);
      try {
        await client.realtime.setAuth();
      } catch {
        // The join reports it, and we try again.
      }
      if (!closed) void open();
    };

    const scheduleRebuild = () => {
      if (closed || retryTimer) return;
      const wait = Math.min(RETRY_MIN_MS * 2 ** attempts, RETRY_MAX_MS);
      attempts++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void rebuild();
      }, wait);
    };

    /** Back in view, or back online: rejoin now rather than after the backoff. */
    const wake = () => {
      if (closed || joined || joining) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      attempts = 0;
      void rebuild();
    };
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("online", wake);
    }

    void open();

    return {
      send(event, payload) {
        if (joined && channel) void channel.send({ type: "broadcast", event, payload });
      },
      track(meta) {
        if (joined && channel) void channel.track(meta);
      },
      close() {
        closed = true;
        joined = false;
        clearTimers();
        generation++;
        if (typeof window !== "undefined") {
          document.removeEventListener("visibilitychange", wake);
          window.removeEventListener("online", wake);
        }
        const ch = channel;
        channel = null;
        if (!ch) return Promise.resolve();
        return leave(ch).then(() => undefined);
      },
    };
  };
}
