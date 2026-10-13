import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import type { Person } from "./collab.api";
import type { ShareLink } from "./shares.api";

const api = vi.hoisted(() => ({
  getActiveShare: vi.fn(),
  createShare: vi.fn(),
  rotateShare: vi.fn(),
  revokeShare: vi.fn(),
}));

const collab = vi.hoisted(() => ({
  getActiveEditLink: vi.fn(),
  createEditLink: vi.fn(),
  rotateEditLink: vi.fn(),
  revokeEditLink: vi.fn(),
  listPeople: vi.fn(),
  removePerson: vi.fn(),
}));

vi.mock("./shares.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shares.api")>()),
  ...api,
}));

vi.mock("./collab.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collab.api")>()),
  ...collab,
}));

vi.mock("../auth/AuthProvider", () => ({ useUser: () => ({ id: "owner-1" }) }));

const { ShareDialog } = await import("./ShareDialog");

const link = (token: string): ShareLink => ({
  id: token,
  token,
  created_at: "2026-10-13T09:00:00Z",
  expires_at: null,
});

const owner: Person = { userId: "owner-1", name: "Alice", avatarUrl: null, role: "owner" };
const editor: Person = { userId: "editor-2", name: "Bob", avatarUrl: null, role: "editor" };

const viewSection = () => screen.getByRole("region", { name: "View-only link" });
const editSection = () => screen.getByRole("region", { name: "Edit link" });
const peopleSection = () => screen.getByRole("region", { name: "People who can edit" });

function renderDialog(props: { isOwner?: boolean; onLeft?: () => void } = {}) {
  return renderWithProviders(
    <ShareDialog
      open
      onClose={() => {}}
      boardId="b1"
      title="Sprint map"
      isOwner={props.isOwner ?? true}
      onLeft={props.onLeft}
    />,
  );
}

describe("ShareDialog (SHARE-1, SHARE-3, COLLAB-1; VISUAL_DESIGN.md §6.5)", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    Object.values(collab).forEach((fn) => fn.mockReset());
    collab.getActiveEditLink.mockResolvedValue(null);
    collab.listPeople.mockResolvedValue([owner]);
  });

  it("offers to create a view link when there is none", async () => {
    api.getActiveShare.mockResolvedValue(null);
    api.createShare.mockResolvedValue(link("T".repeat(43)));
    renderDialog();

    expect(screen.getByRole("heading", { name: 'Share "Sprint map"' })).toBeInTheDocument();
    await userEvent.click(await within(viewSection()).findByRole("button", { name: "Create share link" }));
    expect(api.createShare).toHaveBeenCalledWith("b1");
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/s/${"T".repeat(43)}`),
    ).toBeInTheDocument();
    expect(within(viewSection()).getByText(/Never expires/)).toBeInTheDocument();
  });

  it("shows the same active link when reopened, and copies it", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDialog();

    const url = `${window.location.origin}/s/${"A".repeat(43)}`;
    expect(await screen.findByDisplayValue(url)).toBeInTheDocument();
    await userEvent.click(within(viewSection()).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await screen.findAllByText("Link copied!")).not.toHaveLength(0);
  });

  it("gets a new view link in one step", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    api.rotateShare.mockResolvedValue(link("B".repeat(43)));
    renderDialog();
    await userEvent.click(await within(viewSection()).findByRole("button", { name: "Get a new link" }));
    expect(api.rotateShare).toHaveBeenCalledWith("b1");
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/s/${"B".repeat(43)}`),
    ).toBeInTheDocument();
  });

  it("stops sharing", async () => {
    api.getActiveShare.mockResolvedValue(link("A".repeat(43)));
    api.revokeShare.mockResolvedValue(undefined);
    renderDialog();
    await userEvent.click(await within(viewSection()).findByRole("button", { name: "Stop sharing" }));
    expect(api.revokeShare).toHaveBeenCalledWith("b1");
    await waitFor(() =>
      expect(within(viewSection()).getByRole("button", { name: "Create share link" })).toBeInTheDocument(),
    );
  });

  it("shows a friendly error when the link can't load", async () => {
    api.getActiveShare.mockRejectedValue(new Error("boom"));
    renderDialog();
    expect(await within(viewSection()).findByText(/couldn.t load this link/)).toBeInTheDocument();
  });

  it("creates an edit link that opens /join/:token (COLLAB-1)", async () => {
    api.getActiveShare.mockResolvedValue(null);
    collab.createEditLink.mockResolvedValue(link("E".repeat(43)));
    renderDialog();
    await userEvent.click(await within(editSection()).findByRole("button", { name: "Create edit link" }));
    expect(collab.createEditLink).toHaveBeenCalledWith("b1");
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/join/${"E".repeat(43)}`),
    ).toBeInTheDocument();
    await userEvent.click(within(editSection()).getByRole("button", { name: "Turn off" }));
    expect(collab.revokeEditLink).toHaveBeenCalledWith("b1");
  });

  it("lists people and lets the owner remove an editor", async () => {
    api.getActiveShare.mockResolvedValue(null);
    collab.listPeople.mockResolvedValue([owner, editor]);
    collab.removePerson.mockResolvedValue(undefined);
    renderDialog();
    const people = peopleSection();
    expect(await within(people).findByText("Bob")).toBeInTheDocument();
    expect(within(people).getByText("(you)")).toBeInTheDocument();
    expect(within(people).queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument();
    await userEvent.click(within(people).getByRole("button", { name: "Remove Bob" }));
    expect(collab.removePerson).toHaveBeenCalledWith("b1", "editor-2");
    await waitFor(() => expect(within(people).queryByText("Bob")).not.toBeInTheDocument());
  });

  it("editors see people without links, and can leave", async () => {
    collab.listPeople.mockResolvedValue([
      { ...owner, userId: "someone-else" },
      { ...editor, userId: "owner-1" },
    ]);
    collab.removePerson.mockResolvedValue(undefined);
    const onLeft = vi.fn();
    renderDialog({ isOwner: false, onLeft });
    expect(screen.queryByRole("region", { name: "View-only link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Edit link" })).not.toBeInTheDocument();
    expect(api.getActiveShare).not.toHaveBeenCalled();
    expect(await within(peopleSection()).findByText("Alice")).toBeInTheDocument();
    expect(within(peopleSection()).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Leave this board" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(collab.removePerson).toHaveBeenCalledWith("b1", "owner-1");
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
  });
});
