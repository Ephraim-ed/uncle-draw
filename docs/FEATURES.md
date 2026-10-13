# Uncle Draw — Features

> Status: Draft v0.1 · Last updated: 2026-10-13
> Companion docs: [TECHNICAL_REQUIREMENTS.md](./TECHNICAL_REQUIREMENTS.md) · [VISUAL_DESIGN.md](./VISUAL_DESIGN.md)

This doc lists what Uncle Draw does, for whom, and when. Each feature has an ID, a milestone, a priority and acceptance criteria that can be checked in a test or a demo. The technical doc explains *how*; the visual doc explains *how it looks*.

---

## How to read this doc

**Milestones**

| Milestone | Theme | Outcome |
|---|---|---|
| **v1** | Foundation | A signed-in person can sketch on boards that are safely saved to the cloud and share a read-only link. Usable day to day. |
| **v1.1** | Polish | Quality-of-life features: trash, duplicate, search, import, personal library, account deletion. |
| **v2** | Together | Real-time collaboration and version history. |

**Priorities** (within a milestone)

| Priority | Meaning |
|---|---|
| **P0** | Must ship. The milestone isn't done without it. |
| **P1** | Should ship. It can slip to the next milestone only with a written reason. |
| **P2** | Could ship. Backlog. |

---

## Feature summary

| ID | Feature | Milestone | Priority |
|---|---|---|---|
| AUTH-1 | Sign in with email magic link | v1 | P0 |
| AUTH-2 | Sign in with GitHub | v1 | P0 |
| AUTH-3 | Sign out | v1 | P0 |
| AUTH-4 | Protected routes and return-to | v1 | P0 |
| AUTH-5 | Profile (name and avatar) | v1 | P1 |
| AUTH-6 | Delete account | v1.1 | P1 |
| DASH-1 | List my boards | v1 | P0 |
| DASH-2 | Create a board | v1 | P0 |
| DASH-3 | Rename a board | v1 | P0 |
| DASH-4 | Delete a board (move to trash) | v1 | P0 |
| DASH-5 | Board thumbnails | v1 | P0 |
| DASH-6 | Trash: restore and permanent delete | v1.1 | P1 |
| DASH-7 | Duplicate a board | v1.1 | P1 |
| DASH-8 | Search and sort boards | v1.1 | P1 |
| EDIT-1 | Full Excalidraw editor | v1 | P0 |
| EDIT-2 | Hand-drawn defaults | v1 | P0 |
| EDIT-3 | Board title and rename in editor | v1 | P0 |
| EDIT-4 | Uncle Draw menu, welcome screen and branding | v1 | P0 |
| EDIT-5 | Remember my view and last-used style | v1 | P1 |
| EDIT-6 | Mermaid → diagram | v1.1 | P2 |
| SAVE-1 | Autosave to the cloud | v1 | P0 |
| SAVE-2 | Save-status indicator | v1 | P0 |
| SAVE-3 | Offline backup and recovery | v1 | P0 |
| SAVE-4 | Conflict detection across tabs and devices | v1 | P0 |
| SAVE-5 | Images on boards | v1 | P0 |
| SAVE-6 | Size limits and warnings | v1 | P1 |
| SHARE-1 | Create a read-only share link | v1 | P0 |
| SHARE-2 | View a shared board | v1 | P0 |
| SHARE-3 | Revoke or regenerate a link | v1 | P0 |
| SHARE-4 | Duplicate a shared board to my boards | v1.1 | P1 |
| SHARE-5 | Link expiry | v1.1 | P2 |
| IO-1 | Export PNG, SVG and clipboard | v1 | P0 |
| IO-2 | Save as `.excalidraw` file | v1 | P0 |
| IO-3 | Import `.excalidraw` file as a new board | v1.1 | P1 |
| LIB-1 | Personal shape library synced to my account | v1.1 | P1 |
| LIB-2 | Install libraries from libraries.excalidraw.com | v1.1 | P2 |
| SET-1 | Theme: light, dark, system | v1 | P1 |
| COLLAB-1 | Invite editors by email | v2 | P0 |
| COLLAB-2 | Real-time co-editing | v2 | P0 |
| COLLAB-3 | Live cursors and presence | v2 | P0 |
| COLLAB-4 | Follow mode | v2 | P2 |
| HIST-1 | Version history and restore | v2 | P1 |
| CMT-1 | Comments on the canvas | v2 | P2 |

