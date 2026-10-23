import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeScreenMedia } from "../../../test/fakeVoice";
import type { RtcPayload } from "./protocol";
import { ScreenShare } from "./ScreenShare";

type Tab = ReturnType<typeof makeTab>;

/** Tabs whose signaling reaches each other directly. */
function network() {
  const tabs = new Map<string, { share: ScreenShare }>();
  const sent: RtcPayload[] = [];
  return {
    tabs,
    sent,
    deliver(message: RtcPayload) {
      sent.push(message);
      tabs.get(message.to)?.share.receive(message);
    },
  };
}

function makeTab(sessionId: string, net: ReturnType<typeof network>) {
  const { media, pcs, display } = fakeScreenMedia();
  const onChange = vi.fn();
  const onEnded = vi.fn();
  const share = new ScreenShare({
    sessionId,
    media,
    signal: (m) => net.deliver(m),
    onChange,
    onEnded,
    gatherMs: 1000,
    connectTimeoutMs: 5000,
    retryMs: 100,
    graceMs: 500,
  });
  net.tabs.set(sessionId, { share });
  return { sessionId, share, media, pcs, display, onChange, onEnded };
}

/** `sharer` shares with `viewers`, who watch; everything connects and video flows. */
async function shareWith(sharer: Tab, viewers: Tab[]) {
  await sharer.share.start();
  for (const v of viewers) v.share.watch(sharer.sessionId);
  sharer.share.setViewers(viewers.map((v) => v.sessionId));
  await vi.advanceTimersByTimeAsync(20);
  for (const pc of sharer.pcs) pc.setState("connected");
  for (const v of viewers) {
    v.pcs.at(-1)!.setState("connected");
    v.pcs.at(-1)!.receiveAudio(sharer.display); // a "track" event, video here
  }
}

describe("ScreenShare (COLLAB-7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends my screen one way to each viewer, who see it", async () => {
    const net = network();
    const zed = makeTab("zzz", net); // sorts last, and still offers: the sharer always does
    const a = makeTab("aaa", net);
    const b = makeTab("bbb", net);
    await shareWith(zed, [a, b]);

    expect(zed.share.getStatus()).toBe("sharing");
    expect(zed.display.tracks[0]!.contentHint).toBe("detail");
    expect(net.sent.filter((m) => m.kind === "offer").map((m) => [m.s, m.to, m.m])).toEqual([
      ["zzz", "aaa", "screen"],
      ["zzz", "bbb", "screen"],
    ]);
    expect(zed.pcs.map((pc) => pc.tracks)).toEqual([zed.display.tracks, zed.display.tracks]);
    // Viewers send nothing back.
    expect(a.pcs[0]!.tracks).toEqual([]);
    expect(zed.share.viewerCount).toBe(2);
    expect(a.share.getStream()).toBe(zed.display);
    expect(b.share.getStream()).toBe(zed.display);
  });

  it("stopping hangs up on viewers, and they drop the picture once presence says so", async () => {
    const net = network();
    const zed = makeTab("zzz", net);
    const a = makeTab("aaa", net);
    await shareWith(zed, [a]);
    zed.share.stop();
    expect(zed.share.getStatus()).toBe("off");
    expect(zed.display.tracks[0]!.stopped).toBe(true);
    expect(zed.pcs[0]!.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    a.share.watch(null);
    expect(a.pcs[0]!.closed).toBe(true);
    expect(a.share.getStream()).toBeNull();
  });

  it("stops when the browser's own Stop sharing button is used", async () => {
    const net = network();
    const zed = makeTab("zzz", net);
    await zed.share.start();
    zed.display.tracks[0]!.dispatchEvent(new Event("ended"));
    expect(zed.share.getStatus()).toBe("off");
    expect(zed.onEnded).toHaveBeenCalled();
  });

  it("a cancelled picker rejects and leaves sharing off", async () => {
    const net = network();
    const zed = makeTab("zzz", net);
    vi.mocked(zed.media.getDisplay).mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
    await expect(zed.share.start()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(zed.share.getStatus()).toBe("off");
  });

  it("takes a sharer's offer that beats presence, but only shows the screen it watches", async () => {
    const net = network();
    const zed = makeTab("zzz", net);
    const a = makeTab("aaa", net);
    await zed.share.start();
    zed.share.setViewers(["aaa"]); // before "aaa" knows "zzz" shares
    await vi.advanceTimersByTimeAsync(20);
    expect(a.pcs).toHaveLength(1);
    a.pcs[0]!.receiveAudio(zed.display);
    expect(a.share.getStream()).toBeNull();
    a.share.watch("zzz");
    expect(a.share.getStream()).toBe(zed.display);
  });
});
