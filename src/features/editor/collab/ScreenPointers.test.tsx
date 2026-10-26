import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { NO_LIVE_STATE, type LiveState } from "./CollabSession";
import { ScreenPointers } from "./ScreenPointers";

function controls(initial: Partial<LiveState>) {
  let state: LiveState = { ...NO_LIVE_STATE, ...initial };
  const listeners = new Set<() => void>();
  return {
    subscribeLive: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLive: () => state,
    answerPointer: vi.fn(),
    set(next: Partial<LiveState>) {
      state = { ...state, ...next };
      act(() => listeners.forEach((l) => l()));
    },
  };
}

describe("ScreenPointers (COLLAB-8)", () => {
  it("shows nothing without requests or pointers", () => {
    renderWithProviders(<ScreenPointers controls={controls({})} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^pointer-/)).not.toBeInTheDocument();
  });

  it("lets the sharer allow or deny a request", async () => {
    const user = userEvent.setup();
    const c = controls({ pointerRequests: [{ sessionId: "s-pat", name: "Pat" }] });
    renderWithProviders(<ScreenPointers controls={c} />);
    expect(screen.getByRole("region", { name: "Pointer requests" })).toHaveTextContent(
      "Pat wants to point at your screen",
    );
    await user.click(screen.getByRole("button", { name: "Allow Pat" }));
    expect(c.answerPointer).toHaveBeenCalledWith("s-pat", true);
    await user.click(screen.getByRole("button", { name: "Deny Pat" }));
    expect(c.answerPointer).toHaveBeenLastCalledWith("s-pat", false);
  });

  it("draws a named cursor at the viewer's spot", () => {
    const c = controls({ pointers: [{ sessionId: "s-pat", name: "Pat", x: 0.25, y: 0.5 }] });
    renderWithProviders(<ScreenPointers controls={c} />);
    const cursor = screen.getByTestId("pointer-s-pat");
    expect(cursor).toHaveTextContent("Pat");
    expect(cursor).toHaveStyle({ left: "25%", top: "50%" });
  });
});
