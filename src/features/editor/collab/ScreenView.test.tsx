import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { NO_LIVE_STATE, type LiveState } from "./CollabSession";
import { ScreenView } from "./ScreenView";

function controls(initial: Partial<LiveState>) {
  let state: LiveState = { ...NO_LIVE_STATE, ...initial };
  const listeners = new Set<() => void>();
  return {
    subscribeLive: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLive: () => state,
    requestPointer: vi.fn(),
    stopPointer: vi.fn(),
    sendPointerMove: vi.fn(),
    set(next: Partial<LiveState>) {
      state = { ...state, ...next };
      act(() => listeners.forEach((l) => l()));
    },
  };
}

const pat = { sessionId: "s-pat", name: "Pat", isMe: false };

describe("ScreenView (COLLAB-7)", () => {
  it("shows nothing unless someone else shares", () => {
    const c = controls({});
    renderWithProviders(<ScreenView controls={c} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    c.set({ sharer: { ...pat, isMe: true } });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("connects, then plays the shared screen", () => {
    const c = controls({ sharer: pat });
    renderWithProviders(<ScreenView controls={c} />);
    const panel = screen.getByRole("region", { name: "Pat's screen" });
    expect(panel).toHaveTextContent("Connecting…");

    const stream = {} as MediaStream;
    c.set({ screenStream: stream });
    const video = screen.getByLabelText("Pat's screen", { selector: "video" }) as HTMLVideoElement & {
      srcObject: unknown;
    };
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
  });

  it("grows, shrinks, and tucks away until a new sharer starts", async () => {
    const user = userEvent.setup();
    const c = controls({ sharer: pat });
    renderWithProviders(<ScreenView controls={c} />);
    const panel = () => screen.getByRole("region");

    await user.click(screen.getByRole("button", { name: "Make bigger" }));
    expect(panel()).toHaveAttribute("data-large", "true");
    await user.click(screen.getByRole("button", { name: "Make smaller" }));
    expect(panel()).not.toHaveAttribute("data-large");

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(panel()).toHaveAttribute("data-hidden", "true");
    expect(panel()).not.toHaveTextContent("Connecting…");
    await user.click(screen.getByRole("button", { name: "Show Pat's screen" }));
    expect(panel()).toHaveTextContent("Connecting…");

    await user.click(screen.getByRole("button", { name: "Hide" }));
    c.set({ sharer: { sessionId: "s-sam", name: "Sam", isMe: false } });
    expect(screen.getByRole("region", { name: "Sam's screen" })).not.toHaveAttribute("data-hidden");
  });

  it("explains when too many people are watching", () => {
    renderWithProviders(<ScreenView controls={controls({ sharer: pat, screenFull: true })} />);
    expect(screen.getByRole("region")).toHaveTextContent("8 people are watching already");
  });

  it("asks to point, waits, and points at fractions of the picture once allowed", async () => {
    const user = userEvent.setup();
    const c = controls({ sharer: pat });
    renderWithProviders(<ScreenView controls={c} />);
    expect(screen.queryByRole("button", { name: "Request pointer" })).not.toBeInTheDocument();

    c.set({ screenStream: {} as MediaStream });
    await user.click(screen.getByRole("button", { name: "Request pointer" }));
    expect(c.requestPointer).toHaveBeenCalled();

    c.set({ pointerAccess: "requested" });
    expect(within(screen.getByRole("region")).getByRole("status")).toHaveTextContent(
      "Waiting for Pat to allow your pointer…",
    );
    c.set({ pointerAccess: "denied" });
    expect(within(screen.getByRole("region")).getByRole("status")).toHaveTextContent(
      "Pat didn't allow a pointer.",
    );
    expect(screen.getByRole("button", { name: "Request pointer again" })).toBeInTheDocument();

    c.set({ pointerAccess: "granted" });
    const video = screen.getByLabelText("Pat's screen", { selector: "video" });
    Object.defineProperty(video, "videoWidth", { value: 1600 });
    Object.defineProperty(video, "videoHeight", { value: 900 });
    // A 200x200 box letterboxes the 16:9 picture to 200x112.5, centered vertically.
    video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
    const well = video.parentElement!;
    well.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(c.sendPointerMove).toHaveBeenCalledWith(0.5, 0.5);
    await user.click(screen.getByRole("button", { name: "Stop pointer" }));
    expect(c.stopPointer).toHaveBeenCalled();
  });
});
