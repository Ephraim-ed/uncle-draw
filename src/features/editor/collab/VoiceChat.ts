import { VOICE_METER_MS, VOICE_SPEAKING_HOLD_MS, VOICE_SPEAKING_LEVEL } from "../constants";
import { PeerLinks, type PeerConnection } from "./peerLinks";
import type { RtcPayload } from "./protocol";

export type { PeerConnection } from "./peerLinks";

export type VoiceStatus = "off" | "joining" | "on";

export interface Meter {
  /** Loudness right now, as RMS from 0 to 1. */
  level: () => number;
  stop: () => void;
}

/** Microphone, WebRTC and audio output (browser APIs; fakes in tests). */
export interface VoiceMedia {
  /** Asks for the microphone; the browser may prompt. */
  getMicrophone: () => Promise<MediaStream>;
  createConnection: () => PeerConnection;
  /** Plays a collaborator's audio; returns what stops it. */
  play: (stream: MediaStream) => () => void;
  meter: (stream: MediaStream) => Meter;
  /** The call ended: free whatever play() and meter() share. */
  release: () => void;
}

export interface VoiceChatOptions {
  /** This tab; collaborators address their signaling to it. */
  sessionId: string;
  media: VoiceMedia;
  /** Sends a signaling message on the board channel. */
  signal: (message: RtcPayload) => void;
  /** Status, mute, connections or who's speaking changed. */
  onChange: () => void;
  /** The microphone went away (unplugged or revoked), which ended the call. */
  onMicLost?: () => void;
  gatherMs?: number;
  connectTimeoutMs?: number;
  retryMs?: number;
  graceMs?: number;
  meterMs?: number;
}

/**
 * A collaborator's loudness as their own browser measured it: the audio level
 * carried in each RTP packet. Chrome's Web Audio sometimes hears only silence
 * from remote streams; this doesn't depend on it.
 */
