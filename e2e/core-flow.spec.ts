import { expect, test } from "@playwright/test";
import {
  adminGetBoard,
  createBoard,
  drawRectangle,
  saveNow,
  signIn,
  uniqueEmail,
  writeText,
} from "./helpers";

/**
 * The E2E flow from tech §14: magic-link login → create board → draw a
 * rectangle and text → reload → content persists → create share link → open it
 * signed out → read-only → revoke → erased.
 */
test("draw, persist, share and revoke", async ({ page, browser }) => {
  const email = uniqueEmail("core");
  await signIn(page, email);

  // Dashboard: empty state (DASH-1).
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole("heading", { name: "No boards yet." })).toBeVisible();

  // New board opens the editor with the welcome screen (DASH-2, EDIT-4).
  const boardId = await createBoard(page);
  await expect(page.getByText("Start sketching. Uncle Draw saves as you go.")).toBeVisible();
  await expect(page).toHaveTitle("Untitled board · Uncle Draw");

  // Draw and save (EDIT-1, SAVE-1).
  await drawRectangle(page, 420, 320);
  await writeText(page, 720, 360, "Hello from Uncle Draw");
  await saveNow(page);

  const saved = await adminGetBoard(boardId);
  const types = saved.scene.elements.map((e) => e.type).sort();
  expect(types).toEqual(["rectangle", "text"]);
  expect(saved.scene.elements.find((e) => e.type === "text")?.text).toBe("Hello from Uncle Draw");

  // Reload: exactly what I drew, no welcome screen.
  await page.reload();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await expect(page.getByText("Start sketching. Uncle Draw saves as you go.")).toBeHidden();
  const afterReload = await adminGetBoard(boardId);
  expect(afterReload.scene.elements).toHaveLength(2);

  // Rename from the title in the top-right (EDIT-3); renames don't bump version.
  const versionBefore = afterReload.version;
  await page.getByRole("button", { name: /Board title: Untitled board/ }).click();
  await page.getByRole("textbox", { name: "Board title" }).fill("Sprint map");
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("Sprint map · Uncle Draw");
  await expect.poll(async () => (await adminGetBoard(boardId)).title).toBe("Sprint map");
  expect((await adminGetBoard(boardId)).version).toBe(versionBefore);

  // Share (SHARE-1).
  await page.locator(".ud-topright").getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: 'Share "Sprint map"' });
  await dialog.getByRole("button", { name: "Create share link" }).click();
  const linkInput = dialog.getByRole("textbox", { name: "Share link" });
  await expect(linkInput).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const shareUrl = await linkInput.inputValue();

  // Viewer, signed out (SHARE-2).
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByText("View only")).toBeVisible();
  await expect(viewer.getByRole("note")).toContainText("Sprint map");
  await expect(viewer.locator(".excalidraw")).toBeVisible();
  await expect(viewer.getByTestId("toolbar-rectangle")).toHaveCount(0); // no editing tools
  await expect(viewer.getByRole("link", { name: "Made with Uncle Draw" })).toBeVisible();

  // Revoke (SHARE-3): the next viewer page load fails.
  await dialog.getByRole("button", { name: "Stop sharing" }).click();
  await expect(dialog.getByRole("button", { name: "Create share link" })).toBeVisible();
  await viewer.reload();
  await expect(viewer.getByRole("heading", { name: "This link has been erased." })).toBeVisible();
  await viewerContext.close();
});
