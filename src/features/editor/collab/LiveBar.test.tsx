import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { NO_LIVE_STATE, type LiveState } from "./CollabSession";
import { LiveBar, type LiveControls } from "./LiveBar";
import { micErrorMessage } from "./micError";

function controls(initial: Partial<LiveState>) {
  let state: LiveState = { ...NO_LIVE_STATE, ...initial };
  const listeners = new Set<() => void>();
  const c: LiveControls & { set: (next: Partial<LiveState>) => void } = {
    subscribeLive: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLive: () => state,
    joinVoice: vi.fn(() => Promise.resolve()),
    leaveVoice: vi.fn(),
    setMuted: vi.fn(),
    startPresenting: vi.fn(),
    stopPresenting: vi.fn(),
    followPresenter: vi.fn(),
    startScreenShare: vi.fn(() => Promise.resolve()),
    stopScreenShare: vi.fn(),
    set(next) {
      state = { ...state, ...next };
      act(() => listeners.forEach((l) => l()));
    },
  };
  return c;
}

const barStatus = () => within(screen.getByRole("toolbar")).getByRole("status");
const pat = { sessionId: "s-pat", name: "Pat", isMe: false };
const me = { sessionId: "s-me", name: "Me", isMe: true };

describe("LiveBar (COLLAB-5/6)", () => {
  it("stays out of the way while I'm alone on the board", () => {
    const c = controls({});
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    c.set({ others: 1 });
    expect(screen.getByRole("toolbar", { name: "Voice and sharing" })).toBeInTheDocument();
  });

  it("joins voice, shows who's already talking, and mutes or leaves", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 2, inCall: 2 });
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    const join = screen.getByRole("button", { name: /^Join voice/ });
    expect(join).toHaveAccessibleName(/^Join voice.*2 people talking$/);
    await user.click(join);
    expect(c.joinVoice).toHaveBeenCalled();

    c.set({ voice: "joining" });
    expect(screen.getByRole("button", { name: /Connecting/ })).toBeDisabled();

    c.set({ voice: "on" });
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(c.setMuted).toHaveBeenCalledWith(true);
    c.set({ muted: true });
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Leave voice" }));
    expect(c.leaveVoice).toHaveBeenCalled();
  });

  it("explains a refused microphone", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 1 });
    vi.mocked(c.joinVoice).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    await user.click(screen.getByRole("button", { name: "Join voice" }));
    expect((await screen.findAllByText(/can't use your microphone/)).length).toBeGreaterThan(0);
  });

  it("can't join a full call", () => {
    renderWithProviders(
      <LiveBar controls={controls({ others: 9, inCall: 8, voiceFull: true })} compact={false} />,
    );
    expect(screen.getByRole("button", { name: /Voice is full/ })).toBeDisabled();
  });

  it("presents, then stops, showing how many follow", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 2 });
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(c.startPresenting).toHaveBeenCalled();

    c.set({ presenter: me, followers: 2 });
    expect(barStatus()).toHaveTextContent("2 following");
    await user.click(screen.getByRole("button", { name: "Stop presenting" }));
    expect(c.stopPresenting).toHaveBeenCalled();

    // Still there after everyone left, so I can stop.
    c.set({ others: 0, followers: 0 });
    expect(screen.getByRole("button", { name: "Stop presenting" })).toBeInTheDocument();
  });

  it("says who presents, and offers to follow them again after looking around", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 1, presenter: pat, following: true });
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    expect(barStatus()).toHaveTextContent("Pat is presenting");
    expect(screen.queryByRole("button", { name: "Present" })).not.toBeInTheDocument();

    c.set({ following: false });
    await user.click(screen.getByRole("button", { name: "Follow Pat" }));
    expect(c.followPresenter).toHaveBeenCalled();
  });

  it("shares my screen where the browser can, and says how many watch", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 2 });
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    // This browser can't share a screen.
    expect(screen.queryByRole("button", { name: "Share screen" })).not.toBeInTheDocument();

    c.set({ canShareScreen: true });
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect(c.startScreenShare).toHaveBeenCalled();
    c.set({ screen: "starting" });
    expect(screen.getByRole("button", { name: "Picking a screen…" })).toBeDisabled();

    c.set({ screen: "sharing", sharer: me, watchers: 2 });
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-presenting", "true");
    expect(within(screen.getByRole("toolbar")).getByText("2 watching")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(c.stopScreenShare).toHaveBeenCalled();

    // Someone else shares: nothing to start.
    c.set({ screen: "off", sharer: pat });
    expect(screen.queryByRole("button", { name: "Share screen" })).not.toBeInTheDocument();
  });

  it("stays quiet when the screen picker is cancelled, and explains other failures", async () => {
    const user = userEvent.setup();
    const c = controls({ others: 1, canShareScreen: true });
    vi.mocked(c.startScreenShare)
      .mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"))
      .mockRejectedValueOnce(new DOMException("broken", "AbortError"));
    renderWithProviders(<LiveBar controls={c} compact={false} />);
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect(screen.queryByText(/screen sharing didn't start/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect((await screen.findAllByText(/screen sharing didn't start/)).length).toBeGreaterThan(0);
  });

  it("phones get labelled icon buttons", () => {
    renderWithProviders(<LiveBar controls={controls({ others: 1, presenter: me })} compact />);
    expect(screen.getByRole("button", { name: "Join voice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop presenting (0 following)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("micErrorMessage", () => {
  it.each([
    ["NotAllowedError", /Allow it in your browser/],
    ["NotFoundError", /No microphone found/],
    ["NotReadableError", /busy in another app/],
    ["NotSupportedError", /secure \(https\)/],
    ["Whatever", /didn't start/],
  ])("%s", (name, message) => {
    expect(micErrorMessage(new DOMException("x", name))).toMatch(message);
  });
});
