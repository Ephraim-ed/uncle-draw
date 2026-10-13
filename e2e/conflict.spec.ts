import { expect, test } from "@playwright/test";
import {
  adminGetBoard,
  createBoard,
  drawEllipse,
  drawRectangle,
  saveNow,
  signIn,
  uniqueEmail,
} from "./helpers";

/** SAVE-4: the same board open twice; the stale tab must not overwrite silently. */
test("conflict detection across two tabs", async ({ page, context }) => {
  await signIn(page, uniqueEmail("conflict"));
  const boardId = await createBoard(page);

  // Second tab on the same board (same session).
  const other = await context.newPage();
  await other.goto(`/b/${boardId}`);
  await expect(other.locator(".excalidraw")).toBeVisible();

  // Tab A saves first.
  await page.bringToFront();
  await drawRectangle(page, 400, 300);
  await saveNow(page);
  expect((await adminGetBoard(boardId)).version).toBe(2);

  // Tab B is still on version 1: its save is rejected and autosave pauses.
  await other.bringToFront();
  await drawEllipse(other, 600, 300);
  await other.keyboard.press("ControlOrMeta+s");
  const conflict = other.getByRole("dialog", { name: "This board was changed somewhere else." });
  await expect(conflict).toBeVisible();
  await expect(other.locator(".ud-pill-wrap")).toHaveAttribute("data-status", "conflict");
  expect((await adminGetBoard(boardId)).scene.elements.map((e) => e.type)).toEqual(["rectangle"]);

  // "Load the latest" replaces tab B's canvas with the server version.
  await conflict.getByRole("button", { name: "Load the latest" }).click();
  await expect(conflict).toBeHidden();
  await expect(other.locator(".ud-pill-wrap")).toHaveAttribute("data-status", "saved");

  // Autosave resumes from the right version.
  await drawEllipse(other, 650, 420);
  await saveNow(other);
  const final = await adminGetBoard(boardId);
  expect(final.version).toBe(3);
  expect(final.scene.elements.map((e) => e.type).sort()).toEqual(["ellipse", "rectangle"]);
});

test("'Keep my version' overwrites the other tab's save", async ({ page, context }) => {
  await signIn(page, uniqueEmail("keepmine"));
  const boardId = await createBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${boardId}`);
  await expect(other.locator(".excalidraw")).toBeVisible();

  await page.bringToFront();
  await drawRectangle(page, 400, 300);
  await saveNow(page);

  await other.bringToFront();
  await drawEllipse(other, 600, 300);
  await other.keyboard.press("ControlOrMeta+s");
  const conflict = other.getByRole("dialog", { name: "This board was changed somewhere else." });
  await conflict.getByRole("button", { name: "Keep my version" }).click();
  await expect(conflict).toBeHidden();
  await expect(other.locator(".ud-pill-wrap")).toHaveAttribute("data-status", "saved");
  expect((await adminGetBoard(boardId)).scene.elements.map((e) => e.type)).toEqual(["ellipse"]);
});
