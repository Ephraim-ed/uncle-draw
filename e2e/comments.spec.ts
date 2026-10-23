import { expect, test, type Page } from "@playwright/test";
import { createBoard, drawRectangle, inviteEditor, signIn, uniqueEmail } from "./helpers";

/**
 * CMT-1: comments on a shape and on a spot, live replies between two people,
 * markers that follow their shape, hiding comments, resolving and deleting.
 */
const markers = (page: Page) => page.getByRole("group", { name: "Comments" }).getByRole("button");
const card = (page: Page) => page.getByRole("dialog", { name: "Comment thread" });
const commentTool = (page: Page) => page.locator('label:has([data-testid="toolbar-comment"])');
const hideToggle = (page: Page) => page.locator('label:has([data-testid="toolbar-hide-comments"])');

test("two people comment, reply live, resolve and hide comments", async ({ page, browser }) => {
  await signIn(page, uniqueEmail("alice"));
  await createBoard(page);
  await drawRectangle(page, 400, 300);

  // Alice comments on the rectangle she just drew (still selected): C, type, Enter.
  await page.keyboard.press("c");
  const draft = page.getByRole("dialog", { name: "New comment" });
  await expect(draft.getByRole("textbox", { name: "Add a comment" })).toBeFocused();
  await page.keyboard.type("Is this too wide?");
  await page.keyboard.press("Enter");
  await expect(markers(page)).toHaveCount(1);
  await expect(markers(page)).toHaveAccessibleName(/^Comment by alice-.*: Is this too wide\?$/);
  // The marker sits by the rectangle's top-right corner (560, 300).
  const box = (await markers(page).boundingBox())!;
  expect(Math.abs(box.x - 560)).toBeLessThan(12);
  expect(Math.abs(box.y + box.height - 300)).toBeLessThan(12);

  // Bob joins and sees it.
  const { guest: bob, context } = await inviteEditor(page, browser);
  await expect(markers(bob)).toHaveCount(1);
  await markers(bob).click();
  await expect(card(bob)).toContainText("Is this too wide?");
  await card(bob).getByRole("textbox", { name: "Reply" }).fill("A little");
  await card(bob).getByRole("textbox", { name: "Reply" }).press("Enter");
  await expect(card(bob).getByRole("listitem")).toHaveCount(2);

  // Alice hears about it right away, and the marker counts the reply.
  await page.bringToFront();
  await expect(page.getByText(/^bob-.* replied: “A little”$/).first()).toBeVisible();
  await expect(markers(page)).toHaveAccessibleName(/\(1 reply\)$/);

  // Bob pins one to an empty spot with the comment tool.
  await bob.bringToFront();
  await card(bob).getByRole("button", { name: "Close" }).click();
  await commentTool(bob).click();
  await bob.mouse.click(900, 600);
  await bob.getByRole("dialog", { name: "New comment" }).getByRole("textbox").fill("Pin here");
  await bob.getByRole("dialog", { name: "New comment" }).getByRole("button", { name: "Comment" }).click();
  await expect(markers(bob)).toHaveCount(2);
  // The new thread stays open; Escape puts it away.
  await expect(card(bob)).toContainText("Pin here");
  await bob.keyboard.press("Escape");
  await expect(card(bob)).toHaveCount(0);
  await page.bringToFront();
  await expect(markers(page)).toHaveCount(2);

  // The rectangle's marker follows it when Alice drags it.
  await page.keyboard.press("Escape");
  await page.mouse.move(480, 302);
  await page.mouse.down();
  await page.mouse.move(580, 302, { steps: 6 });
  await page.mouse.up();
  const shape = markers(page).filter({ hasText: "A" }).first();
  await expect.poll(async () => (await shape.boundingBox())!.x).toBeGreaterThan(box.x + 80);

  // Comments survive a reload.
  await page.reload();
  await expect(markers(page)).toHaveCount(2);

  // Hide comments: remembered on this device.
  await hideToggle(page).click();
  await expect(markers(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await expect(markers(page)).toHaveCount(0);
  await hideToggle(page).click();
  await expect(markers(page)).toHaveCount(2);

  // Alice resolves the rectangle's thread: it's gone for Bob too.
  await markers(page).filter({ hasText: "A" }).first().click();
  await card(page).getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Comment resolved.").first()).toBeVisible();
  await expect(markers(page)).toHaveCount(1);
  await bob.bringToFront();
  await expect(markers(bob)).toHaveCount(1);

  // Bob deletes the thread he started.
  await markers(bob).click();
  await card(bob).getByRole("button", { name: "Delete thread" }).click();
  await card(bob).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(markers(bob)).toHaveCount(0);
  await page.bringToFront();
  await expect(markers(page)).toHaveCount(0);

  await context.close();
});
