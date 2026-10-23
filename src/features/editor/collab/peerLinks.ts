import {
  PEER_CONNECT_TIMEOUT_MS,
  PEER_GATHER_MS,
  PEER_PRESENCE_GRACE_MS,
  PEER_RETRY_MAX_MS,
  PEER_RETRY_MIN_MS,
} from "../constants";
import type { RtcPayload } from "./protocol";

/** The parts of RTCPeerConnection the board uses (a fake in tests). */
export type PeerConnection = Pick<
  RTCPeerConnection,
  | "addTrack"
  | "createOffer"
  | "createAnswer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "localDescription"
  | "iceGatheringState"
  | "connectionState"
  | "signalingState"
  | "addEventListener"
  | "removeEventListener"
  | "close"
>;

export interface PeerLinksOptions {
  /** This tab; collaborators address their signaling to it. */
  sessionId: string;
  /** What these connections carry; it goes with every signaling message. */
  media: RtcPayload["m"];
  createConnection: () => PeerConnection;
  /** Sends a signaling message on the board channel. */
  signal: (message: RtcPayload) => void;
  /** Whether I offer to this peer (they answer) or wait for their offer. */
  offersTo: (peer: string) => boolean;
  /** Adds my outgoing tracks to a new connection. */
  addTracks: (pc: PeerConnection) => void;
  /** Media arrived from a peer. */
  onTrack?: (peer: string, event: RTCTrackEvent) => void;
  /** The connection to a peer closed: drop whatever came from it. */
  onClose?: (peer: string) => void;
  /** A connection came up, went down or closed. */
  onChange: () => void;
  gatherMs?: number;
  connectTimeoutMs?: number;
  retryMs?: number;
  graceMs?: number;
}

