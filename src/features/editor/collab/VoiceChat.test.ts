import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeReceiver, fakeVoiceMedia } from "../../../test/fakeVoice";
import type { RtcPayload } from "./protocol";
import { VoiceChat } from "./VoiceChat";

type Tab = ReturnType<typeof makeTab>;

interface Network {
  tabs: Map<string, { chat: VoiceChat }>;
  sent: RtcPayload[];
  deliver: (message: RtcPayload) => void;
}

/** Two or more tabs whose signaling reaches each other directly. */
function network(): Network {
  const tabs = new Map<string, { chat: VoiceChat }>();
  const sent: RtcPayload[] = [];
  return {
    tabs,
    sent,
    deliver(message: RtcPayload) {
      sent.push(message);
      tabs.get(message.to)?.chat.receive(message);
    },
  };
}

function makeTab(sessionId: string, net: Network) {
  const { media, pcs, playing, levels, mic } = fakeVoiceMedia();
  const onChange = vi.fn();
  const onMicLost = vi.fn();
  const chat = new VoiceChat({
    sessionId,
    media,
    signal: (m) => net.deliver(m),
    onChange,
    onMicLost,
    gatherMs: 1000,
    connectTimeoutMs: 5000,
    retryMs: 100,
    graceMs: 500,
    meterMs: 50,
  });
  const tab = { sessionId, chat, media, pcs, playing, levels, mic, onChange, onMicLost };
  net.tabs.set(sessionId, tab);
  return tab;
}

/** Both in the call and connected, with audio flowing both ways. */
async function connectPair(a: Tab, b: Tab) {
  await a.chat.join();
  await b.chat.join();
  a.chat.setMembers([b.sessionId]);
  b.chat.setMembers([a.sessionId]);
  await vi.advanceTimersByTimeAsync(20);
  a.pcs.at(-1)!.setState("connected");
  b.pcs.at(-1)!.setState("connected");
  a.pcs.at(-1)!.receiveAudio(b.mic);
  b.pcs.at(-1)!.receiveAudio(a.mic);
}

