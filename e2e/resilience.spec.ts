import { expect, test, type Page } from "@playwright/test";
import {
  adminCountFiles,
  adminGetBoard,
  createBoard,
  drawEllipse,
  drawRectangle,
  saveNow,
  signIn,
  uniqueEmail,
} from "./helpers";

const pill = (page: Page) => page.locator(".ud-pill-wrap");

test("offline: keep drawing, then sync when the network returns (SAVE-3)", async ({ page, context }) => {
  await signIn(page, uniqueEmail("offline"));
  const boardId = await createBoard(page);
  await drawRectangle(page, 400, 300);
  await saveNow(page);

  await context.setOffline(true);
  await drawEllipse(page, 650, 320);
  await expect(pill(page)).toHaveAttribute("data-status", "offline");
  await expect(page.locator(".ud-pill-wrap [role=status]")).toHaveText("Offline · saved on this device");
  expect((await adminGetBoard(boardId)).scene.elements).toHaveLength(1);

  await context.setOffline(false);
  await expect(pill(page)).toHaveAttribute("data-status", "saved");
  await expect.poll(async () => (await adminGetBoard(boardId)).scene.elements.length).toBe(2);
});

test("closing the tab while offline offers to restore the changes (SAVE-3)", async ({ page, context }) => {
  await signIn(page, uniqueEmail("recover"));
  const boardId = await createBoard(page);
  await drawRectangle(page, 400, 300);
  await saveNow(page);

  await context.setOffline(true);
  await drawEllipse(page, 650, 320);
  await expect(pill(page)).toHaveAttribute("data-status", "offline");
  await page.waitForTimeout(600); // the local backup is written on a 250 ms throttle
  await page.close({ runBeforeUnload: false });
  await context.setOffline(false);

  const again = await context.newPage();
  await again.goto(`/b/${boardId}`);
  const dialog = again.getByRole("dialog", { name: /We found unsaved changes from/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Restore them" }).click();
  await expect(again.locator(".excalidraw")).toBeVisible();
  await expect.poll(async () => (await adminGetBoard(boardId)).scene.elements.length).toBe(2);
});

test("pasted images upload and survive a reload (SAVE-5)", async ({ page }) => {
  await signIn(page, uniqueEmail("image"));
  const boardId = await createBoard(page);
  await page.mouse.click(1050, 450); // focus the canvas (away from the welcome screen menu)

  // Paste a small PNG the way a screenshot would arrive.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1971c2";
    ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "shot.png", { type: "image/png" }));
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });

  await expect
    .poll(async () => (await adminGetBoard(boardId)).scene.elements.map((e) => e.type), { timeout: 20_000 })
    .toContain("image");
  await saveNow(page);

  await expect.poll(() => adminCountFiles(boardId), { timeout: 20_000 }).toBe(1);

  await page.reload();
  await expect(page.locator(".excalidraw")).toBeVisible();
  // The image comes back from Storage via a signed URL.
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance.getEntriesByType("resource").some((r) => r.name.includes("/object/sign/board-files/")),
      ),
    )
    .toBe(true);
});

test("the dashboard shows a thumbnail after leaving the editor (DASH-5)", async ({ page }) => {
  await signIn(page, uniqueEmail("thumb"));
  await createBoard(page);
  await drawRectangle(page, 400, 300, 300, 200);
  await saveNow(page);

  await page.getByTestId("main-menu-trigger").click();
  await page.locator(".dropdown-menu").getByRole("button", { name: "Back to boards" }).click();
  await expect(page).toHaveURL(/\/boards$/);
  const card = page.getByRole("listitem").first();
  await expect(card.getByRole("link")).toContainText("Untitled board");
  await expect(card.locator("img")).toHaveAttribute("src", /\/object\/sign\/thumbnails\//, {
    timeout: 20_000,
  });
});

test("trash with undo, and restore from the board URL (DASH-4)", async ({ page }) => {
  await signIn(page, uniqueEmail("trash"));
  const boardId = await createBoard(page);
  await page.goto("/boards");
  const card = page.getByRole("listitem").filter({ hasText: "Untitled board" });
  await expect(card).toHaveCount(1);

  await card.getByRole("button", { name: "Board options for Untitled board" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  const confirm = page.getByRole("dialog", { name: 'Move "Untitled board" to trash?' });
  await expect(confirm).toContainText("You can restore it for 30 days.");
  await confirm.getByRole("button", { name: "Move to trash" }).click();
  await expect(card).toHaveCount(0);

  await page.locator(".ud-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Untitled board" })).toHaveCount(1);

  // Trash it again and open the URL: "This board is in the trash" with Restore.
  await page.getByRole("button", { name: "Board options for Untitled board" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByRole("heading", { name: "This board is in the trash." })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
});

test("theme applies to the shell and the editor together (SET-1)", async ({ page }) => {
  await signIn(page, uniqueEmail("theme"));
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await createBoard(page);
  await expect(page.locator(".excalidraw.theme--dark")).toBeVisible();

  // Excalidraw's own shortcut (Alt+Shift+D) updates the app setting too.
  await page.mouse.click(1050, 450);
  await page.keyboard.press("Alt+Shift+KeyD");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".excalidraw.theme--dark")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ud:theme"))).toBe("light");
});