---

## 1. Accounts (AUTH)

### AUTH-1 · Sign in with email magic link · v1 · P0
*As a new or returning user, I want to sign in with just my email, so I don't need another password.*
- [ ] `/login` has an email field and "Send me a magic link".
- [ ] Submitting shows the "Check your inbox" state with the address the link went to, plus a "Use a different email" link.
- [ ] Clicking the email link signs me in and lands me on `/boards`, or on the page I originally tried to open (AUTH-4).
- [ ] An invalid or expired link shows a friendly error with a button to send a new one.
- [ ] Requesting another link within 60 s shows "Please wait a minute before requesting another link."

### AUTH-2 · Sign in with GitHub · v1 · P0
*As a developer, I want one-click sign-in with GitHub.*
- [ ] "Continue with GitHub" goes through GitHub OAuth and lands on `/boards` (or the return-to page).
- [ ] An email already used with a magic link signs in to the **same** account (Supabase identity linking by verified email).
- [ ] If I cancel on GitHub, I'm back on `/login` with no error banner.

### AUTH-3 · Sign out · v1 · P0
- [ ] Sign out is in the avatar menu, on both the dashboard and the editor.
- [ ] Signing out flushes any pending save first, then clears this user's local cache (tech §7.6), then goes to `/login`.

### AUTH-4 · Protected routes and return-to · v1 · P0
- [ ] Opening `/boards` or `/b/:id` while signed out redirects to `/login?next=<path>`. After sign-in I land on `<path>`.
- [ ] `/s/:token` never requires sign-in.
- [ ] `next` accepts only same-origin relative paths (no open redirect).

### AUTH-5 · Profile · v1 · P1
- [ ] My display name and avatar come from GitHub. For magic-link users, the name is the part of the email before the `@` and the avatar is my initial in a rough circle.
- [ ] I can edit my display name from the avatar menu.

### AUTH-6 · Delete account · v1.1 · P1
*As a user, I want to delete my account and all my data.*
- [ ] Avatar menu → "Delete account…" asks me to type `delete` to confirm.
- [ ] All boards, files, thumbnails, share links and library items are removed. Existing share links stop working right away.
- [ ] I'm signed out and see a goodbye page.

---

## 2. Dashboard (DASH)

