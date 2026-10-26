import { PeerLinks, type PeerConnection } from "./peerLinks";
import type { RtcPayload } from "./protocol";

export type ScreenStatus = "off" | "starting" | "sharing";

/** Screen capture and WebRTC (browser APIs; fakes in tests). */
export interface ScreenMedia {
  /** False where the browser can't share a screen (phones, mostly). */
  canShare: boolean;
  /** Asks which screen, window or tab to share; the browser always prompts. */
  getDisplay: () => Promise<MediaStream>;
  createConnection: () => PeerConnection;
}

export interface ScreenShareOptions {
  /** This tab; collaborators address their signaling to it. */
  sessionId: string;
  media: ScreenMedia;
  /** Sends a signaling message on the board channel. */
  signal: (message: RtcPayload) => void;
  /** Sharing, viewers or the screen I watch changed. */
  onChange: () => void;
  /** Sharing ended from the browser's own "Stop sharing" button. */
  onEnded?: () => void;
  gatherMs?: number;
  connectTimeoutMs?: number;
  retryMs?: number;
  graceMs?: number;
}

/**
 * Screen sharing on one board (COLLAB-7). The sharer sends their screen as
 * one-way video to each viewer: they always offer, viewers only answer.
 * Presence says who's sharing; CollabSession picks the viewers and the
 * screen each tab watches.
 */
export class ScreenShare {
  private status: ScreenStatus = "off";
  private local: MediaStream | null = null;
  /** Bumped by stop(), so a start still waiting for the browser's picker gives up. */
  private startToken = 0;
  /** My screen, to viewers. */
  private readonly out: PeerLinks;
  /** Someone else's screen, to me. */
  private readonly in: PeerLinks;
  private watching: string | null = null;
  private readonly streams = new Map<string, MediaStream>();

  constructor(private readonly o: ScreenShareOptions) {
    const common = {
      sessionId: o.sessionId,
      media: "screen" as const,
      createConnection: () => o.media.createConnection(),
      signal: o.signal,
      onChange: o.onChange,
      gatherMs: o.gatherMs,
      connectTimeoutMs: o.connectTimeoutMs,
      retryMs: o.retryMs,
      graceMs: o.graceMs,
    };
    this.out = new PeerLinks({
      ...common,
      offersTo: () => true,
      addTracks: (pc) => {
        const local = this.local;
        for (const track of local?.getVideoTracks() ?? []) pc.addTrack(track, local!);
      },
    });
    this.in = new PeerLinks({
      ...common,
      offersTo: () => false,
      addTracks: () => undefined,
      onTrack: (peer, event) => {
        if (event.track.kind !== "video") return;
        this.streams.set(peer, event.streams[0] ?? new MediaStream([event.track]));
        o.onChange();
      },
      onClose: (peer) => this.streams.delete(peer),
    });
    // A sharer's offer can arrive before presence says they're sharing.
    this.in.start();
  }

  getStatus(): ScreenStatus {
    return this.status;
  }

  /** How many people my screen reaches right now. */
  get viewerCount(): number {
    return this.out.connectedCount;
  }

  /** The screen I'm watching, once its video arrives. */
  getStream(): MediaStream | null {
    return (this.watching && this.streams.get(this.watching)) || null;
  }

  /** Asks for a screen and shares it. Rejects with the browser's error (NotAllowedError when cancelled). */
  async start(): Promise<void> {
    if (this.status !== "off") return;
    const token = ++this.startToken;
    this.status = "starting";
    this.o.onChange();
    let stream: MediaStream;
    try {
      stream = await this.o.media.getDisplay();
    } catch (e) {
      if (token === this.startToken) {
        this.status = "off";
        this.o.onChange();
      }
      throw e;
    }
    if (token !== this.startToken) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.local = stream;
    for (const track of stream.getVideoTracks()) {
      // Text and lines stay sharp at the cost of frame rate.
      track.contentHint = "detail";
      track.addEventListener("ended", this.handleEnded);
    }
    this.status = "sharing";
    this.out.start();
    this.o.onChange();
  }

  stop() {
    this.startToken++;
    if (this.status === "off") return;
    this.out.stop();
    for (const track of this.local?.getTracks() ?? []) {
      track.removeEventListener("ended", this.handleEnded);
      track.stop();
    }
    this.local = null;
    this.status = "off";
    this.o.onChange();
  }

  /** Back on the board channel after losing it: send my screen afresh. */
  reconnected() {
    this.out.restart();
  }

  /** Who gets my screen while I share, by session id. */
  setViewers(sessionIds: Iterable<string>) {
    this.out.setMembers(sessionIds);
  }

  /** Whose screen to watch, or nobody's. */
  watch(sharer: string | null) {
    if (sharer === this.watching) return;
    this.watching = sharer;
    this.in.setMembers(sharer ? [sharer] : []);
    this.o.onChange();
  }

  /** A signaling message from the board channel (already schema-checked). */
  receive(message: RtcPayload) {
    // Offers are for what I watch, answers for what I share.
    if (message.kind === "offer") this.in.receive(message);
    else this.out.receive(message);
  }

  dispose() {
    this.stop();
    this.in.stop();
    this.streams.clear();
  }

  private readonly handleEnded = () => {
    this.stop();
    this.o.onEnded?.();
  };
}
