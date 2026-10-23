import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import type { CommentThread } from "./comments.api";
import { CommentLayer } from "./CommentLayer";
import type { CommentsController, CommentsUi } from "./CommentsController";

const at = new Date().toISOString();
const thread: CommentThread = {
  id: "t1",
  elementId: "box",
  x: 0,
  y: 0,
  createdBy: "u-pat",
  createdAt: at,
  resolvedAt: null,
  resolvedBy: null,
  comments: [
    {
      id: "c1",
      authorId: "u-pat",
      authorName: "Pat",
      authorAvatarUrl: null,
      body: "Is this too wide?",
      createdAt: at,
    },
    { id: "c2", authorId: "u-me", authorName: "Me", authorAvatarUrl: null, body: "A little", createdAt: at },
    { id: "c3", authorId: "u-sam", authorName: "Sam", authorAvatarUrl: null, body: "Agreed", createdAt: at },
  ],
};

/** The controller's store and actions, without a canvas. */
function fakeController(initial: Partial<CommentsUi>) {
  let ui: CommentsUi = {
    hidden: false,
    toolActive: false,
    pins: [{ id: "t1", left: 200, top: 150, thread }],
    openId: null,
    draft: null,
    busy: false,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const c = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => ui,
    toggleThread: vi.fn(),
    close: vi.fn(),
    submitDraft: vi.fn(async () => true),
    reply: vi.fn(async () => true),
    resolve: vi.fn(async () => undefined),
    deleteComment: vi.fn(async () => true),
    deleteThread: vi.fn(async () => true),
    set(next: Partial<CommentsUi>) {
      ui = { ...ui, ...next };
      act(() => listeners.forEach((l) => l()));
    },
  };
  return c;
}

const render = (c: ReturnType<typeof fakeController>, people = { userId: "u-me", isOwner: false }) =>
  renderWithProviders(<CommentLayer controller={c as unknown as CommentsController} people={people} />);

describe("CommentLayer (CMT-1)", () => {
  it("shows a marker per open thread, which opens it", async () => {
    const user = userEvent.setup();
    const c = fakeController({});
    render(c);
    const marker = screen.getByRole("button", { name: "Comment by Pat: Is this too wide? (2 replies)" });
    expect(marker).toHaveTextContent("P3");
    await user.click(marker);
    expect(c.toggleThread).toHaveBeenCalledWith("t1");
  });

  it("an open thread lists its comments and takes a reply on Enter", async () => {
    const user = userEvent.setup();
    const c = fakeController({ openId: "t1" });
    render(c);
    const card = screen.getByRole("dialog", { name: "Comment thread" });
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining("Is this too wide?"),
      expect.stringContaining("A little"),
      expect.stringContaining("Agreed"),
    ]);
    const box = within(card).getByRole("textbox", { name: "Reply" });
    expect(box).toHaveFocus();
    await user.type(box, "Fixed{Shift>}{Enter}{/Shift}now{Enter}");
    expect(c.reply).toHaveBeenCalledWith("t1", "Fixed\nnow");
    expect(box).toHaveValue("");

    await user.click(within(card).getByRole("button", { name: "Resolve" }));
    expect(c.resolve).toHaveBeenCalledWith("t1");
  });

  it("I delete my own replies; the board owner deletes any reply and any thread", async () => {
    const user = userEvent.setup();
    const c = fakeController({ openId: "t1" });
    const { unmount } = render(c);
    let card = screen.getByRole("dialog");
    // Only my reply; the first comment goes with its thread, and I didn't start this one.
    expect(within(card).getAllByRole("button", { name: "Delete reply" })).toHaveLength(1);
    expect(within(card).queryByRole("button", { name: "Delete thread" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Delete reply" }));
    expect(c.deleteComment).toHaveBeenCalledWith("t1", "c2");
    unmount();

    render(c, { userId: "u-owner", isOwner: true });
    card = screen.getByRole("dialog");
    expect(within(card).getAllByRole("button", { name: "Delete reply" })).toHaveLength(2);
    await user.click(within(card).getByRole("button", { name: "Delete thread" }));
    expect(within(card).getByRole("alert")).toHaveTextContent("Delete the whole thread?");
    await user.click(within(card).getByRole("button", { name: "Keep" }));
    expect(c.deleteThread).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Delete thread" }));
    await user.click(within(card).getByRole("button", { name: "Delete" }));
    expect(c.deleteThread).toHaveBeenCalledWith("t1");
  });

  it("a new comment: write, then post or cancel", async () => {
    const user = userEvent.setup();
    const c = fakeController({ draft: { anchor: { elementId: null, x: 1, y: 2 }, left: 300, top: 300 } });
    render(c);
    const card = screen.getByRole("dialog", { name: "New comment" });
    const post = within(card).getByRole("button", { name: "Comment" });
    expect(post).toBeDisabled();
    await user.type(within(card).getByRole("textbox", { name: "Add a comment" }), "Needs a title");
    await user.click(post);
    expect(c.submitDraft).toHaveBeenCalledWith("Needs a title");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(c.close).toHaveBeenCalled();
  });

  it("Escape puts the card away", async () => {
    const user = userEvent.setup();
    const c = fakeController({ openId: "t1" });
    render(c);
    await user.keyboard("{Escape}");
    expect(c.close).toHaveBeenCalled();
  });

  it("hidden comments show nothing", () => {
    const c = fakeController({ openId: "t1", hidden: true });
    render(c);
    expect(screen.queryByRole("button", { name: /^Comment by/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