### DASH-1 · List my boards · v1 · P0
*As a user, I want to see all my boards at a glance and jump back into one.*
- [ ] `/boards` shows my non-deleted boards as cards, newest-edited first.
- [ ] Each card shows a thumbnail, the title and "Edited {relative time}".
- [ ] Clicking a card opens `/b/:id`.
- [ ] 24 cards load per page, with more loading as I scroll.
- [ ] Loading, empty (with the arrow doodle) and error (with Retry) states all match [VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §6.2.
- [ ] I never see another user's boards (covered by an RLS test).

### DASH-2 · Create a board · v1 · P0
- [ ] "New board" creates a board titled "Untitled board" and opens it in the editor in under 1 s on a normal connection.
- [ ] The new board starts with the hand-drawn defaults (EDIT-2) and shows the welcome screen.
- [ ] The keyboard shortcut `N` on the dashboard does the same.

### DASH-3 · Rename a board · v1 · P0
- [ ] I can rename from the card's `⋯` menu (inline field) and from the editor (EDIT-3).
- [ ] Titles are 1–200 characters and trimmed. An empty title reverts to the previous one.
- [ ] Renaming never causes a save conflict (tech §5: renames don't bump `version`).

### DASH-4 · Delete a board · v1 · P0
- [ ] `⋯` → "Move to trash" asks for confirmation and then removes the card. A sticky-note toast offers **Undo** for 5 s.
- [ ] The board is soft-deleted (`deleted_at` set), and its share links stop working right away.
- [ ] Opening a trashed board's URL shows "This board is in the trash" with a Restore button. (Restore here is P0 even before DASH-6.)

### DASH-5 · Board thumbnails · v1 · P0
- [ ] A card shows a preview of the board within about 1 min of the last edit, and right after leaving the editor.
- [ ] Empty boards show a blank paper sheet, not a broken image.
- [ ] Thumbnails are always light-themed ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §3.3).

### DASH-6 · Trash · v1.1 · P1
- [ ] `/boards/trash` lists trashed boards with "Restore" and "Delete forever".
- [ ] Boards in the trash for more than 30 days are permanently deleted, files included, by a scheduled job.
- [ ] "Empty trash" deletes them all after confirmation.

### DASH-7 · Duplicate a board · v1.1 · P1
- [ ] `⋯` → "Duplicate" creates "{title} (copy)" with the same content and images, and puts it at the top of the list.
- [ ] Share links are **not** copied.

### DASH-8 · Search and sort · v1.1 · P1
- [ ] The search box filters by title (case-insensitive, matches anywhere in the title, debounced 200 ms).
- [ ] Sort options: Last edited (default), Created, Title A–Z. The choice is remembered per user.
- [ ] `/` focuses the search box.

---

## 3. Editor (EDIT)

### EDIT-1 · Full Excalidraw editor · v1 · P0
*As a user, I want the full Excalidraw drawing experience.*
Everything `@excalidraw/excalidraw` 0.18.1 provides out of the box stays available, including:
- **Tools:** selection, hand/pan, rectangle, diamond, ellipse, arrow (with binding), line, freedraw (pen), text, image, eraser, frame, web embed, laser pointer.
- **Styles:** stroke and background color, fill style, stroke width, stroke style, sloppiness, edges, arrowheads, opacity, font family, size and alignment.
- **Actions:** undo/redo, copy/paste, duplicate, group/ungroup, align/distribute, layer order, lock, flip, element links, zoom/fit, grid, snapping, zen mode, view mode, find on canvas, command palette, keyboard shortcuts and help, theme toggle.

Acceptance:
- [ ] Each tool above can be used on a Uncle Draw board, and the result survives a reload (SAVE-1).
- [ ] We don't fork or patch Excalidraw. Customization uses props, slots and CSS variables only.

### EDIT-2 · Hand-drawn defaults · v1 · P0
*As a user, I want new drawings to look hand-sketched without fiddling with settings.*
- [ ] New boards default to Artist sloppiness, the Excalifont font and the **hachure** fill style ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §7).
- [ ] Shapes look identical after reload and on other devices. No re-randomized wobble.

### EDIT-3 · Board title in the editor · v1 · P0
- [ ] On desktop the title appears top-right; clicking it renames inline. On smaller screens, Main menu → "Rename…" does the same.
- [ ] The browser tab title is "{board title} · Uncle Draw".

### EDIT-4 · Uncle Draw menu, welcome screen and branding · v1 · P0
- [ ] Main menu starts with "← Back to boards", "Rename…" and "Share…", followed by the Excalidraw default items we keep ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §6.3).
- [ ] "Open" (load scene from file) is removed from the editor; importing is IO-3.
- [ ] The welcome screen on an empty board shows the Uncle Draw wordmark and copy.
- [ ] The editor's primary color is the Uncle Draw blue in both themes.

### EDIT-5 · Remember my view and style · v1 · P1
- [ ] Reopening a board on the same device restores the last scroll position and zoom.
- [ ] My last-used stroke color, fill, width and font carry over to new boards on the same device.
- [ ] None of this is saved to the board or shown to share viewers.

### EDIT-6 · Mermaid → diagram · v1.1 · P2
- [ ] Main menu → "Mermaid to diagram" opens Excalidraw's Mermaid dialog and inserts the result as sketchy elements.
- [ ] No AI text-to-diagram (see Non-goals).

---

## 4. Saving and data safety (SAVE)

### SAVE-1 · Autosave · v1 · P0
*As a user, I never want to think about saving.*
- [ ] Changes reach Supabase within about 2 s after I stop editing, and at least every 10 s while I keep drawing (tech §7.2).
- [ ] Reloading the page right after "Saved" appears shows exactly what I drew.
- [ ] There is no Save button or Ctrl+S requirement. Ctrl+S forces an immediate save and shows "Saved".
- [ ] Pan, zoom and selection changes alone don't trigger a network save.

### SAVE-2 · Save status · v1 · P0
- [ ] The top-right pill shows `saved`, `saving`, `offline`, `error` or `conflict` as specified in tech §7.3 and visual §9.1.
- [ ] `error` has a working **Retry**.
- [ ] Screen readers announce status changes (`aria-live="polite"`).

