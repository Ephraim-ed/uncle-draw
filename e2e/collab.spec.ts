import { expect, test } from "@playwright/test";
import { adminGetBoard, createBoard, expectTextOnCanvas, signIn, uniqueEmail, writeText } from "./helpers";

/**
 * COLLAB-1…4: the owner shares an edit link; a second person signs in through
 * it, sees the owner live (avatars, edits), edits back, and follows the owner.
 */
test("two people draw on one board live through an edit link", async ({ page, browser }) => {
  // Alice owns the board and creates the edit link.
  await signIn(page, uniqueEmail("alice"));
  const boardId = await createBoard(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: /^Share/ });
  const editLink = share.getByRole("region", { name: "Edit link" });
  await editLink.getByRole("button", { name: "Create edit link" }).click();
  const joinUrl = await editLink.getByRole("textbox", { name: "Edit link" }).inputValue();
  expect(joinUrl).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);
  await page.keyboard.press("Escape");
  await expect(share).toBeHidden();

  // Bob opens it signed out, signs in, and lands on the board.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto(new URL(joinUrl).pathname);
  await bob.waitForURL(/\/login\?next=/);
  await signIn(bob, uniqueEmail("bob"), bob.url());
  await bob.waitForURL(new RegExp(`/b/${boardId}$`));
  await expect(bob.locator(".excalidraw")).toBeVisible();

  // Presence: each sees the other's avatar (plus their own) top-right.
  await expect(page.locator(".UserList__collaborator")).toHaveCount(2);
  await expect(bob.locator(".UserList__collaborator")).toHaveCount(2);

  // Live edits both ways.
  await page.bringToFront();
  await writeText(page, 400, 300, "Ahoy from Alice");
  await bob.bringToFront();
  await expectTextOnCanvas(bob, "Ahoy from Alice");
  await writeText(bob, 400, 500, "Hello from Bob");
  await page.bringToFront();
  await expectTextOnCanvas(page, "Hello from Bob");

  // Both edits reach the database.
  await expect
    .poll(async () =>
      (await adminGetBoard(boardId)).scene.elements
        .filter((e) => e.type === "text" && !e.isDeleted)
        .map((e) => e.text)
        .sort(),
    )
    .toEqual(["Ahoy from Alice", "Hello from Bob"]);

  // Images: Alice pastes one; Bob's editor fetches it from her upload (storage RLS for editors).
  await page.mouse.click(700, 650); // focus the canvas, away from the search panel
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2f9e44";
    ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "shot.png", { type: "image/png" }));
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(
      () =>
        bob.evaluate(() =>
          performance.getEntriesByType("resource").some((r) => r.name.includes("/object/sign/board-files/")),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Follow mode: Bob clicks Alice's avatar.
  await bob.bringToFront();
  await bob.locator(".UserList__collaborator .Avatar", { hasText: /^A$/ }).click();
  await expect(bob.locator(".follow-mode__badge__username")).toHaveText(/^alice-/);

  // Editors can't rename; the board shows up on their dashboard as shared.
  await bob.getByTestId("main-menu-trigger").click();
  await expect(bob.getByRole("button", { name: "Rename…" })).toHaveCount(0);
  await bob.keyboard.press("Escape");
  await bob.goto("/boards");
  await expect(bob.getByRole("link", { name: /Shared with you/ })).toBeVisible();

  // The owner removes Bob; his board list no longer has it.
  await page.bringToFront();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const people = page
    .getByRole("dialog", { name: /^Share/ })
    .getByRole("region", { name: "People who can edit" });
  await people.getByRole("button", { name: /^Remove bob-/ }).click();
  await expect(people.getByText(/^bob-/)).toHaveCount(0);
  await bob.reload();
  await expect(bob.getByRole("link", { name: /Shared with you/ })).toHaveCount(0);

  await bobContext.close();
});
