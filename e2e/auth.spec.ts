import { expect, test } from "@playwright/test";
import { createBoard, signIn, uniqueEmail } from "./helpers";

/** AUTH-3, AUTH-4: sign out, guarded routes and return-to. */
test("guarded routes redirect to login and come back after sign-in", async ({ page }) => {
  const email = uniqueEmail("guard");
  await signIn(page, email);
  const boardId = await createBoard(page);

  // Sign out from the avatar menu (in the editor).
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Opening the board while signed out → /login?next=...
  await page.goto(`/b/${boardId}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fb%2F${boardId}$`));

  // Signing in lands back on the requested page. (A different user, because
  // the same address can only request a link once a minute, AUTH-1.) That
  // user can't see the board: RLS hides it, so it reads as not found.
  await signIn(page, uniqueEmail("guard-other"), `/login?next=%2Fb%2F${boardId}`);
  await expect(page).toHaveURL(new RegExp(`/b/${boardId}$`));
  await expect(page.getByRole("heading", { name: "This page got erased." })).toBeVisible();
});

test("asking for a second link within a minute is refused politely (AUTH-1)", async ({ page }) => {
  const email = uniqueEmail("cooldown");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a magic link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  await page.getByRole("button", { name: "Send it again" }).click();
  await expect(page.getByText("Please wait a minute before requesting another link.")).toBeVisible();
});

test("share pages never require sign-in, unknown links look erased", async ({ page }) => {
  await page.goto(`/s/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link has been erased." })).toBeVisible();
  await page.goto("/s/not-a-token");
  await expect(page.getByRole("heading", { name: "This link has been erased." })).toBeVisible();
});

test("next only accepts same-origin paths (no open redirect)", async ({ page }) => {
  await signIn(page, uniqueEmail("redirect"), "/login?next=https%3A%2F%2Fevil.example%2Fboards");
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/boards$/);
});
