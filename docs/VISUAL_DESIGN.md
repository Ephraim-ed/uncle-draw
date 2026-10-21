# Uncle Draw — Visual Design

> Status: Draft v0.1 · Last updated: 2026-10-13
> Companion docs: [TECHNICAL_REQUIREMENTS.md](./TECHNICAL_REQUIREMENTS.md) · [FEATURES.md](./FEATURES.md)

This doc defines how Uncle Draw looks and feels. The canvas itself is Excalidraw, and its hand-drawn rendering is the heart of the product. Our job is to make **everything around the canvas** (login, dashboard, dialogs, share page) feel like it belongs to the same sketchbook, without hurting legibility or accessibility.

---

## 1. Design principles

1. **Paper and pencil.** Every surface reads like a sheet of paper and every border looks drawn by hand. No glossy gradients, blurred shadows or perfect pill shapes.
2. **The canvas is the hero.** In the editor, the shell steps back. Branding and chrome stay small and quiet.
3. **One hand.** Shell borders, icons, fonts and colors all come from the same sources as the Excalidraw canvas (Rough.js, Excalifont, Excalidraw's color palette), so moving from the dashboard into a board feels seamless.
4. **Sketchy, never sloppy.** Wobble lives in **borders, underlines and illustrations**, never in body text, alignment or spacing. The layout grid stays strict, so the hand-drawn details read as intentional.
5. **Stable wobble.** A given element always looks the same. Shapes never re-randomize on hover, resize or re-render (see §5.2).

---

## 2. Brand

| Element | Spec |
|---|---|
| **Name** | Uncle Draw: the friendly uncle who always has a pencil on hand and keeps your sketches safe. |
| **Wordmark** | "Uncle Draw" set in **Excalifont**, ink color, with a Rough.js squiggle underline in the primary color (`roughness 1.5`, `bowing 2`, `strokeWidth 2`) |
| **Mark** | A slanted pencil doodle (hexagonal body, cone tip, eraser cap) drawn in Uncle Draw itself. Used for the favicon, app icon and loading state |
| **Favicon** | The pencil mark on a transparent background, exported as SVG plus 32/180/512 px PNGs |
| **Tagline** | "Sketch it out. Uncle Draw keeps it safe." |

### Voice and copy
- **Warm, short and plain.** Talk like a friendly, helpful uncle, not a system.
- No jargon in the UI: say "This board was changed in another tab", not "Version conflict (409)".
- A little playful in empty and error states, never in destructive confirmations.

| Situation | ✅ Say | ❌ Don't say |
|---|---|---|
| Magic link sent | "Check your inbox. We sent a sign-in link to **ana@example.com**." | "OTP dispatched." |
| Offline | "You're offline. Your changes are saved on this device." | "Network error." |
| Save failed | "Hmm, that didn't save. We kept a copy here. **Try again**" | "Error 500" |
| Empty dashboard | "No boards yet. Every great idea starts as a messy sketch." | "No data." |
| Delete board | "Move "Sprint map" to trash? You can restore it for 30 days." | "Are you sure?" |

---

## 3. Color

### 3.1 Source
All accent colors come from **Excalidraw's default color picker palette** (which is based on Open Color). The brand blue is the same blue a user can pick for a stroke, which keeps the shell and canvas visually related.

### 3.2 Tokens
Define these as CSS custom properties in `src/styles/tokens.css`. Set the light values on `:root` and the dark values on `:root[data-theme="dark"]`. Tailwind reads these variables; **never hard-code hex values in components**.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ud-paper` | `#FDFBF6` | `#121212` | Page background (dark matches Excalidraw's dark canvas) |
| `--ud-surface` | `#FFFFFF` | `#1E1E22` | Cards, dialogs, inputs |
| `--ud-surface-sunken` | `#F4F1EA` | `#0C0C0E` | Thumbnail wells, code blocks |
| `--ud-ink` | `#1E1E1E` | `#E8E6E3` | Primary text and sketch strokes (`#1E1E1E` is Excalidraw's default stroke) |
| `--ud-ink-muted` | `#5C5C66` | `#A3A1A8` | Secondary text, metadata |
| `--ud-ink-faint` | `#A6A6AE` | `#55545A` | Disabled, placeholder strokes. **Not for text** |
| `--ud-dot` | `#DDD8CC` | `#2A2A2E` | Dot-grid background |
| `--ud-primary` | `#1971C2` | `#4DABF7` | Primary buttons, links, focus, wordmark squiggle |
| `--ud-primary-hover` | `#1864AB` | `#74C0FC` | Hover and pressed |
| `--ud-on-primary` | `#FFFFFF` | `#121212` | Text and icons on primary fills |
| `--ud-primary-soft` | `#E7F5FF` | `#1C3A57` | Selected states, subtle highlights |
| `--ud-highlight` | `#FFEC99` | `#FFEC99` | Highlighter marks, sticky-note toasts (same in both themes, like a real note) |
| `--ud-danger` | `#E03131` | `#FF6B6B` | Destructive actions, errors |
| `--ud-danger-soft` | `#FFC9C9` | `#4A1E1E` | Error backgrounds |
| `--ud-success` | `#2F9E44` | `#51CF66` | Success **icons** only (see contrast note) |
| `--ud-success-soft` | `#B2F2BB` | `#1E3A24` | Success backgrounds |
| `--ud-warning` | `#F08C00` | `#FFA94D` | Offline and warning icons |
| `--ud-shadow` | `#1E1E1E` | `#000000` | Offset "paper cut" shadows |
| `--ud-scrim` | `rgb(30 30 30 / 0.35)` | `rgb(0 0 0 / 0.6)` | Behind dialogs |

**Contrast notes** (WCAG 2.2 AA, 4.5:1 for normal text):
- `--ud-ink-muted` on `--ud-paper`: about 6.4:1 ✅ (dark theme: 7.3:1 ✅)
- White on `--ud-primary` (`#1971C2`): about 5.0:1 ✅ (dark theme, `#121212` on `#4DABF7`: 7.6:1 ✅)
- `--ud-primary` as link text on `--ud-paper`: about 4.9:1 ✅
- White on `--ud-danger` (`#E03131`): about 4.5:1 ✅, the minimum. Use it for buttons with 16 px semibold labels only.
- White on `--ud-success` (`#2F9E44`): about 3.4:1 ❌. **Never put text on a success fill.** Use ink text on `--ud-success-soft` instead.

### 3.3 Theming the Excalidraw editor
Excalidraw defines its UI colors as CSS variables on `.excalidraw` (light) and `.excalidraw.theme--dark` (dark). We override **only the primary family**, so selected tools, primary buttons and toggles use the Uncle Draw blue. Load this after `@excalidraw/excalidraw/index.css`; the `.ud-editor` wrapper raises specificity:

```css
/* src/styles/excalidraw-overrides.css */
.ud-editor .excalidraw {
  --color-primary: #1971c2;
  --color-primary-darker: #1864ab;
  --color-primary-darkest: #145591;
  --color-primary-hover: #1864ab;
  --color-primary-light: #e7f5ff;
  --color-primary-light-darker: #d0ebff;
}
.ud-editor .excalidraw.theme--dark {
  --color-primary: #4dabf7;
  --color-primary-darker: #74c0fc;   /* "darker" means more emphasis, i.e. lighter on dark */
  --color-primary-darkest: #a5d8ff;
  --color-primary-hover: #74c0fc;
  --color-primary-light: #1c3a57;
  --color-primary-light-darker: #24496d;
}
```

Rules:
- **Don't restyle Excalidraw's internal class names.** They change between releases. Only override variables and use the props and slots the package provides. The one exception is the toolbar slot for our Table and Flowchart templates tools (EDIT-7, EDIT-8). It's placed after the eraser (found by test id) and reuses Excalidraw's tool-button markup so the buttons match. An e2e test guards it, and the footer takes over if it breaks.
- Pass the app theme to Excalidraw through the `theme` prop. Excalidraw's dark mode inverts the canvas colors with a CSS filter, so a user's `#1E1E1E` strokes show as light lines.
- **Thumbnails are always exported in light mode.** In the dark dashboard they appear as light "paper sheets" sitting on the dark desk (see §6.2).

---

## 4. Typography

| Role | Font | Size / line height | Weight | Use |
|---|---|---|---|---|
| Display | Excalifont | 40 / 48 | 400 | Login wordmark, 404 headline |
| Heading 1 | Excalifont | 28 / 36 | 400 | Page titles ("Your boards") |
| Heading 2 | Excalifont | 20 / 28 | 400 | Dialog titles, section headings, the "New board" CTA |
| Body | Assistant | 16 / 24 | 400 | Paragraphs, inputs, menu items |
| Label | Assistant | 14 / 20 | 600 | Buttons, tabs, form labels |
| Small | Assistant | 14 / 20 | 400 | Card metadata, helper text |
| Mono | Cascadia Code → `ui-monospace` | 13 / 20 | 400 | Keyboard shortcuts (`<kbd>`), share URLs |

- **Why Assistant:** it is Excalidraw's own UI font (`--ui-font`), so shell menus look exactly like the editor's toolbars and menus.
- **Why Excalifont:** it is the default handwritten font on the canvas.
- **The 18 px rule:** use Excalifont only at **18 px and above** and only for **short text** (no more than one line or about 40 characters). Below that, or for anything the user has to read carefully, use Assistant.
- **Self-hosted, `font-display: swap`:**
  - Assistant: `@fontsource-variable/assistant`.
  - Excalifont: copy the Latin subset into `src/assets/fonts/excalifont-latin.woff2` (OFL). The shell can't depend on the fonts Excalidraw loads lazily, because the dashboard renders before the editor chunk exists.
  - Preload Excalifont on `/login` and `/boards`.

---

## 5. Sketchy shell components

### 5.1 How they're drawn
Shell components are ordinary HTML elements (real `<button>`, `<input>`, `<dialog>`) with an **absolutely positioned SVG overlay** that Rough.js draws into. The overlay is decoration only:
- `aria-hidden="true"` and `pointer-events: none`.
- It sits behind the content with `inset: -2px` and `overflow: visible`, so wobbly lines aren't clipped.
- The stroke is `currentColor` (set through CSS `color`), so tokens and themes work. SVG presentation attributes can't read `var()`.

Base Rough.js options for the shell:

| Option | Value | Note |
|---|---|---|
| `roughness` | `1` | Same as Excalidraw's "Artist" setting |
| `bowing` | `1` | |
| `strokeWidth` | `1.5` (2 for primary buttons) | |
| `fillStyle` | `"solid"` for buttons, `"hachure"` for decorative fills | |
| `hachureGap` | `6` | |
| `seed` | stable, see §5.2 | |

### 5.2 Stable wobble
- **Every sketch shape gets a deterministic `seed`.** Compute it from a stable key, such as `hash(boardId)` for cards or an explicit `seed` prop for static UI. **Never call `Math.random()` while rendering.**
- Redraw only when the element's size changes, watched with `ResizeObserver` and rounded to whole pixels. Memoize the generated paths by `(width, height, seed, options)`.
- Board cards seeded by board id each get their own unique wobble, which makes the grid feel hand-made.

### 5.3 Component specs

| Component | Rest | Hover | Pressed | Focus-visible | Disabled |
|---|---|---|---|---|---|
| **Primary button** | Rough rectangle filled `--ud-primary`, `--ud-on-primary` text, offset shadow 3 px | Fill `--ud-primary-hover`, shadow offset 4 px, `translate(-1px,-1px)` | Shadow 0, `translate(2px,2px)` | Sketch outline in `--ud-primary` 4 px outside **plus** a real `outline: 2px solid` (see §10) | Stroke and text `--ud-ink-faint`, no shadow |
| **Secondary button** | Rough rectangle, `--ud-surface` fill, ink stroke, offset shadow 3 px | Fill `--ud-primary-soft` | as primary | as primary | as primary |
| **Ghost / icon button** | No border; 40×40 px hit area | Rough circle in `--ud-primary-soft` | Darker fill | as primary | Faint icon |
| **Text input** | Sketchy **underline only** (single rough line), placeholder `--ud-ink-muted` | Underline thicker (2 px) | n/a | Underline `--ud-primary` + real outline | Faint underline |
| **Card** | Rough rectangle, `--ud-surface` fill, offset shadow 3 px | Shadow 5 px, lift `translate(-2px,-2px)` | Shadow 1 px | as primary | n/a |
| **Dialog** | Rough rectangle, `--ud-surface`, offset shadow 6 px, `--ud-scrim` behind | n/a | n/a | Focus is trapped inside | n/a |
| **Menu / popover** | Rough rectangle, `--ud-surface`, offset shadow 3 px; items are plain rows | Item row: hachure highlight in `--ud-highlight` (light) / `--ud-primary-soft` (dark) | n/a | Same as hover + outline | Faint text |
| **Tabs** | Labels in Assistant 600; active tab gets a rough underline in `--ud-primary` | Muted underline | n/a | Outline | n/a |
| **Toast** | Sticky note: `--ud-highlight` fill, **ink** text (in both themes), `rotate(-1deg)`, offset shadow 2 px, no border | n/a | n/a | n/a | n/a |
| **Avatar** | GitHub avatar in a rough circle; fallback is the initial letter in Excalifont | n/a | n/a | n/a | n/a |

**"Paper cut" shadow:** a second Rough.js shape with the same seed, offset by N px, solid `--ud-shadow` fill, drawn behind the main shape. **No blurred `box-shadow` anywhere in the shell.**

**Icons:** Tabler Icons (`@tabler/icons-react`), `stroke={1.75}`, 20 px in buttons and 16 px inline. Excalidraw's toolbar uses the same icon family, so they look alike.

**Backgrounds:**
- `/boards`, `/login` and 404 use a **dot grid**: `radial-gradient(var(--ud-dot) 1px, transparent 1px)` at `20px 20px`. The spacing matches Excalidraw's default grid size of 20.
- The editor and the share view show only the Excalidraw canvas, whose background the user controls.

---

## 6. Screens

The wireframes below show layout only. Every border in the real UI is a Rough.js sketch.

### 6.1 Login (`/login`)

```
┌──────────────────────────────────────────────────────────────┐
│ · · · · · · · · · · · · · dot grid · · · · · · · · · · · · · │
│                                                              │
│                        ✏  Uncle Draw                         │
│                           ~~~~~~~~~~   ← squiggle underline  │
│           Sketch it out. Uncle Draw keeps it safe.           │
│                                                              │
│           ┌───────────────────────────────────────┐          │
│           │  Email                                │          │
│           │  you@example.com                      │          │
│           │  ─────────────────────────────────    │ ← sketch │
│           │  [   Send me a magic link   ]         │   card   │
│           │                                       │          │
│           │  ───────────── or ─────────────       │          │
│           │                                       │          │
│           │  [  ⌥ Continue with GitHub  ]         │          │
│           └───────────────────────────────────────┘          │
│                                                              │
│            (doodle: stick figure handing over a pencil)       │
└──────────────────────────────────────────────────────────────┘
```

- The card is at most 400 px wide and centered.
- Primary button: "Send me a magic link". Secondary button: "Continue with GitHub".
- After the link is sent, the card switches to the "Check your inbox" state with an envelope doodle and a "Use a different email" link.

### 6.2 Dashboard (`/boards`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ✏ Uncle Draw       [ ⌕ Search boards…            ]   [ + New board ] (A)│
├──────────────────────────────────────────────────────────────────────┤
│ Your boards                                      Sort: Last edited ▾ │
│                                                                      │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   │
│  │ ░thumbnail░│   │ ░thumbnail░│   │ ░thumbnail░│   │ ░thumbnail░│   │
│  │ ░  16:10  ░│   │ ░         ░│   │ ░         ░│   │ ░         ░│   │
│  ├────────────┤   ├────────────┤   ├────────────┤   ├────────────┤   │
│  │ Sprint map │   │ Wireframes │   │ Untitled b…│   │ DB schema  │   │
│  │ 2h ago   ⋯ │   │ Yesterday ⋯│   │ 3 days ago⋯│   │ Sep 2     ⋯│   │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘   │
│                                                                      │
│                                                         Trash (3) →  │
└──────────────────────────────────────────────────────────────────────┘
```

Search, sort and the Trash link arrive in v1.1 (DASH-6, DASH-8). In v1 the header has just the wordmark, "New board" and the avatar.

- **Header:** wordmark (links to `/boards`), search field, "New board" (primary button, Excalifont 20 px label) and the avatar menu (Theme, Sign out).
- **Card:**
  - Thumbnail well uses `--ud-surface-sunken`, 16:10, `object-fit: contain`. In dark mode it stays a **light paper sheet** (`#FFFFFF` well) because thumbnails are exported light.
  - Title: Assistant 16/600, one line, ellipsis.
  - Metadata: "Edited 2h ago" in Small, muted.
  - The `⋯` menu holds Rename, Duplicate, Share, Move to trash.
  - The whole card is a link to `/b/:boardId`. The `⋯` button is a separate focus stop.
- **Loading:** six skeleton cards whose rough borders "boil" (§8), with empty thumbnail wells.
- **Empty state:**

```
                 No boards yet.
      Every great idea starts as a messy sketch.

                                   ↗ (hand-drawn arrow pointing at "New board")
            [  + Draw your first board  ]
```

### 6.3 Editor (`/b/:boardId`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ (☰)      [ 🔒 ✋ ▭ ◇ ○ → ─ ✎ A 🖼 ⌫ ▦ ⑂ … ]        Sprint map  ✓ Saved [Share] (A) │
│  ↑ Excalidraw main menu  ↑ Excalidraw toolbar        ↑ renderTopRightUI           │
│                                                                      │
│                                                                      │
│                       full-bleed Excalidraw canvas                    │
│                                                                      │
│                                                                      │
│ (−  100%  +) (↶ ↷)                                                (?) │
└──────────────────────────────────────────────────────────────────────┘
```

- The editor fills the viewport (`100dvh`), with no app header. All chrome comes from Excalidraw plus our slot content.
- **`renderTopRightUI`** content, left to right:
  1. **Board title:** Assistant 14/600, click to rename inline. Hidden below 1024 px; renaming is then in the main menu.
  2. **Save-status pill** (§9.1).
  3. **Share** button: secondary, small.
  4. **Avatar** menu.
- **Main menu (`<MainMenu>`)**:
  - Uncle Draw items first: "← Back to boards", "Rename…", "Share…", separator.
  - Then "Insert table…" (EDIT-7), "Flowchart templates…" (EDIT-8) and the Excalidraw defaults we keep: Export image, Save to file (`.excalidraw`), Find on canvas, Help, Theme toggle, Canvas background, Reset canvas.
  - Remove "Open" (`loadScene`). Importing happens from the dashboard.
- **Toolbar tools** (after Excalidraw's eraser, in its own tool-button markup):
  - **Table** (▦, shortcut **B**) is a tool: it highlights like the others, and a drag on the canvas shows a dashed primary-blue grid preview with a "3 rows × 2 columns" chip.
  - **Flowchart templates** (⑂) opens the picker. It's hidden on phones, where the main menu has it.
- **Footer (`<Footer>`)**: only if the toolbar slot can't be found, secondary small **Table** and **Templates** buttons appear next to undo/redo.
- **Table bar**: a sketch-framed bar (surface fill, paper-cut shadow) floats 12 px above a selected table, or below it when there's no room, clear of the toolbar and footer.
  - Ghost icon buttons (34 px, Tabler 18 px) in groups: rows, columns, header/checkbox toggles (pressed = primary), alignment, then style and delete.
  - The style panel opens under it, with color chips (Excalidraw's quick picks, a dashed "Canvas color" chip, a rainbow custom picker), border widths, and px fields for the active column and row.
  - The active cell gets a dashed primary outline. Clicking the bar never takes keyboard focus from the canvas.
- **Grid-line drags** show a 2 px primary guide with a "240 px" chip. The cursor is `col-resize` or `row-resize` over a line and `pointer` over a checkbox.
- **Tables** keep the canvas style. Defaults: 1 px borders in black, body cells filled with the canvas color, a light gray (`#e9ecef`) header row, centered text, 22 px checkboxes with rounded corners, and a tick that overshoots the box like a quick pen mark.
- **Flowchart templates dialog** (760 px): a grid of sketch-framed cards. Each has a live preview drawn by Excalidraw on the light thumbnail well (light in both themes, like board thumbnails), a name and a one-line description.
- **Welcome screen (`<WelcomeScreen>`)** on an empty board:
  - Center: the Uncle Draw wordmark (in place of Excalidraw's logo) and "Start sketching. Uncle Draw saves as you go."
  - Center menu: "Back to boards" and "Help".
  - Keep Excalidraw's hand-drawn hint arrows for the toolbar, menu and help.

### 6.4 Share view (`/s/:token`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ (☰)      ┌─────────────────────────────────────────┐   [Duplicate to my boards] │
│          │ 👁 View only · Sprint map · Uncle Draw  │      (signed-in only)       │
│          └─────────────────────────────────────────┘                            │
│                                                                      │
│                  read-only canvas (pan / zoom / export)               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

- Excalidraw runs with `viewModeEnabled`. A floating sticky-note banner sits at the top center (`--ud-highlight`, `rotate(-0.5deg)`).
- Signed-out viewers see "Made with Uncle Draw · Sign up" in place of the Duplicate button. The Duplicate button itself is v1.1 (SHARE-4); in v1 everyone sees the "Made with Uncle Draw" link.
- **Revoked, expired or unknown link:** a full-page dot-grid view with a torn-paper doodle, "This link has been erased.", and a button to `/`.

### 6.5 Share dialog

```
┌─ Share "Sprint map" ──────────────────────────────── ✕ ┐
│                                                        │
│  Anyone with this link can view the board.             │
│  They can't edit it.                                   │
│                                                        │
│  ┌──────────────────────────────────────────┐ [ Copy ] │
│  │ https://<your-domain>/s/Xk3pQ…            │         │
│  └──────────────────────────────────────────┘          │
│  Created Oct 13 · Never expires                        │
│                                                        │
│  [ Get a new link ]                 [ Stop sharing ]   │
│                                       ↑ danger text btn │
└────────────────────────────────────────────────────────┘
```

- Before a link exists, the dialog shows a single primary "Create share link" button.
- After "Copy", a sticky-note toast says "Link copied!".

### 6.6 404 and generic error

- Dot grid, a doodle of an eraser rubbing out a page, the headline "This page got erased." (Display), and a primary button "Back to your boards".
- The generic error boundary uses the same layout with "Something smudged." and buttons "Reload" and "Back to boards".

---

## 7. Canvas defaults that keep the hand-drawn feel

New boards start with these `appState` values (passed through `initialData`). Each user's last-used style, kept in IndexedDB, overrides them:

| Setting | Excalidraw 0.18.1 default | Uncle Draw default | Why |
|---|---|---|---|
| `currentItemRoughness` | `1` (Artist) | `1` (Artist) | Keep the sketchy look |
| `currentItemFontFamily` | `5` (Excalifont) | `5` (Excalifont) | Handwritten text |
| `currentItemFillStyle` | `"solid"` | **`"hachure"`** | Fills look like pencil shading, not flat color |
| `currentItemStrokeWidth` | `2` | `2` | |
| `currentItemStrokeColor` | `#1e1e1e` | `#1e1e1e` | |
| `currentItemBackgroundColor` | `transparent` | `transparent` | Hachure only shows once a fill color is picked |
| `viewBackgroundColor` | `#ffffff` | `#ffffff` | Stays white; the shell's warm paper color is **not** applied to the canvas, so exports are clean |

**Don't** change Excalidraw's color picker palette. The brand colors already come from it.

---

## 8. Motion

| Motion | Where | Spec |
|---|---|---|
| **Line "boil"** | Loading skeletons, splash pencil, "Saving…" scribble | Cycle a shape through 3 fixed seeds every 125 ms (about 8 fps, like hand-drawn animation). Loading states only |
| **Press** | Buttons, cards | `transform` + shadow offset, 80 ms `ease-out` |
| **Lift** | Card hover | 120 ms `ease-out` |
| **Dialog in/out** | Dialogs | Fade + scale 0.98 → 1, 140 ms; out 100 ms |
| **Toast** | Sticky notes | Drop in from 8 px above with a slight rotation settle (−3° → −1°), 180 ms; auto-dismiss after 3 s |
| **Status pill** | Save status | Cross-fade 150 ms; "Saved" text collapses to just the check icon after 2 s |

**Reduced motion:** with `prefers-reduced-motion: reduce`, drop boil, lift, rotation and scale. Keep only opacity fades (100 ms or less). Boil shapes freeze on their first seed.

---

## 9. State visuals

### 9.1 Save status
States match `TECHNICAL_REQUIREMENTS.md` §7.3:

| State | Icon (Tabler) | Label | Look |
|---|---|---|---|
| `saved` | `IconCloudCheck` in `--ud-success`, pops in after each save | "Saved"; tooltip "Saved at 3:42 PM" | Quiet: no box, `--ud-ink-muted` 13/600 |
| `saving` | `IconCloudUpload`, gently lifting | "Saving…" | Quiet: no box, `--ud-ink-muted` 13/600 |
| `offline` | `IconCloudOff` in `--ud-warning` | "Offline · saved on this device" | Rough pill on `--ud-surface`, ink text |
| `error` | `IconAlertTriangle` | "Couldn't save · **Retry**" | Rough pill, `--ud-danger` |

- **Saving and saved are a status, not a button.** They show an icon and a muted label with no outline.
- **Both labels share one grid cell,** so their slot is always as wide as the longer one. Autosave runs every few seconds, and a slot that resized would push the board title back and forth on every save.
- **Offline and errors need attention,** so they get the rough rounded pill (36 px tall, like Excalidraw's toolbar buttons) with the full message.
- **On phones,** Excalidraw places the top-right slot in its toolbar row, which has no room. The status is then an icon-only 36 px pill under the toolbar at the top-left. Share and "Back to boards" are in the main menu.
- **Announcements:** every state is announced through `aria-live="polite"`.
- **Reduced motion:** the pop and lift animations stop.

### 9.2 Dialogs for important states
- **Conflict:** "This board was changed somewhere else." Buttons: "Load the latest" (primary) and "Keep my version" (secondary). One line explains what each does.
- **Local recovery:** "We found unsaved changes from 3:42 PM." Buttons: "Restore them" (primary) and "Discard" (secondary).

### 9.3 Illustrations
- Every illustration is **drawn in Uncle Draw itself**, exported as SVG and kept in `src/assets/illustrations/`.
- Stroke `#1E1E1E`, replaced with `currentColor` at export so it adapts to dark mode.
- At most two accent colors from the palette. Transparent background.
- Labels in Excalifont, roughness 1.

| Illustration | Used on |
|---|---|
| Stick figure handing over a pencil | Login |
| Envelope with motion lines | "Check your inbox" |
| Hand-drawn arrow plus a blank sheet | Empty dashboard |
| Empty bin with a fly | Empty trash |
| Eraser rubbing out a page | 404 |
| Torn paper | Revoked or expired share link |
| Cloud with a slash | Offline banner (small) |
| Pencil mark | Favicon, splash, loading |

---

## 10. Accessibility

- **Contrast:** all shell text meets WCAG 2.2 AA (§3.2). Sketch borders on interactive controls meet 3:1 against their background (`--ud-ink` on `--ud-paper` does easily).
- **Focus:** wobbly lines alone aren't a reliable focus indicator, so focus-visible always shows a **real** `outline: 2px solid var(--ud-primary); outline-offset: 3px` **plus** the sketch accent.
- **Keyboard:**
  - Dashboard: Tab order is header, then cards in reading order. Enter opens a card. Shift+F10 or the `⋯` button opens the card menu.
  - Menus and dialogs follow WAI-ARIA patterns: arrow keys inside menus, Esc closes, focus returns to the trigger.
- **Labels:** icon buttons have an `aria-label` (e.g. "Board options for Sprint map"). Rough.js SVG overlays are `aria-hidden`.
- **Target size:** at least 24×24 px (WCAG 2.5.8). We use 40×40 px for icon buttons and 44 px for touch layouts.
- **Fonts:** Excalifont never appears below 18 px or in running text (§4).
- **Motion:** respect `prefers-reduced-motion` (§8).
- **Known limit:** board *content* on the canvas isn't accessible to screen readers. This is an Excalidraw limitation. The share page sets `<title>` to the board title and lists "Download PNG/SVG" as text actions.

---

## 11. Responsive behavior

| Breakpoint | Width | Dashboard | Editor |
|---|---|---|---|
| Phone | < 640 px | 1 card column. Search collapses to an icon. "New board" becomes a floating action button (rough circle, bottom right) | Excalidraw mobile UI. Board title is only in the main menu. Status pill shows the icon only |
| Tablet | 640–1023 px | 2–3 columns (`minmax(220px, 1fr)`) | Excalidraw desktop UI. Title hidden; status pill shows the full label |
| Desktop | ≥ 1024 px | Auto-fill `minmax(240px, 1fr)`, max content width 1280 px | Full layout as in §6.3 |

- Side gutters: 16 px on phones, 24 px on tablets, 32 px on desktop.
- No horizontal page scroll at any width.

---

## 12. Asset checklist

- [ ] Wordmark (SVG, light and dark via `currentColor`)
- [ ] Pencil mark plus favicon set (SVG, 32, 180 and 512 px PNG)
- [ ] Illustrations listed in §9.3
- [ ] `tokens.css` with all tokens in §3.2
- [ ] `excalidraw-overrides.css` (§3.3)
- [ ] Self-hosted fonts: Excalifont Latin subset and Assistant variable (§4)
- [ ] Sketch component kit: SketchBox, SketchButton, SketchInput, SketchDialog, SketchMenu, StickyToast
- [ ] A component preview page (dev-only route `/_kit`) showing every component in every state and both themes