function rtpMeter(receiver: RTCRtpReceiver | undefined): Meter | null {
  if (typeof receiver?.getSynchronizationSources !== "function") return null;
  let lastRtp: number | undefined;
  return {
    level() {
      const [source] = receiver.getSynchronizationSources();
      // No packet since the last reading: nothing is coming in.
      if (!source || source.rtpTimestamp === lastRtp) return 0;
      lastRtp = source.rtpTimestamp;
      return source.audioLevel ?? 0;
    },
    stop: () => undefined,
  };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * Voice chat on one board (COLLAB-5): a peer-to-peer WebRTC audio mesh.
 *
 * - Presence says who's in the call (setMembers). Each pair gets one
 *   connection (PeerLinks): the side whose session id sorts first offers.
 * - Speaking is measured locally from the audio each tab already receives
 *   (the RTP audio level), so it costs no messages.
 */
export class VoiceChat {
  private status: VoiceStatus = "off";
  private muted = false;
  private local: MediaStream | null = null;
  private localMeter: Meter | null = null;
  private readonly links: PeerLinks;
  /** Collaborators I'm playing, by session id. */
  private readonly heard = new Map<string, { stopAudio: () => void; meter: Meter }>();
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private readonly loudUntil = new Map<string, number>();
  private speaking = new Set<string>();
  /** Bumped by leave(), so a join still waiting for the microphone gives up. */
  private joinToken = 0;
  private readonly meterMs: number;

  constructor(private readonly o: VoiceChatOptions) {
    this.meterMs = o.meterMs ?? VOICE_METER_MS;
    this.links = new PeerLinks({
      sessionId: o.sessionId,
      media: "voice",
      createConnection: () => o.media.createConnection(),
      signal: o.signal,
      offersTo: (peer) => o.sessionId < peer,
      addTracks: (pc) => {
        const local = this.local;
        for (const track of local?.getAudioTracks() ?? []) pc.addTrack(track, local!);
      },
      onTrack: (peer, event) => this.handleTrack(peer, event),
      onClose: (peer) => this.forget(peer),
      onChange: o.onChange,
      gatherMs: o.gatherMs,
      connectTimeoutMs: o.connectTimeoutMs,
      retryMs: o.retryMs,
      graceMs: o.graceMs,
    });
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Me (by my session id) or a collaborator I can hear. */
  isSpeaking(sessionId: string): boolean {
    return this.speaking.has(sessionId);
  }

  isConnected(peer: string): boolean {
    return this.links.isConnected(peer);
  }

  /** Asks for the microphone and joins. Rejects with the browser's error if it can't. */
  async join(): Promise<void> {
    if (this.status !== "off") return;
    const token = ++this.joinToken;
    this.status = "joining";
    this.o.onChange();
    let stream: MediaStream;
    try {
      stream = await this.o.media.getMicrophone();
    } catch (e) {
      if (token === this.joinToken) {
        this.status = "off";
        this.o.onChange();
      }
      throw e;
    }
    if (token !== this.joinToken) {
      // Left while the browser was asking.
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.local = stream;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !this.muted;
      track.addEventListener("ended", this.handleMicEnded);
    }
    this.localMeter = this.o.media.meter(stream);
    this.meterTimer = setInterval(() => this.measure(), this.meterMs);
    this.status = "on";
    this.links.start();
    this.o.onChange();
  }

  leave() {
    this.joinToken++;
    if (this.status === "off") return;
    this.links.stop();
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.localMeter?.stop();
    this.localMeter = null;
    for (const track of this.local?.getTracks() ?? []) {
      track.removeEventListener("ended", this.handleMicEnded);
      track.stop();
    }
    this.local = null;
    this.o.media.release();
    this.loudUntil.clear();
    this.speaking = new Set();
    this.status = "off";
    this.o.onChange();
  }

  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    for (const track of this.local?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted) this.loudUntil.delete(this.o.sessionId);
    this.measure();
    this.o.onChange();
  }

  /** Back on the board channel after losing it: start over the connections I offer. */
  reconnected() {
    this.links.restart();
  }

  /** Everyone else in the call, by session id (from presence). */
  setMembers(sessionIds: Iterable<string>) {
    this.links.setMembers(sessionIds);
  }

  /** A signaling message from the board channel (already schema-checked). */
  receive(message: RtcPayload) {
    this.links.receive(message);
  }

  private handleTrack(peer: string, event: RTCTrackEvent) {
    // One audio stream per collaborator.
    if (this.heard.has(peer)) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const stopAudio = this.o.media.play(stream);
    // Web Audio as well, for browsers that don't send RTP audio levels.
    const audio = this.o.media.meter(stream);
    const rtp = rtpMeter(event.receiver);
    const meter = rtp ? { level: () => Math.max(rtp.level(), audio.level()), stop: audio.stop } : audio;
    this.heard.set(peer, { stopAudio, meter });
  }

  /** Their connection closed: stop playing them. */
  private forget(peer: string) {
    const heard = this.heard.get(peer);
    if (heard) {
      this.heard.delete(peer);
      heard.stopAudio();
      heard.meter.stop();
    }
    this.loudUntil.delete(peer);
    if (this.speaking.has(peer)) this.speaking = new Set([...this.speaking].filter((id) => id !== peer));
  }

  // --- speaking ------------------------------------------------------------------

  private measure() {
    const now = Date.now();
    const hear = (id: string, meter: Meter | null) => {
      if (meter && meter.level() >= VOICE_SPEAKING_LEVEL)
        this.loudUntil.set(id, now + VOICE_SPEAKING_HOLD_MS);
    };
    if (!this.muted) hear(this.o.sessionId, this.localMeter);
    for (const [peer, { meter }] of this.heard) hear(peer, meter);
    const speaking = new Set<string>();
    for (const [id, until] of this.loudUntil) {
      if (until > now) speaking.add(id);
      else this.loudUntil.delete(id);
    }
    if (sameSet(speaking, this.speaking)) return;
    this.speaking = speaking;
    this.o.onChange();
  }

  private readonly handleMicEnded = () => {
    this.leave();
    this.o.onMicLost?.();
  };
}
