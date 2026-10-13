import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import type { ShareLink } from "./shares.api";

const api = vi.hoisted(() => ({
  getActiveShare: vi.fn(),
  createShare: vi.fn(),
  rotateShare: vi.fn(),
  revokeShare: vi.fn(),
}));

vi.mock("./shares.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shares.api")>()),
  ...api,
}));

const { ShareDialog } = await import("./ShareDialog");

const link = (token: string): ShareLink => ({
  id: token,
  token,
  created_at: "2026-10-13T09:00:00Z",
  expires_at: null,
});

describe("ShareDialog (SHARE-1, SHARE-3; VISUAL_DESIGN.md §6.5)", () => {
  beforeEach(() => Object.values(api).forEach((fn) => fn.mockReset()));

  it("offers to create a link when there is none", async () => {
    api.getActiveShare.mockResolvedValue(null);
    api.createShare.mockResolvedValue(link("T".repeat(43)));
    renderWithProviders(<ShareDialog open onClose={() => {}} boardId="b1" title="Sprint map" />);

    expect(screen.getByRole("heading", { name: 'Share "Sprint map"' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Create share link" }));
    expect(api.createShare).toHaveBeenCalledWith("b1");
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/s/${"T".repeat(43)}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/Never expires/)).toBeInTheDocument();
  });

  it("shows the same active link when reopened, and copies it", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<ShareDialog open onClose={() => {}} boardId="b1" title="Sprint map" />);

    const url = `${window.location.origin}/s/${"A".repeat(43)}`;
    expect(await screen.findByDisplayValue(url)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await screen.findAllByText("Link copied!")).not.toHaveLength(0);
  });

  it("gets a new link in one step", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    api.rotateShare.mockResolvedValue(link("B".repeat(43)));
    renderWithProviders(<ShareDialog open onClose={() => {}} boardId="b1" title="Sprint map" />);
    await userEvent.click(await screen.findByRole("button", { name: "Get a new link" }));
    expect(api.rotateShare).toHaveBeenCalledWith("b1");
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/s/${"B".repeat(43)}`),
    ).toBeInTheDocument();
  });

  it("stops sharing", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    api.revokeShare.mockResolvedValue(undefined);
    renderWithProviders(<ShareDialog open onClose={() => {}} boardId="b1" title="Sprint map" />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop sharing" }));
    expect(api.revokeShare).toHaveBeenCalledWith("b1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create share link" })).toBeInTheDocument(),
    );
  });

  it("shows a friendly error when the link can't load", async () => {
    api.getActiveShare.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ShareDialog open onClose={() => {}} boardId="b1" title="Sprint map" />);
    expect(await screen.findByText(/couldn.t load the share link/)).toBeInTheDocument();
  });
});
