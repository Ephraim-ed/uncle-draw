import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
const MAILPIT_URL = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL ?? "http://127.0.0.1:54324";

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(performance.now())}@example.com`;
}

interface MailpitSearch {
  messages: Array<{ ID: string; Created: string }>;
}

/** Polls Mailpit for the newest magic link sent to `email`. */
async function magicLinkFor(email: string, sentAfter: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as MailpitSearch;
      const fresh = messages.filter((m) => Date.parse(m.Created) >= sentAfter - 2000);
      if (fresh[0]) {
        const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${fresh[0].ID}`)).json()) as {
          Text: string;
          HTML: string;
        };
        const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${msg.Text}\n${msg.HTML}`);
        if (match) return match[0].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link email for ${email}`);
}

/** AUTH-1: magic-link sign-in through the real UI and Mailpit. */
export async function signIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  const sentAfter = Date.now();
  await page.getByRole("button", { name: "Send me a magic link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  const link = await magicLinkFor(email, sentAfter);
  await page.goto(link);
}

/** Creates a board from the dashboard and waits for the editor. Returns its id. */
export async function createBoard(page: Page): Promise<string> {
  await page
    .getByRole("button", { name: /New board/ })
    .first()
    .click();
  await page.waitForURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(page.locator(".excalidraw")).toBeVisible();
  return page.url().split("/b/")[1]!;
}

/**
 * COLLAB-1: the owner (on `page`, in the editor) creates an edit link, and a
 * second person signs in through it in a new browser context. Resolves once
 * each sees the other on the board.
 */
export async function inviteEditor(
  page: Page,
  browser: Browser,
  opts: { context?: BrowserContextOptions; prepare?: (guest: Page) => Promise<unknown> } = {},
) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const editLink = page.getByRole("dialog", { name: /^Share/ }).getByRole("region", { name: "Edit link" });
  await editLink.getByRole("button", { name: "Create edit link" }).click();
  const joinUrl = await editLink.getByRole("textbox", { name: "Edit link" }).inputValue();
  await page.keyboard.press("Escape");

  const context = await browser.newContext(opts.context);
  const guest = await context.newPage();
  await opts.prepare?.(guest);
  await guest.goto(new URL(joinUrl).pathname);
  await guest.waitForURL(/\/login\?next=/);
  await signIn(guest, uniqueEmail("bob"), guest.url());
  await guest.waitForURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(guest.locator(".UserList__collaborator")).toHaveCount(2);
  await expect(page.locator(".UserList__collaborator")).toHaveCount(2);
  return { guest, context };
}

const TOOL_TITLES = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  arrow: "Arrow",
  selection: "Selection",
} as const;

/** Picks a tool from Excalidraw's toolbar (the radio input is hidden; click its label). */
export async function pickTool(page: Page, tool: keyof typeof TOOL_TITLES) {
  await page.locator(`label[title^="${TOOL_TITLES[tool]} "]`).click();
}

export async function drawRectangle(page: Page, x: number, y: number, w = 160, h = 100) {
  await pickTool(page, "rectangle");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w / 2, y + h / 2, { steps: 5 });
  await page.mouse.move(x + w, y + h, { steps: 5 });
  await page.mouse.up();
}

export async function drawEllipse(page: Page, x: number, y: number) {
  await pickTool(page, "ellipse");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 8 });
  await page.mouse.up();
}

export async function writeText(page: Page, x: number, y: number, text: string) {
  await pickTool(page, "text");
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

/** Ctrl/Cmd+S forces a save (SAVE-1); waits until the pill says saved. */
export async function saveNow(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".ud-pill-wrap")).toHaveAttribute("data-status", "saved");
}

/** Reads a board straight from the database with the service-role key. */
export async function adminGetBoard(id: string): Promise<{
  title: string;
  version: number;
  scene: { elements: Array<{ type: string; text?: string; isDeleted?: boolean }> };
}> {
  if (!SERVICE_ROLE_KEY) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (from `supabase status -o env`).");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/boards?id=eq.${id}&select=title,version,scene`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const rows = (await res.json()) as Array<{
    title: string;
    version: number;
    scene: { elements: Array<{ type: string; text?: string; isDeleted?: boolean }> };
  }>;
  if (!rows[0]) throw new Error(`Board ${id} not found`);
  return rows[0];
}

/** Counts board_files rows for a board (service role). */
export async function adminCountFiles(boardId: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/board_files?board_id=eq.${boardId}&select=file_id`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return ((await res.json()) as unknown[]).length;
}

/** Types of the board's live elements in the database (tombstones left out), sorted. */
export async function adminLiveTypes(boardId: string): Promise<string[]> {
  const board = await adminGetBoard(boardId);
  return board.scene.elements
    .filter((e) => !e.isDeleted)
    .map((e) => e.type)
    .sort();
}

/** Finds `text` with Excalidraw's "Find on canvas" (search is debounced, so this retries). */
export async function expectTextOnCanvas(page: Page, text: string) {
  const search = page.locator(".layer-ui__search");
  if (!(await search.isVisible())) {
    await page.getByTestId("main-menu-trigger").click();
    await page.getByTestId("search-menu-button").click();
  }
  const input = search.locator("input");
  await expect(async () => {
    await input.fill("");
    await input.fill(text);
    await expect(search.locator(".layer-ui__search-count")).toContainText("1 result", { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}