### SAVE-3 · Offline backup and recovery · v1 · P0
*As a user on flaky Wi-Fi, I don't want to lose work.*
- [ ] With the network off, I can keep drawing. The pill shows "Offline · saved on this device".
- [ ] When the network returns, pending changes upload automatically and the pill returns to "Saved".
- [ ] If I close the tab while offline and reopen the board later, I'm offered "Restore unsaved changes from {time}?" with Restore and Discard.
- [ ] Without IndexedDB (e.g. private browsing) the editor still works, and I see a one-time notice that offline backup is unavailable.

### SAVE-4 · Conflict detection · v1 · P0
*As a user with the same board open in two tabs, I don't want one tab to silently overwrite the other.*
- [ ] When a save is rejected because the board changed elsewhere, autosave pauses and the conflict dialog appears ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §9.2).
- [ ] "Load the latest" replaces my canvas with the server version.
- [ ] "Keep my version" overwrites the server version with mine, and autosave resumes.
- [ ] Covered by an E2E test with two browser contexts.

### SAVE-5 · Images on boards · v1 · P0
*As a user, I want to paste or drop screenshots onto a board.*
- [ ] Paste, drag-and-drop and the image tool all work. Supported types: PNG, JPEG, WebP, GIF and SVG.
- [ ] Images larger than 2048 px on either side or over 5 MB are downscaled automatically. A file still over 5 MB is rejected with a friendly message.
- [ ] Images survive reload and appear for share-link viewers.
- [ ] While an image is still loading, a placeholder shows in its place (never a broken icon).

### SAVE-6 · Size limits · v1 · P1
- [ ] A board over 5 MB of scene data shows a gentle warning ("This board is getting big. Consider splitting it.").
- [ ] Above 20 MB, cloud saves stop with a clear message, and the local backup keeps working.

---

## 5. Sharing (SHARE)

### SHARE-1 · Create a read-only link · v1 · P0
*As a board owner, I want to send someone a link so they can see my board without signing up.*
- [ ] "Share" (editor top-right, main menu or card `⋯`) opens the share dialog ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §6.5).
- [ ] "Create share link" makes a link of the form `/s/<43-char token>`, and "Copy" copies it to the clipboard.
- [ ] Reopening the dialog shows the same active link (one active link per board).

### SHARE-2 · View a shared board · v1 · P0
*As a viewer, I want to open the link and see the latest version of the board.*
- [ ] `/s/:token` opens in view mode with no sign-in. I can pan, zoom and export PNG/SVG, but I can't edit.
- [ ] I see the board as of my page load. Reloading shows the latest saved version.
- [ ] The banner shows "View only · {title} · Uncle Draw".
- [ ] Revoked, expired or unknown links, and links to trashed boards, all show the same "This link has been erased" page.

### SHARE-3 · Revoke or regenerate · v1 · P0
- [ ] "Stop sharing" revokes the link right away (the next viewer page load fails).
- [ ] "Get a new link" revokes the old link and creates a new one in one step.

### SHARE-4 · Duplicate a shared board · v1.1 · P1
- [ ] Signed-in viewers see "Duplicate to my boards". It copies the scene and images into a new board they own and opens it.
- [ ] Signed-out viewers see "Made with Uncle Draw · Sign up". After sign-up, the duplication goes ahead.

### SHARE-5 · Link expiry · v1.1 · P2
- [ ] When creating a link, the owner can choose Never (default), 7 days or 30 days. The dialog shows the expiry date.

---

## 6. Import and export (IO)

### IO-1 · Export image · v1 · P0
- [ ] Excalidraw's export dialog works: PNG, SVG, copy to clipboard, background on/off, dark export, scale, and embed scene in PNG/SVG.

### IO-2 · Save as `.excalidraw` · v1 · P0
- [ ] Main menu → "Save to file" downloads a `.excalidraw` JSON file that opens on excalidraw.com and in Uncle Draw (IO-3).

### IO-3 · Import as new board · v1.1 · P1
- [ ] Dashboard → "Import" (or dropping a file on the dashboard) accepts `.excalidraw` files and PNG/SVG files with an embedded scene.
- [ ] Each file becomes a new board named after the file, with its images uploaded (SAVE-5).
- [ ] Invalid files show "That file doesn't look like a Uncle Draw or Excalidraw drawing."

