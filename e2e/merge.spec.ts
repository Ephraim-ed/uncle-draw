import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  adminGetBoard,
  adminLiveTypes,
  createBoard,
  drawEllipse,
  drawRectangle,
  saveNow,
  signIn,
  uniqueEmail,
} from "./helpers";

/**
 * SAVE-4 / COLLAB-2: tabs that can't talk live (tab B's Realtime is blocked)
 * still never overwrite each other. A stale save merges per element with the
 * server's copy, and deletions win over stale copies (tombstones).
 */

/** A second tab on the board with no live sync: its socket never answers. */
async function staleTab(context: BrowserContext, boardId: string): Promise<Page> {
  const other = await context.newPage();
  await other.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});
  await other.goto(`/b/${boardId}`);
  await expect(other.locator(".excalidraw")).toBeVisible();
  return other;
}

test("a stale tab's save merges with the newer one instead of replacing it", async ({ page, context }) => {
  await signIn(page, uniqueEmail("merge"));
  const boardId = await createBoard(page);
  const other = await staleTab(context, boardId);

  // Tab A saves a rectangle first.
  await page.bringToFront();
  await drawRectangle(page, 400, 300);
  await saveNow(page);
  expect((await adminGetBoard(boardId)).version).toBe(2);

  // Tab B is still on version 1: its ellipse is merged with A's rectangle.
  await other.bringToFront();
  await drawEllipse(other, 650, 300);
  await saveNow(other);
  await expect.poll(() => adminLiveTypes(boardId)).toEqual(["ellipse", "rectangle"]);
  expect((await adminGetBoard(boardId)).version).toBe(3);
});

test("a stale tab can't bring back something deleted elsewhere", async ({ page, context }) => {
  await signIn(page, uniqueEmail("tombstone"));
  const boardId = await createBoard(page);
  await drawRectangle(page, 400, 300);
  await saveNow(page);

  // Tab B opens with the rectangle, then loses touch.
  const other = await staleTab(context, boardId);

  // Tab A deletes the rectangle.
  await page.bringToFront();
  await page.mouse.click(1000, 700); // empty canvas: focus the editor
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await saveNow(page);
  await expect.poll(() => adminLiveTypes(boardId)).toEqual([]);

  // Tab B still shows it. Its next save keeps B's new ellipse, not the rectangle.
  await other.bringToFront();
  await drawEllipse(other, 650, 500);
  await saveNow(other);
  await expect.poll(() => adminLiveTypes(boardId)).toEqual(["ellipse"]);
  const rect = (await adminGetBoard(boardId)).scene.elements.find((e) => e.type === "rectangle");
  expect(rect?.isDeleted).toBe(true);
});
