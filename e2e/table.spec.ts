import { expect, test, type Page } from "@playwright/test";
import { adminGetBoard, createBoard, signIn, uniqueEmail } from "./helpers";

interface El {
  id: string;
  type: string;
  isDeleted?: boolean;
  customData?: { udTable?: string };
  containerId?: string | null;
  /** What was typed; `text` has Excalidraw's wrapping line breaks. */
  originalText?: string;
  x: number;
  y: number;
  height: number;
}

async function scene(boardId: string): Promise<El[]> {
  return (await adminGetBoard(boardId)).scene.elements as unknown as El[];
}
const live = (els: El[], part: string) => els.filter((e) => !e.isDeleted && e.customData?.udTable === part);
const texts = (els: El[]) => els.filter((e) => !e.isDeleted && e.type === "text");

async function save(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
}

/**
 * EDIT-7. A new board starts at zoom 100% with the scene origin at the
 * viewport's top-left, and the default table (header + 3 rows, checkbox column
 * + 2 columns, 376 × 192) lands centered in the 1280 × 860 viewport:
 * top-left (452, 334), rows 48 px tall, columns 56 / 160 / 160 px wide.
 */
const ROW = (n: number) => 334 + 48 * n + 24; // n = 1..3 are body rows
const BOX_X = 452 + 28;
const COL = (n: number) => 452 + 56 + 160 * (n - 1) + 80;
/** Blank canvas, clear of the table and of Excalidraw's properties panel. */
const EMPTY = { x: 1100, y: 640 };

test("insert a table, tick its boxes and type in its cells", async ({ page }) => {
  await signIn(page, uniqueEmail("table"));
  const boardId = await createBoard(page);

  // Footer "Table" button → dialog → default to-do table.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert a table" });
  await dialog.getByRole("button", { name: "Insert table" }).click();
  await expect(dialog).toBeHidden();
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "cell").length).toBe(12);
  expect(live(await scene(boardId), "checkbox")).toHaveLength(3);

  // One click ticks a box; it doesn't move, select or start a text box.
  await page.mouse.click(EMPTY.x, EMPTY.y); // deselect
  await page.mouse.click(BOX_X, ROW(1));
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "tick").length).toBe(1);
  await expect(page.locator(".excalidraw textarea")).toHaveCount(0);

  // A tick is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "tick").length).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "tick").length).toBe(1);

  // A double-click on a box is two toggles, and still no stray text.
  await page.mouse.dblclick(BOX_X, ROW(2));
  await page.mouse.click(BOX_X, ROW(1)); // untick row 1
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "tick").length).toBe(0);
  expect(texts(await scene(boardId))).toHaveLength(0);
  await page.mouse.click(BOX_X, ROW(1)); // and tick it again

  // Double-click a cell and type: the text is bound to that cell.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.dblclick(COL(1), ROW(1));
  await expect(page.locator(".excalidraw textarea")).toBeFocused();
  await page.keyboard.type("Buy milk");
  await page.keyboard.press("Escape");
  await save(page);
  await expect.poll(async () => texts(await scene(boardId)).map((t) => t.originalText)).toEqual(["Buy milk"]);
  const els = await scene(boardId);
  const milk = texts(els)[0]!;
  expect(live(els, "cell").map((c) => c.id)).toContain(milk.containerId);

  // Text that wraps grows its row, and the rows below move down to make room.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.dblclick(COL(2), ROW(1));
  await expect(page.locator(".excalidraw textarea")).toBeFocused();
  await page.keyboard.type("Call the plumber about the leaky kitchen tap");
  await page.keyboard.press("Escape");
  await save(page);
  await expect.poll(async () => texts(await scene(boardId))).toHaveLength(2);
  await expect
    .poll(async () => {
      const cells = live(await scene(boardId), "cell");
      const row1 = cells.filter((c) => c.y === 382);
      const height = row1[0]?.height ?? 0;
      const nextTop = Math.min(...cells.filter((c) => c.y > 382).map((c) => c.y));
      return {
        sameHeight: row1.every((c) => c.height === height),
        grew: height > 48,
        pushed: nextTop === 382 + height,
      };
    })
    .toEqual({ sameHeight: true, grew: true, pushed: true });

  await page.mouse.click(EMPTY.x, EMPTY.y);
  // Everything survives a reload, and boxes still tick afterwards.
  await page.reload();
  await expect(page.locator(".excalidraw")).toBeVisible();
  const reloaded = await scene(boardId);
  expect(live(reloaded, "tick")).toHaveLength(1);
  expect(
    texts(reloaded)
      .map((t) => t.originalText)
      .sort(),
  ).toEqual(["Buy milk", "Call the plumber about the leaky kitchen tap"]);
  const box3 = live(reloaded, "checkbox").sort((a, b) => a.y - b.y)[2]!;
  await page.mouse.click(BOX_X, box3.y + 11);
  await save(page);
  await expect.poll(async () => live(await scene(boardId), "tick").length).toBe(2);
});
