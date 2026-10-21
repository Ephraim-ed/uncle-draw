import { expect, test, type Page } from "@playwright/test";
import { adminGetBoard, createBoard, signIn, uniqueEmail } from "./helpers";

interface El {
  id: string;
  type: string;
  isDeleted?: boolean;
  customData?: { udTable?: string; udAlign?: string };
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  backgroundColor?: string;
  width: number;
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

/** Pastes text the way a browser does: a paste event carrying text/plain, on the canvas or into a cell's editor. */
async function paste(page: Page, into: "canvas" | "cell", text: string) {
  await page.evaluate(
    ({ into, text }) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const target = into === "cell" ? document.querySelector(".excalidraw textarea")! : document;
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { into, text },
  );
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
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

  // Main menu → "Insert table…" → dialog → default to-do table.
  await page.getByTestId("main-menu-trigger").click();
  await page.getByRole("button", { name: "Insert table…" }).click();
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

test("draw a table with the toolbar tool, resize it, edit it from the table bar and paste into it", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("table-tool"));
  const boardId = await createBoard(page);
  const cells = async () => live(await scene(boardId), "cell");

  // B picks the tool; dragging 376 × 192 px draws header + 3 rows, checkbox + 2 columns.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.keyboard.press("b");
  await expect(page.getByTestId("toolbar-table")).toBeChecked();
  await drag(page, { x: 300, y: 200 }, { x: 676, y: 392 });
  await expect(page.getByTestId("toolbar-table")).not.toBeChecked();
  await save(page);
  await expect.poll(async () => (await cells()).length).toBe(12); // Dragging the line between the two text columns widens the first one; one undo step.
  const widthOfCol1 = async () => (await cells()).find((c) => c.x === 356)?.width;
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await drag(page, { x: 516, y: 320 }, { x: 596, y: 320 });
  await save(page);
  await expect.poll(widthOfCol1).toBe(240);
  expect(Math.min(...(await cells()).filter((c) => c.x > 356).map((c) => c.x))).toBe(596);
  await page.keyboard.press("ControlOrMeta+z");
  await save(page);
  await expect.poll(widthOfCol1).toBe(160);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await save(page);
  await expect.poll(widthOfCol1).toBe(240);

  // Clicking a cell selects the table and shows its bar; actions apply to that cell.
  await page.mouse.click(476, 272); // first body row, first text column
  const bar = page.getByRole("toolbar", { name: "Table" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Insert row below" }).click();
  await save(page);
  await expect.poll(async () => (await cells()).length).toBe(15);
  await bar.getByRole("button", { name: "Insert column right" }).click();
  await save(page);
  await expect.poll(async () => (await cells()).length).toBe(20);
  await bar.getByRole("button", { name: "Header row" }).click();
  await save(page);
  await expect.poll(async () => (await cells()).length).toBe(16);
  expect(live(await scene(boardId), "checkbox")).toHaveLength(4);

  // Table-wide style.
  await bar.getByRole("button", { name: "Table style" }).click();
  await bar.getByRole("group", { name: "Cell color" }).getByTitle("Light yellow").click();
  await save(page);
  await expect
    .poll(async () => new Set((await cells()).map((c) => c.backgroundColor)))
    .toEqual(new Set(["#ffec99"]));
  await bar.getByRole("button", { name: "Align left" }).click();
  await save(page);
  await expect.poll(async () => (await cells()).every((c) => c.customData?.udAlign === "left")).toBe(true);

  // Pasting lines fills cells from the clicked one; tabs make columns, [x] ticks the row.
  await page.mouse.click(476, 272);
  await paste(page, "canvas", "- [x] Milk\t2\n- [ ] Eggs\t12\nBread");
  await save(page);
  await expect
    .poll(async () =>
      texts(await scene(boardId))
        .map((t) => t.originalText)
        .sort(),
    )
    .toEqual(["12", "2", "Bread", "Eggs", "Milk"]);
  expect(live(await scene(boardId), "tick")).toHaveLength(1);

  // Pasting lines while typing in a cell spreads them down, adding rows as needed.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.dblclick(476, 200 + 48 + 3 * 48 + 24); // last row, first text column
  await expect(page.locator(".excalidraw textarea")).toBeFocused();
  await paste(page, "cell", "Apples\nPears\nPlums");
  await save(page);
  await expect.poll(async () => (await cells()).length).toBe(24);
  const all = texts(await scene(boardId)).map((t) => t.originalText);
  expect(all).toEqual(expect.arrayContaining(["Apples", "Pears", "Plums"]));
});

test("flowchart templates drop in as editable, connected shapes", async ({ page }) => {
  await signIn(page, uniqueEmail("templates"));
  const boardId = await createBoard(page);

  await page.getByTestId("toolbar-templates").click();
  const dialog = page.getByRole("dialog", { name: "Flowchart templates" });
  await expect(dialog.getByRole("button", { name: /Swimlanes/ })).toBeVisible();
  await expect(dialog.locator(".ud-template__preview svg")).toHaveCount(6);
  await dialog.getByRole("button", { name: /Yes or no/ }).click();
  await expect(dialog).toBeHidden();
  await save(page);

  await expect.poll(async () => (await scene(boardId)).filter((e) => e.type === "diamond").length).toBe(1);
  const els = await scene(boardId);
  const arrows = els.filter((e) => e.type === "arrow");
  expect(arrows).toHaveLength(6);
  const ids = new Set(els.map((e) => e.id));
  expect(arrows.every((a) => ids.has(a.startBinding!.elementId) && ids.has(a.endBinding!.elementId))).toBe(
    true,
  );
  expect(texts(els).map((t) => t.originalText)).toEqual(expect.arrayContaining(["Is it OK?", "Yes", "No"]));
});