interface Link {
  peer: string;
  /** This connection attempt; signaling for any other is stale. */
  id: string;
  offerer: boolean;
  pc: PeerConnection;
  createdAt: number;
  connected: boolean;
  /** Gives up on a connection that doesn't come up in time. */
  timer: ReturnType<typeof setTimeout> | null;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Resolves once every ICE candidate is in the local description, or after `ms`. */
function gatherCandidates(pc: PeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/**
 * WebRTC connections from this tab to a set of peers (COLLAB-5/7), signaled
 * over the board channel.
 *
 * - The members come from presence. Exactly one side of each pair offers
 *   (offersTo), so two offers never cross.
 * - Offers and answers carry all ICE candidates in the SDP: one message
 *   each way, addressed to one tab.
 * - A connection that fails or doesn't come up is started over by its
 *   offerer, backing off up to 30 s.
 * - A fresh offer from someone presence doesn't list yet gets a few seconds
 *   for presence to catch up before it's dropped.
 */
export class PeerLinks {
  private active = false;
  private readonly links = new Map<string, Link>();
  private members = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly gatherMs: number;
  private readonly connectTimeoutMs: number;
  private readonly retryMs: number;
  private readonly graceMs: number;

  constructor(private readonly o: PeerLinksOptions) {
    this.gatherMs = o.gatherMs ?? PEER_GATHER_MS;
    this.connectTimeoutMs = o.connectTimeoutMs ?? PEER_CONNECT_TIMEOUT_MS;
    this.retryMs = o.retryMs ?? PEER_RETRY_MIN_MS;
    this.graceMs = o.graceMs ?? PEER_PRESENCE_GRACE_MS;
  }

  /** Connects to the members, and takes offers. */
  start() {
    this.active = true;
    this.sync();
  }

  /** Hangs up on everyone. */
  stop() {
    this.active = false;
    for (const peer of [...this.links.keys()]) this.closeLink(peer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.attempts.clear();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  /** The peers to be connected to, by session id (from presence). */
  setMembers(sessionIds: Iterable<string>) {
    this.members = new Set([...sessionIds].filter((id) => id !== this.o.sessionId));
    this.sync();
  }

  isConnected(peer: string): boolean {
    return !!this.links.get(peer)?.connected;
  }

  get connectedCount(): number {
    let count = 0;
    for (const link of this.links.values()) if (link.connected) count++;
    return count;
  }

  /** A signaling message from the board channel (already schema-checked). */
  receive(message: RtcPayload) {
    if (message.m !== this.o.media || message.to !== this.o.sessionId || message.s === this.o.sessionId)
      return;
    if (!this.active) return;
    if (message.kind === "offer") void this.answer(message);
    else void this.acceptAnswer(message);
  }

  // --- connections -------------------------------------------------------------

  /** Opens connections to new members and closes them to people who left. */
  private sync() {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (!this.active) return;
    const now = Date.now();
    let recheck = Infinity;
    for (const link of [...this.links.values()]) {
      if (this.members.has(link.peer)) continue;
      const wait = link.createdAt + this.graceMs - now;
      if (wait <= 0) this.closeLink(link.peer);
      else recheck = Math.min(recheck, wait);
    }
    for (const [peer, timer] of this.retryTimers) {
      if (this.members.has(peer)) continue;
      clearTimeout(timer);
      this.retryTimers.delete(peer);
      this.attempts.delete(peer);
    }
    for (const peer of this.members) {
      if (this.o.offersTo(peer) && !this.links.has(peer) && !this.retryTimers.has(peer))
        void this.offer(peer);
    }
    if (recheck < Infinity) this.graceTimer = setTimeout(() => this.sync(), recheck);
  }

  private openLink(peer: string, id: string, offerer: boolean): Link {
    this.closeLink(peer);
    const pc = this.o.createConnection();
    const link: Link = { peer, id, offerer, pc, createdAt: Date.now(), connected: false, timer: null };
    pc.addEventListener("track", (event) => {
      if (this.links.get(peer) === link) this.o.onTrack?.(peer, event);
    });
    pc.addEventListener("connectionstatechange", () => this.handleState(link));
    this.links.set(peer, link);
    this.armTimeout(link);
    return link;
  }

  private async offer(peer: string) {
    const link = this.openLink(peer, newId(), true);
    try {
      this.o.addTracks(link.pc);
      await link.pc.setLocalDescription(await link.pc.createOffer());
      await gatherCandidates(link.pc, this.gatherMs);
      if (this.links.get(peer) !== link || !link.pc.localDescription) return;
      this.o.signal({
        s: this.o.sessionId,
        to: peer,
        m: this.o.media,
        id: link.id,
        kind: "offer",
        sdp: link.pc.localDescription.sdp,
      });
    } catch {
      if (this.links.get(peer) === link) this.fail(link);
    }
  }

  private async answer(message: RtcPayload) {
    const peer = message.s;
    // Only one side offers; a duplicate offer changes nothing.
    if (this.o.offersTo(peer) || this.links.get(peer)?.id === message.id) return;
    const link = this.openLink(peer, message.id, false);
    try {
      await link.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      if (this.links.get(peer) !== link) return;
      this.o.addTracks(link.pc);
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      await gatherCandidates(link.pc, this.gatherMs);
      if (this.links.get(peer) !== link || !link.pc.localDescription) return;
      this.o.signal({
        s: this.o.sessionId,
        to: peer,
        m: this.o.media,
        id: link.id,
        kind: "answer",
        sdp: link.pc.localDescription.sdp,
      });
    } catch {
      // The offerer starts over when its connection times out.
      if (this.links.get(peer) === link) this.closeLink(peer);
    }
  }

  private async acceptAnswer(message: RtcPayload) {
    const link = this.links.get(message.s);
    if (!link || !link.offerer || link.id !== message.id || link.pc.signalingState !== "have-local-offer")
      return;
    try {
      await link.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
    } catch {
      if (this.links.get(message.s) === link) this.fail(link);
    }
  }

  private handleState(link: Link) {
    if (this.links.get(link.peer) !== link) return;
    switch (link.pc.connectionState) {
      case "connected":
        link.connected = true;
        if (link.timer) clearTimeout(link.timer);
        link.timer = null;
        this.attempts.delete(link.peer);
        this.o.onChange();
        return;
      case "disconnected":
        // Often comes back by itself; if it doesn't, start over.
        if (link.connected) {
          link.connected = false;
          this.armTimeout(link);
          this.o.onChange();
        }
        return;
      case "failed":
        this.fail(link);
        return;
    }
  }

  private armTimeout(link: Link) {
    if (link.timer) clearTimeout(link.timer);
    link.timer = setTimeout(() => {
      link.timer = null;
      if (this.links.get(link.peer) === link && !link.connected) this.fail(link);
    }, this.connectTimeoutMs);
  }

  /** Drops a broken connection; its offerer tries again after a backoff. */
  private fail(link: Link) {
    const { peer } = link;
    this.closeLink(peer);
    if (!link.offerer || !this.active || !this.members.has(peer) || this.retryTimers.has(peer)) return;
    const attempts = (this.attempts.get(peer) ?? 0) + 1;
    this.attempts.set(peer, attempts);
    const wait = Math.min(this.retryMs * 2 ** (attempts - 1), PEER_RETRY_MAX_MS);
    this.retryTimers.set(
      peer,
      setTimeout(() => {
        this.retryTimers.delete(peer);
        if (this.active && this.members.has(peer) && !this.links.has(peer)) void this.offer(peer);
      }, wait),
    );
  }

  private closeLink(peer: string) {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    if (link.timer) clearTimeout(link.timer);
    link.pc.close();
    this.o.onClose?.(peer);
    this.o.onChange();
  }
}
