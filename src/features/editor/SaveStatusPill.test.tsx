import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveStatusPill } from "./SaveStatusPill";

const live = () => screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;

describe("SaveStatusPill (SAVE-2; VISUAL_DESIGN.md §9.1)", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["saved", "Saved"],
    ["offline", "Offline · saved on this device"],
    ["error", "Couldn't save"],
  ] as const)('%s reads "%s" and is announced politely', (status, text) => {
    render(
      <SaveStatusPill
        status={status}
        errorReason={status === "error" ? "failed" : null}
        onRetry={() => {}}
      />,
    );
    expect(live()).toHaveTextContent(text);
  });

  it("saving shows the scribble label", () => {
    render(<SaveStatusPill status="saving" errorReason={null} onRetry={() => {}} />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("error has a working Retry", async () => {
    const onRetry = vi.fn();
    render(<SaveStatusPill status="error" errorReason="failed" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("too-large errors explain themselves and offer no Retry", () => {
    render(<SaveStatusPill status="error" errorReason="tooLarge" onRetry={() => {}} />);
    expect(live()).toHaveTextContent("Too big to save");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offline wording changes when there is no local backup", () => {
    render(<SaveStatusPill status="offline" errorReason={null} backupAvailable={false} onRetry={() => {}} />);
    expect(live()).toHaveTextContent("Offline · will sync when you're back");
  });

  it('"Saved" collapses to the check icon after 2 s, and re-appears on the next save', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <SaveStatusPill status="saved" nonce={1} errorReason={null} onRetry={() => {}} />,
    );
    const visibleText = () => container.querySelector(".ud-pill__text");
    expect(visibleText()).toHaveTextContent("Saved");
    act(() => void vi.advanceTimersByTime(2000));
    expect(visibleText()).toBeNull();
    rerender(<SaveStatusPill status="saved" nonce={2} errorReason={null} onRetry={() => {}} />);
    expect(visibleText()).toHaveTextContent("Saved");
  });

  it("phones show the icon only", () => {
    const { container } = render(
      <SaveStatusPill status="offline" errorReason={null} iconOnly onRetry={() => {}} />,
    );
    expect(container.querySelector(".ud-pill__text")).toBeNull();
  });
});
