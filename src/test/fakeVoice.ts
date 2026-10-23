import { vi } from "vitest";
import type { ScreenMedia } from "../features/editor/collab/ScreenShare";
import type { PeerConnection, VoiceMedia } from "../features/editor/collab/VoiceChat";

/** Fake microphone, screen, WebRTC and audio output for voice and screen tests (COLLAB-5/7). */

export class FakeTrack extends EventTarget {
  enabled = true;
  stopped = false;
  contentHint = "";
  constructor(readonly kind: "audio" | "video" = "audio") {
    super();
  }
  stop() {
    this.stopped = true;
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

let sdpCounter = 0;

/** Just enough of RTCPeerConnection: descriptions, states and events. */
export class FakePC extends EventTarget {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  readonly tracks: FakeTrack[] = [];
  closed = false;

  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  async createOffer() {
    return { type: "offer" as const, sdp: `offer-${++sdpCounter}` };
  }
  async createAnswer() {
    return { type: "answer" as const, sdp: `answer-${++sdpCounter}` };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-local-offer" : "stable";
    // Candidates arrive a moment later.
    setTimeout(() => {
      this.iceGatheringState = "complete";
      this.dispatchEvent(new Event("icegatheringstatechange"));
    }, 5);
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
  receiveAudio(stream: FakeStream, receiver?: FakeReceiver) {
    this.dispatchEvent(
      Object.assign(new Event("track"), { streams: [stream], track: stream.tracks[0], receiver }),
    );
  }
}

/** RTCRtpReceiver's view of incoming packets: the newest one's audio level. */
export class FakeReceiver {
  private packet = { rtpTimestamp: 0, audioLevel: 0 };
  /** One more packet arrives at this level. */
  hear(audioLevel: number) {
    this.packet = { rtpTimestamp: this.packet.rtpTimestamp + 960, audioLevel };
  }
  getSynchronizationSources() {
    return this.packet.rtpTimestamp ? [{ source: 1, timestamp: 0, ...this.packet }] : [];
  }
}

/** VoiceMedia backed by the fakes above, plus handles to inspect them. */
export function fakeVoiceMedia() {
  const pcs: FakePC[] = [];
  const playing = new Set<FakeStream>();
  const levels = new Map<FakeStream, number>();
  const mic = new FakeStream([new FakeTrack()]);
  const media: VoiceMedia = {
    getMicrophone: vi.fn(async () => mic as unknown as MediaStream),
    createConnection: () => {
      const pc = new FakePC();
      pcs.push(pc);
      return pc as unknown as PeerConnection;
    },
    play: (stream) => {
      playing.add(stream as unknown as FakeStream);
      return () => playing.delete(stream as unknown as FakeStream);
    },
    meter: (stream) => ({
      level: () => levels.get(stream as unknown as FakeStream) ?? 0,
      stop: () => undefined,
    }),
    release: vi.fn(),
  };
  return { media, pcs, playing, levels, mic };
}

/** ScreenMedia backed by the fakes above: a screen with one video track. */
export function fakeScreenMedia() {
  const pcs: FakePC[] = [];
  const display = new FakeStream([new FakeTrack("video")]);
  const media: ScreenMedia = {
    canShare: true,
    getDisplay: vi.fn(async () => display as unknown as MediaStream),
    createConnection: () => {
      const pc = new FakePC();
      pcs.push(pc);
      return pc as unknown as PeerConnection;
    },
  };
  return { media, pcs, display };
}
