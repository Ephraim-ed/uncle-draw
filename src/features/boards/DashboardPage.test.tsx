import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import type { BoardSummary } from "./boards.api";

const list = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock("./boards.queries", () => ({
  useBoardsList: () => list.current,
  useCreateBoard: () => ({ mutate, isPending: false }),
  useRenameBoard: () => ({ mutate }),
  useTrashBoard: () => ({ mutate }),
  useRestoreBoard: () => ({ mutate }),
  useLeaveBoard: () => ({ mutate }),
  useThumbnailUrls: () => ({ data: {} }),
}));
vi.mock("../auth/AuthProvider", () => ({ useUser: () => ({ id: "me" }) }));
vi.mock("../../components/ui/AvatarMenu", () => ({
  AvatarMenu: () => <button type="button">Account</button>,
}));

const { DashboardPage } = await import("./DashboardPage");

const board = (id: string, title: string, owner_id = "me"): BoardSummary => ({
  id,
  owner_id,
  title,
  thumbnail_path: null,
  updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  created_at: new Date().toISOString(),
});

function setList(partial: Record<string, unknown>) {
  list.current = {
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...partial,
  };
}

describe("DashboardPage (DASH-1; VISUAL_DESIGN.md §6.2)", () => {
  beforeEach(() => mutate.mockReset());

  it("shows a loading state", () => {
    setList({ isPending: true });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText("Loading your boards…")).toHaveAttribute("role", "status");
  });

  it("shows the empty state with a call to action", async () => {
    setList({ isSuccess: true, data: { pages: [[]], pageParams: [0] } });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "No boards yet." })).toBeInTheDocument();
    expect(screen.getByText("Every great idea starts as a messy sketch.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Draw your first board/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows an error with a working Retry", async () => {
    const refetch = vi.fn();
    setList({ isError: true, refetch });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't load your boards");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("lists boards as cards linking to the editor", () => {
    setList({
      isSuccess: true,
      data: { pages: [[board("b1", "Sprint map"), board("b2", "Wireframes")]], pageParams: [0] },
    });
    renderWithProviders(<DashboardPage />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const link = within(items[0]!).getByRole("link");
    expect(link).toHaveAttribute("href", "/b/b1");
    expect(link).toHaveTextContent("Sprint map");
    expect(link).toHaveTextContent("Edited 2h ago");
    expect(
      within(items[0]!).getByRole("button", { name: "Board options for Sprint map" }),
    ).toBeInTheDocument();
  });

  it("marks boards shared with me and offers Leave instead of Rename/Trash (COLLAB-1)", async () => {
    setList({
      isSuccess: true,
      data: { pages: [[board("b3", "Team map", "someone-else")]], pageParams: [0] },
    });
    renderWithProviders(<DashboardPage />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("link")).toHaveTextContent("Shared with you · Edited 2h ago");
    await userEvent.click(within(item).getByRole("button", { name: "Board options for Team map" }));
    expect(screen.getByRole("menuitem", { name: "Leave board" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to trash" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Leave board" }));
    const dialog = await screen.findByRole("dialog", { name: 'Leave "Team map"?' });
    await userEvent.click(within(dialog).getByRole("button", { name: "Leave board" }));
    expect(mutate).toHaveBeenCalledWith("b3", expect.anything());
  });

  it("creates a board with the N shortcut", async () => {
    setList({ isSuccess: true, data: { pages: [[]], pageParams: [0] } });
    renderWithProviders(<DashboardPage />);
    await userEvent.keyboard("n");
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
