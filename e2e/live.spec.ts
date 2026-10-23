import { expect, test as base, type Browser, type Page } from "@playwright/test";
import { createBoard, inviteEditor, signIn, uniqueEmail } from "./helpers";

/**
 * COLLAB-5…7: two editors talk over voice chat (Chromium's fake microphone
 * plays a beep), one presents while the other follows their view, and one
 * shares their screen (Chromium's fake capture) with the other.
 */
const test = base.extend({
  // A fake microphone, and no permission prompt.
  launchOptions: [
    async ({ launchOptions }, use) => {
      await use({
        ...launchOptions,
        args: [
          ...(launchOptions.args ?? []),
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
        ],
      });
    },
    { scope: "worker" },
  ],
});
test.use({ permissions: ["microphone"] });

/** Keeps every RTCPeerConnection the page makes, to check that audio arrives. */
function recordPeerConnections() {
  const pcs: RTCPeerConnection[] = [];
  (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = pcs;
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(config?: RTCConfiguration) {
      super(config);
      pcs.push(this);
    }
  };
}

/** Audio bytes received over connected peer connections. */
function audioBytesIn(page: Page) {
  return page.evaluate(async () => {
    let bytes = 0;
    for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
      if (pc.connectionState !== "connected") continue;
      (await pc.getStats()).forEach((r: { type: string; kind?: string; bytesReceived?: number }) => {
        if (r.type === "inbound-rtp" && r.kind === "audio") bytes += r.bytesReceived ?? 0;
      });
    }
    return bytes;
  });
}

/** Alice owns a board and Bob joins it through the edit link. */
async function twoEditors(page: Page, browser: Browser) {
  await page.addInitScript(recordPeerConnections);
  await signIn(page, uniqueEmail("alice"));
  await createBoard(page);
  const { guest, context } = await inviteEditor(page, browser, {
    context: { permissions: ["microphone"] },
    prepare: (bob) => bob.addInitScript(recordPeerConnections),
  });
  return { bob: guest, bobContext: context };
}

const liveBar = (page: Page) => page.getByRole("toolbar", { name: "Voice and sharing" });
/** The other person's avatar in Excalidraw's collaborator list. */
const otherAvatar = (page: Page) => page.locator(".UserList__collaborator:not(.is-current-user)");