describe("VoiceChat (COLLAB-5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pairs up: the tab that sorts first offers, the other answers, and audio plays", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await connectPair(a, b);

    expect(net.sent.map((m) => [m.s, m.to, m.kind])).toEqual([
      ["aaa", "bbb", "offer"],
      ["bbb", "aaa", "answer"],
    ]);
    expect(net.sent[0]!.id).toBe(net.sent[1]!.id);
    expect(a.pcs).toHaveLength(1);
    expect(b.pcs).toHaveLength(1);
    // The answer reached the offerer, and each side sends its microphone.
    expect(a.pcs[0]!.remoteDescription).toEqual({ type: "answer", sdp: net.sent[1]!.sdp });
    expect(a.pcs[0]!.tracks).toEqual(a.mic.tracks);
    expect(b.pcs[0]!.tracks).toEqual(b.mic.tracks);
    expect(a.chat.isConnected("bbb")).toBe(true);
    expect([...a.playing]).toEqual([b.mic]);
    expect([...b.playing]).toEqual([a.mic]);
  });

  it("ignores offers from the side that should answer, for other tabs, or while out of the call", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const offer = (s: string, to: string): RtcPayload => ({
      s,
      to,
      m: "voice",
      id: "x1",
      kind: "offer",
      sdp: "v=0",
    });

    a.chat.receive(offer("bbb", "aaa")); // not in the call yet
    await a.chat.join();
    a.chat.receive(offer("bbb", "aaa")); // "aaa" sorts first, so it offers to "bbb"
    a.chat.receive(offer("000", "zzz")); // not for me
    await vi.advanceTimersByTimeAsync(20);
    expect(a.pcs).toHaveLength(0);
    expect(net.sent).toHaveLength(0);

    a.chat.receive(offer("000", "aaa"));
    await vi.advanceTimersByTimeAsync(20);
    expect(a.pcs).toHaveLength(1);
    expect(net.sent.at(-1)).toMatchObject({ s: "aaa", to: "000", id: "x1", kind: "answer" });
  });

  it("ignores an answer for an older attempt", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    await a.chat.join();
    a.chat.setMembers(["bbb"]);
    await vi.advanceTimersByTimeAsync(20);
    a.chat.receive({ s: "bbb", to: "aaa", m: "voice", id: "stale", kind: "answer", sdp: "v=0" });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.pcs[0]!.remoteDescription).toBeNull();
  });

  it("starts over when a connection fails, with a fresh attempt id", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await connectPair(a, b);
    const firstId = net.sent[0]!.id;

    a.pcs[0]!.setState("failed");
    expect(a.pcs[0]!.closed).toBe(true);
    expect(a.playing.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120);

    const offers = net.sent.filter((m) => m.kind === "offer");
    expect(offers).toHaveLength(2);
    expect(offers[1]!.id).not.toBe(firstId);
    // The answering side swaps its old connection for the new one.
    expect(b.pcs[0]!.closed).toBe(true);
    expect(b.pcs).toHaveLength(2);
    expect(net.sent.at(-1)).toMatchObject({ kind: "answer", id: offers[1]!.id });
  });

  it("after a reconnect, the side that offers starts over and the other swaps in the new connection", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await connectPair(a, b);
    const offers = () => net.sent.filter((m) => m.kind === "offer");

    b.chat.reconnected(); // "bbb" answers: it waits for "aaa"
    await vi.advanceTimersByTimeAsync(20);
    expect(offers()).toHaveLength(1);

    a.chat.reconnected();
    await vi.advanceTimersByTimeAsync(20);
    expect(offers()).toHaveLength(2);
    expect(offers()[1]!.id).not.toBe(offers()[0]!.id);
    expect(a.pcs[0]!.closed).toBe(true);
    expect(b.pcs[0]!.closed).toBe(true);
    expect(b.pcs).toHaveLength(2);
    expect(net.sent.at(-1)).toMatchObject({ s: "bbb", kind: "answer", id: offers()[1]!.id });
  });

  it("retries a connection that never comes up, backing off", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    await a.chat.join();
    a.chat.setMembers(["bbb"]); // "bbb" never answers
    await vi.advanceTimersByTimeAsync(20);
    expect(net.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000 + 100 + 20); // timeout, then 100 ms
    expect(net.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000 + 150);
    expect(net.sent).toHaveLength(2); // second wait is 200 ms
    await vi.advanceTimersByTimeAsync(100);
    expect(net.sent).toHaveLength(3);
  });

  it("hangs up on people who leave the call, but gives a fresh offer time for presence to catch up", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await b.chat.join();
    await a.chat.join();
    // "aaa" saw "bbb" join and offered before "bbb" saw "aaa" in presence.
    a.chat.setMembers(["bbb"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(b.pcs).toHaveLength(1);
    b.chat.setMembers([]); // presence from before "aaa" joined
    await vi.advanceTimersByTimeAsync(100);
    expect(b.pcs[0]!.closed).toBe(false);

    b.chat.setMembers(["aaa"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.pcs[0]!.closed).toBe(false);

    // Now "aaa" really leaves.
    b.chat.setMembers([]);
    expect(b.pcs[0]!.closed).toBe(true);
  });

  it("mute turns the microphone track off and quiets my speaking indicator", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await connectPair(a, b);

    a.levels.set(a.mic, 0.2);
    a.levels.set(b.mic, 0.2);
    await vi.advanceTimersByTimeAsync(60);
    expect(a.chat.isSpeaking("aaa")).toBe(true);
    expect(a.chat.isSpeaking("bbb")).toBe(true);

    a.chat.setMuted(true);
    expect(a.mic.tracks[0]!.enabled).toBe(false);
    expect(a.chat.isSpeaking("aaa")).toBe(false);
    expect(a.chat.isMuted()).toBe(true);

    // Speaking holds briefly after the voice drops.
    a.levels.set(b.mic, 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(a.chat.isSpeaking("bbb")).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(a.chat.isSpeaking("bbb")).toBe(false);

    a.chat.setMuted(false);
    expect(a.mic.tracks[0]!.enabled).toBe(true);
  });

  it("hears collaborators speaking from the audio level in their packets", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await a.chat.join();
    await b.chat.join();
    a.chat.setMembers(["bbb"]);
    b.chat.setMembers(["aaa"]);
    await vi.advanceTimersByTimeAsync(20);
    const receiver = new FakeReceiver();
    a.pcs[0]!.receiveAudio(b.mic, receiver); // Web Audio hears nothing here

    receiver.hear(0.3);
    await vi.advanceTimersByTimeAsync(60);
    expect(a.chat.isSpeaking("bbb")).toBe(true);
    // Packets stop (or go quiet): the indicator drops after the hold.
    await vi.advanceTimersByTimeAsync(500);
    expect(a.chat.isSpeaking("bbb")).toBe(false);
    receiver.hear(0.001);
    await vi.advanceTimersByTimeAsync(60);
    expect(a.chat.isSpeaking("bbb")).toBe(false);
  });

  it("leaving stops the microphone, hangs up and frees audio", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await connectPair(a, b);
    a.chat.leave();
    expect(a.chat.getStatus()).toBe("off");
    expect(a.mic.tracks[0]!.stopped).toBe(true);
    expect(a.pcs[0]!.closed).toBe(true);
    expect(a.playing.size).toBe(0);
    expect(a.media.release).toHaveBeenCalled();
  });

  it("ends the call when the microphone goes away", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    await a.chat.join();
    a.mic.tracks[0]!.dispatchEvent(new Event("ended"));
    expect(a.chat.getStatus()).toBe("off");
    expect(a.onMicLost).toHaveBeenCalled();
  });

  it("reports a refused microphone and stays out of the call", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    vi.mocked(a.media.getMicrophone).mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
    await expect(a.chat.join()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(a.chat.getStatus()).toBe("off");
  });

  it("gives up a join that was left while the browser asked for the microphone", async () => {
    const net = network();
    const a = makeTab("aaa", net);
    let grant!: (s: MediaStream) => void;
    vi.mocked(a.media.getMicrophone).mockReturnValueOnce(new Promise((r) => (grant = r)));
    const joining = a.chat.join();
    expect(a.chat.getStatus()).toBe("joining");
    a.chat.leave();
    grant(a.mic as unknown as MediaStream);
    await joining;
    expect(a.chat.getStatus()).toBe("off");
    expect(a.mic.tracks[0]!.stopped).toBe(true);
  });
});
