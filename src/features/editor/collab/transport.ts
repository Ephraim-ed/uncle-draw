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

/** Channels still leaving, by topic. A new channel on the same topic waits for them. */
const closing = new Map<string, Promise<unknown>>();

/**
 * The board's private Realtime channel (tech §15). Realtime RLS on
 * `realtime.messages` lets only the owner and editors join.
 */
export function boardChannel(boardId: string, sessionId: string): ConnectFn {
  return (handlers) => {
    const topic = `board:${boardId}`;
    let channel: RealtimeChannel | null = null;
    let joined = false;
    let closed = false;

    void (async () => {
      await closing.get(topic);
      if (closed) return;
      const ch = supabase.channel(topic, {
        config: { private: true, broadcast: { self: false }, presence: { key: sessionId } },
      });
      channel = ch;
      for (const event of COLLAB_EVENTS) {
        ch.on("broadcast", { event }, (message: { payload?: unknown }) =>
          handlers.onMessage(event, message.payload),
        );
      }
      ch.on("presence", { event: "sync" }, () => {
        const peers: PresenceMeta[] = [];
        for (const entries of Object.values(ch.presenceState())) {
          const parsed = presenceSchema.safeParse(entries[0]);
          if (parsed.success) peers.push(parsed.data);
        }
        handlers.onPresence(peers);
      });
      ch.subscribe((status) => {
        if (closed) return;
        const now = status === "SUBSCRIBED";
        if (now !== joined || now) {
          joined = now;
          handlers.onStatus(now);
        }
      });
    })();

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
        const ch = channel;
        if (!ch) return Promise.resolve();
        const done: Promise<unknown> = supabase
          .removeChannel(ch)
          .catch(() => undefined)
          .finally(() => {
            if (closing.get(topic) === done) closing.delete(topic);
          });
        closing.set(topic, done);
        return done.then(() => undefined);
      },
    };
  };
}
