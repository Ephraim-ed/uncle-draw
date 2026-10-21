import { expect, test, type Page } from "@playwright/test";
import { adminGetBoard, createBoard, signIn, uniqueEmail } from "./helpers";

interface El {
  id: string;
  type: string;
  isDeleted?: boolean;
  customData?: { udFlow?: string };
  containerId?: string | null;
  /** What was typed; `text` has Excalidraw's wrapping line breaks. */
  originalText?: string;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  x: number;
  y: number;
  height: number;
}

async function scene(boardId: string): Promise<El[]> {
  return (await adminGetBoard(boardId)).scene.elements as unknown as El[];
}
const live = (els: El[]) => els.filter((e) => !e.isDeleted);
const texts = (els: El[]) => live(els).filter((e) => e.type === "text");
/** The shape a label is in. */
const labelled = (els: El[], text: string) => {
  const label = texts(els).find((t) => t.originalText === text);
  return live(els).find((e) => e.id === label?.containerId);
};
const lanes = (els: El[]) => live(els).filter((e) => e.customData?.udFlow === "lane");

async function save(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
}

async function typeLabel(page: Page, text: string) {
  await expect(page.locator(".excalidraw textarea")).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

/** Blank canvas, clear of the chart and of Excalidraw's panels. */
const EMPTY = { x: 1240, y: 780 };

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

/**
 * EDIT-8. The Swimlanes template (1100 × 480) lands centered in the 1280 × 860
 * viewport at zoom 100%: top-left (90, 190), lanes 160 px tall, headers 140 px
 * wide. "Place order" is at (270, 234); the "Sales" header's middle is (160, 430).
 */
test("grow a swimlane chart with next steps and more lanes", async ({ page }) => {
  await signIn(page, uniqueEmail("lanes"));
  const boardId = await createBoard(page);
  await page.getByTestId("toolbar-templates").click();
  await page
    .getByRole("dialog", { name: "Flowchart templates" })
    .getByRole("button", { name: /Swimlanes/ })
    .click();
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await save(page);
  await expect.poll(async () => lanes(await scene(boardId)).length).toBe(3);
  const before = await scene(boardId);
  const shipY = labelled(before, "Pack and ship")!.y;

  // "+" on a step adds a connected next step and starts typing its name.
  await page.mouse.click(360, 270); // Place order
  await page.getByRole("button", { name: "Add next step to the right" }).click();
  await typeLabel(page, "Pay");
  // From there, down goes into the next lane (Sales).
  await page.getByRole("button", { name: "Add next step below" }).click();
  await typeLabel(page, "Invoice");
  await save(page);
  await expect
    .poll(async () => texts(await scene(boardId)).map((t) => t.originalText))
    .toEqual(expect.arrayContaining(["Pay", "Invoice"]));
  let els = await scene(boardId);
  const order = labelled(els, "Place order")!;
  const pay = labelled(els, "Pay")!;
  const invoice = labelled(els, "Invoice")!;
  const sales = labelled(els, "Sales")!;
  expect(pay.y).toBe(order.y); // same lane, to the right
  expect(invoice.y + invoice.height / 2).toBe(sales.y + sales.height / 2); // centered in Sales
  const arrows = live(els).filter((e) => e.type === "arrow");
  expect(
    arrows.some((a) => a.startBinding?.elementId === order.id && a.endBinding?.elementId === pay.id),
  ).toBe(true);
  expect(
    arrows.some((a) => a.startBinding?.elementId === pay.id && a.endBinding?.elementId === invoice.id),
  ).toBe(true);

  // The lane bar on a lane's header adds a lane below it, and the rest of the chart makes room.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await page.mouse.click(160, 430); // the Sales header
  const lanebar = page.getByRole("toolbar", { name: "Swimlane" });
  await lanebar.getByRole("button", { name: "Add lane below" }).click();
  await typeLabel(page, "Billing");
  await save(page);
  await expect.poll(async () => lanes(await scene(boardId)).length).toBe(4);
  els = await scene(boardId);
  expect(labelled(els, "Billing")!.y).toBe(sales.y + 160);
  expect(labelled(els, "Pack and ship")!.y).toBe(shipY + 160);

  // And removes it again, closing the gap.
  await lanebar.getByRole("button", { name: "Delete lane and its steps" }).click();
  await save(page);
  await expect.poll(async () => lanes(await scene(boardId)).length).toBe(3);
  expect(labelled(await scene(boardId), "Pack and ship")!.y).toBe(shipY);
});
