import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusPill } from "./SaveStatusPill";

const live = () => screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;

describe("SaveStatusPill (SAVE-2; VISUAL_DESIGN.md §9.1)", () => {
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

  it("saving and saved are a fixed-size icon, labelled by tooltip (no layout shift)", () => {
    const { rerender, container } = render(
      <SaveStatusPill status="saving" errorReason={null} onRetry={() => {}} />,
    );
    const pill = () => container.querySelector(".ud-pill")!;
    expect(pill()).toHaveClass("ud-pill--icon");
    expect(pill()).toHaveAttribute("title", "Saving…");
    expect(container.querySelector(".ud-pill__text")).toBeNull();

    rerender(<SaveStatusPill status="saved" nonce={1} errorReason={null} onRetry={() => {}} />);
    expect(pill()).toHaveClass("ud-pill--icon");
    expect(pill()).toHaveAttribute("title", "Saved");
    expect(live()).toHaveTextContent("Saved");
  });

  it("offline and errors spell themselves out", () => {
    const { container } = render(<SaveStatusPill status="offline" errorReason={null} onRetry={() => {}} />);
    expect(container.querySelector(".ud-pill")).not.toHaveClass("ud-pill--icon");
    expect(container.querySelector(".ud-pill__text")).toHaveTextContent("Offline · saved on this device");
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

  it("phones show the icon only", () => {
    const { container } = render(
      <SaveStatusPill status="offline" errorReason={null} iconOnly onRetry={() => {}} />,
    );
    expect(container.querySelector(".ud-pill__text")).toBeNull();
  });
});