---

## 7. Library (LIB)

### LIB-1 · Personal library synced · v1.1 · P1
*As a user, I want my saved shapes available on every board and device.*
- [ ] Items added to the Excalidraw library sidebar are saved to my account and show up in every board on any device.
- [ ] Removing an item removes it everywhere.

### LIB-2 · Install public libraries · v1.1 · P2
- [ ] "Browse libraries" opens libraries.excalidraw.com, and "Add to Excalidraw" there brings the items back into my Uncle Draw library (Excalidraw's `libraryReturnUrl` and `useHandleLibrary`).

---

## 8. Settings (SET)

### SET-1 · Theme · v1 · P1
- [ ] The avatar menu has a Theme option: Light, Dark or System (default).
- [ ] The setting applies to the shell and the editor together, and is remembered on this device.
- [ ] Changing the theme from Excalidraw's own menu toggle updates the app setting too, so the two stay in sync.

---

## 9. v2: Together (COLLAB, HIST, CMT)

Specified at a high level now; it gets detailed acceptance criteria when v2 planning starts. The technical groundwork is in [TECHNICAL_REQUIREMENTS.md](./TECHNICAL_REQUIREMENTS.md) §15.

| ID | Feature | Notes |
|---|---|---|
| COLLAB-1 | **Invite editors by email** | Owner invites people as Editor or Viewer. Invitees get a magic-link email. Membership is listed in the share dialog. |
| COLLAB-2 | **Real-time co-editing** | Several people edit at once and see each other's changes in under 300 ms. Conflicting edits merge per element (Excalidraw's reconcile). Undo affects only my own changes. |
| COLLAB-3 | **Live cursors and presence** | Named, colored cursors on the canvas. Avatars of everyone present in the top-right. Idle and away states. |
| COLLAB-4 | **Follow mode** | Click an avatar to follow that person's viewport. |
| HIST-1 | **Version history** | Snapshots every 10 min while editing. Browse, preview and restore (restoring creates a new version). |
| CMT-1 | **Comments** | Pin a comment thread to a spot or element. Resolve threads. Notify by email. |

---

## 10. Non-goals

Not planned for any milestone above unless this doc is updated:
- Teams, workspaces, folders, billing or paid plans.
- AI features (text-to-diagram, auto-layout, image generation).
- Native mobile or desktop apps (the web app is responsive and installable later as a PWA).
- Guest or anonymous editing without an account.
- Public galleries, search-engine-indexed boards or embedding boards on other sites.
- Presentation or slide mode beyond Excalidraw's built-in frames.

---

## 11. Open questions

| # | Question | Affects | Proposed default |
|---|---|---|---|
| 1 | Production domain? | Share-link URLs, OAuth redirect allow-list, email templates | Decide before v1 launch |
| 2 | Per-user limits on the free tier (number of boards, total storage)? | DASH-2, SAVE-5 | No board limit; 500 MB storage per user; revisit with usage data |
| 3 | Transactional email provider? | AUTH-1 | Resend (custom SMTP in Supabase) |
| 4 | Product analytics? | All | Privacy-friendly page analytics only (e.g. Plausible); no session recording |
| 5 | Error reporting? | All | Sentry for the frontend and Edge Functions, with board content scrubbed |
| 6 | UI languages beyond English? | All copy | English only in v1; Excalidraw's own `langCode` support makes adding more easy later |
| 7 | Should "Keep my version" on conflict (SAVE-4) be offered at all in v1, or only "Load the latest"? | SAVE-4 | Offer both; overwriting is the user's informed choice |

---

## 12. Definition of done for v1

- [ ] Every v1 **P0** feature meets all of its acceptance criteria.
- [ ] The E2E flow in tech §14 passes in CI against local Supabase.
- [ ] RLS tests prove that one user can't read or modify another user's boards, files, shares or storage objects.
- [ ] Performance budgets in tech §10 are met on the reference machine.
- [ ] WCAG 2.2 AA checks pass for the shell: contrast, focus, keyboard, labels ([VISUAL_DESIGN.md](./VISUAL_DESIGN.md) §10).
- [ ] The Excalidraw MIT notice and the font OFL licenses are included (tech §16).