test("voice chat: two editors hear each other, with mute and speaking badges", async ({ page, browser }) => {
  const { bob, bobContext } = await twoEditors(page, browser);

  // Nobody's here alone, so both get the live bar.
  await expect(liveBar(page)).toBeVisible();
  await expect(liveBar(bob)).toBeVisible();

  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Join voice" }).click();
  await expect(liveBar(page).getByRole("button", { name: "Mute" })).toBeVisible();

  // Bob sees Alice in the call before joining.
  await bob.bringToFront();
  await expect(otherAvatar(bob)).toHaveClass(/is-in-call/);
  const join = liveBar(bob).getByRole("button", { name: /^Join voice/ });
  await expect(join).toHaveAccessibleName(/1 person talking/);
  await join.click();
  await expect(liveBar(bob).getByRole("button", { name: "Mute" })).toBeVisible();

  // Audio flows peer to peer, both ways, and each sees the other speaking.
  await expect.poll(() => audioBytesIn(page), { timeout: 20_000 }).toBeGreaterThan(1000);
  await expect.poll(() => audioBytesIn(bob), { timeout: 20_000 }).toBeGreaterThan(1000);
  // The fake microphone beeps about once a second, so watch every frame rather than poll.
  await bob.waitForFunction(
    () => document.querySelector(".UserList__collaborator.is-speaking:not(.is-current-user)"),
    null,
    { polling: "raf", timeout: 15_000 },
  );

  // Alice mutes: Bob sees the muted badge.
  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Mute" }).click();
  await expect(liveBar(page).getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
  await expect(otherAvatar(bob)).toHaveClass(/is-muted/);

  // Bob leaves: Alice sees him out of the call.
  await bob.bringToFront();
  await liveBar(bob).getByRole("button", { name: "Leave voice" }).click();
  await expect(liveBar(bob).getByRole("button", { name: /^Join voice/ })).toBeVisible();
  await expect(otherAvatar(page)).not.toHaveClass(/is-in-call/);

  await bobContext.close();
});

test("presenter mode: everyone follows the presenter's view", async ({ page, browser }) => {
  const { bob, bobContext } = await twoEditors(page, browser);
  const zoom = (p: Page) => p.getByTitle("Reset zoom").innerText();

  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Present" }).click();
  await expect(liveBar(page).getByRole("button", { name: "Stop presenting" })).toBeVisible();

  // Bob follows automatically and is told why his view moves.
  await expect(bob.locator(".follow-mode__badge__username")).toHaveText(/^alice-/);
  await expect(bob.getByText(/is presenting\. You're following their view\./).first()).toBeVisible();
  await expect(liveBar(bob).getByRole("status")).toHaveText(/^alice-.* is presenting$/);
  await expect(liveBar(page).getByRole("status")).toHaveText("1 following");

  // Alice zooms in; Bob's view follows.
  for (let i = 0; i < 3; i++) await page.getByTitle(/^Zoom in/).click();
  await expect(page.getByTitle("Reset zoom")).toHaveText("130%");
  await expect.poll(() => zoom(bob)).toBe("130%");

  // Bob looks around on his own, then goes back to Alice's view.
  await bob.bringToFront();
  await bob.mouse.move(640, 430);
  await bob.mouse.wheel(0, 400);
  await expect(bob.locator(".follow-mode__badge")).toHaveCount(0);
  await liveBar(bob)
    .getByRole("button", { name: /^Follow alice-/ })
    .click();
  await expect(bob.locator(".follow-mode__badge__username")).toHaveText(/^alice-/);

  // Bob can't present over Alice.
  await expect(liveBar(bob).getByRole("button", { name: "Present" })).toHaveCount(0);

  // Alice stops: Bob is let go.
  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Stop presenting" }).click();
  await expect(bob.locator(".follow-mode__badge")).toHaveCount(0);
  await expect(bob.getByText(/stopped presenting\./).first()).toBeVisible();
  await expect(liveBar(bob).getByRole("button", { name: "Present" })).toBeVisible();

  await bobContext.close();
});

test("screen sharing: everyone else sees the sharer's screen", async ({ page, browser }) => {
  const { bob, bobContext } = await twoEditors(page, browser);

  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Share screen" }).click();
  await expect(liveBar(page).getByRole("button", { name: "Stop sharing" })).toBeVisible();
  // Nobody else can start sharing meanwhile.
  await expect(liveBar(bob).getByRole("button", { name: "Share screen" })).toHaveCount(0);

  // Bob gets the panel without doing anything, and video frames arrive.
  const panel = bob.getByRole("region", { name: /^alice-.*'s screen$/ });
  await expect(panel).toBeVisible();
  await expect
    .poll(() => panel.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(liveBar(page).getByRole("status")).toHaveText("1 watching");

  // Bigger, smaller, tucked away and back.
  await bob.bringToFront();
  await panel.getByRole("button", { name: "Make bigger" }).click();
  await expect(panel).toHaveAttribute("data-large", "true");
  await panel.getByRole("button", { name: "Make smaller" }).click();
  await panel.getByRole("button", { name: "Hide" }).click();
  await expect(panel.locator("video")).toHaveCount(0);
  await panel.getByRole("button", { name: /^Show / }).click();
  await expect(panel.locator("video")).toHaveCount(1);

  // Alice stops: the panel goes away.
  await page.bringToFront();
  await liveBar(page).getByRole("button", { name: "Stop sharing" }).click();
  await expect(panel).toHaveCount(0);
  await expect(liveBar(bob).getByRole("button", { name: "Share screen" })).toBeVisible();

  await bobContext.close();
});
