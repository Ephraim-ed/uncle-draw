# Claude Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server, added in claude.ai as a connector, that lets any signed-in
Uncle Draw user ask Claude to create boards, draw flowchart-style charts, add tables and notes,
tidy a board into topic frames, and put it back. Changes appear live in open editors.

**Architecture:**
- **Pure scene operations** in `src/features/connector/` turn specs into Excalidraw elements.
  They reuse `buildTemplate`, the table grid and Excalidraw's own functions, and are tested
  with the app's vitest setup.
- **A Node layer** in `server/mcp/` handles OAuth bearer checks, Supabase calls made as the
  user, MCP tools and the Realtime broadcast. A Vite SSR build bundles it, with a tiny DOM
  stand-in, into one file.
- **Vercel** serves that bundle from `api/mcp.js`.
- **Sign-in** uses Supabase Auth's OAuth 2.1 server, with a consent page in the app.

**Tech Stack:** TypeScript, Excalidraw 0.18.1, Supabase (Postgres RLS, Auth OAuth server,
Realtime), `@modelcontextprotocol/sdk`, `@dagrejs/dagre`, Vite 8 SSR build, Vercel functions,
vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-28-claude-connector-design.md`

## Global Constraints

- Pin exact dependency versions, at least two weeks old: `@modelcontextprotocol/sdk@1.32.1`,
  `@dagrejs/dagre@3.1.1`. No jsdom at runtime (the stand-in in Task 1 replaces it).
- Node ≥ 24. `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:bundle` stay green.
- Don't fork or patch Excalidraw.
- The server calls Supabase **only with the user's bearer token**. No service-role key in
  runtime code under `server/` (integration tests may use it to create test users).
- Every element Claude creates or rewrites gets `customData.udMeasure = true`. The editor clears
  it after re-measuring.
- Broadcast session ids start with `claude-`.
- Tool results stay under 100,000 characters (claude.ai's limit is about 150k).
- Notes keep the user's words; chart labels and table cells are never reworded (tool
  descriptions say so).
- `apply_tidy`, `delete_elements` and `restore_board` are annotated `destructiveHint: true`.
  `apply_tidy`'s description says to show the topics in chat and wait for the user's OK first.
- Never run `supabase config push` with the repo's `config.toml` against prod. Ask the user
  before any production change: migrations, dashboard settings, env vars, deploys.
- Code style: match the codebase. Short doc comments, feature ids in comments (`(AI-3)`),
  exact `package.json` versions.

## Review Focus

1. **The user edits the board while Claude writes.** Both edits survive; the server retries
   on a version conflict instead of overwriting. *Test in Task 8.*
2. **A bad tidy plan.** It names unknown units, puts one unit in two topics, replaces text that
   isn't loose text, or assigns a locked unit. The whole plan is rejected with a readable error
   and nothing changes. *Test in Task 5.*
3. **Huge or messy boards.** Thousands of elements or very long text: `read_board` stays under
   the cap and says it truncated. *Test in Task 4.*
4. **Grouped, framed, locked or image elements during tidy.** Groups move as one unit. Locked
   units stay where they are, and the new frames avoid them. Existing frames are treated as
   units. *Test in Task 5.*
5. **A board the user can't reach** (another user's, trashed, or a bad id), and expired or
   invalid tokens. The user gets "not found" without learning whether the board exists; a bad
   token gets a 401 with `WWW-Authenticate`. *Test in Tasks 8 and 9.*

---

## File map

| Path | Responsibility |
|------|----------------|
| `src/features/connector/marks.ts` | `MEASURE_KEY`, `CONNECTOR_SESSION_PREFIX`, `markForMeasure` |
| `src/features/connector/remeasure.ts` | Editor-side re-measure of tagged elements |
| `src/features/connector/types.ts` | `ChartSpec`, `ConnectorError`, `LIMITS` |
| `src/features/connector/layout.ts` | `chartTemplate` (auto layout → `Template`) |
| `src/features/connector/blocks.ts` | `notesTemplate`, `tableTemplate` |
| `src/features/connector/place.ts` | `freeSpot`, `addTemplate` (free space, areas, frames) |
| `src/features/connector/units.ts` | `describeUnits`, `outline` |
| `src/features/connector/tidy.ts` | `applyTidy` |
| `src/features/connector/history.ts` | `deleteUnits`, `restoreSnapshot` |
| `src/features/editor/templates/templates.ts` | Node size override (`w`, `h`) |
| `src/features/editor/EditorSession.ts`, `collab/CollabSession.ts` | Call `remeasure`; Claude toast |
| `src/features/auth/OAuthConsentPage.tsx`, `src/app/router.tsx` | `/oauth/consent` |
| `supabase/migrations/20261028000000_board_snapshots.sql` | Snapshots table + RLS + trim |
| `supabase/tests/database/snapshots.test.sql` | pgTAP |
| `supabase/config.toml` | Local OAuth server on |
| `server/mcp/dom.ts` | Minimal browser stand-in for Excalidraw in Node |
| `server/mcp/env.ts` | Server config from `process.env` |
| `server/mcp/auth.ts` | Bearer checks, 401s, protected-resource metadata |
| `server/mcp/boardStore.ts` | `BoardStore` interface + Supabase implementation (+ broadcast) |
| `server/mcp/tools.ts` | MCP tool registration over a `BoardStore` |
| `server/mcp/handler.ts` | `handle(request): Promise<Response>` |
| `api/mcp.js` | Vercel entry, loads `server-dist/mcp.mjs` |
| `vite.mcp.config.ts`, `vitest.server.config.ts`, `tsconfig.server.json` | Build, tests, types |

---

### Task 1: Server bundle and DOM stand-in

**Files:**
- Create: `server/mcp/dom.ts`, `server/mcp/selftest.ts`, `server/mcp/handler.ts` (stub
  re-exporting `selftest`; Task 10 fills it in), `vite.mcp.config.ts`,
  `vitest.server.config.ts`, `tsconfig.server.json`, `scripts/check-mcp-bundle.mjs`
- Modify: `package.json` (scripts), `tsconfig.json` (references), `.gitignore`
  (`server-dist/`, `.superpowers/`)

**Interfaces:**
- Produces:
  - Importing `server/mcp/dom.ts` first makes `@excalidraw/excalidraw` usable in Node.
  - `npm run build:mcp` writes `server-dist/mcp.mjs`.
  - `npm run test:server` runs `server/**/*.test.ts` in a node environment, with `dom.ts` as
    the setup file.

- [ ] **Step 1:** Write `server/mcp/dom.ts`, porting the spike's stand-in (it was proven on
  2026-10-28):
  - `window = globalThis`
  - a `document` whose `createElement("canvas")` returns a 2D context with
    `measureText(t) = t.length × fontPx × 0.6`, erring wide on purpose
  - `document.fonts`, `FontFace`, `matchMedia`, `devicePixelRatio`, `navigator`, `location`,
    `requestAnimationFrame`, and empty `HTMLElement`/`Element`/`Node` classes

  Guard every assignment with `??=` so it never overrides real globals.
- [ ] **Step 2:** Write `server/mcp/selftest.ts` exporting `selftest(): number`. It runs
  `buildTemplate` on every entry of `TEMPLATES` and returns the total element count.
- [ ] **Step 3:** Write `vite.mcp.config.ts`:
  - `build.ssr: "server/mcp/handler.ts"`
  - `ssr.noExternal: true`, `target: "node24"`, `outDir: "server-dist"`
  - `entryFileNames: "mcp.mjs"`, a single file (`inlineDynamicImports: true`)
  - `define` copied from `vite.config.ts` (`process.env.IS_PREACT`)

  Add the script `"build:mcp": "vite build --config vite.mcp.config.ts"`. Change `build` to
  `npm run typecheck && vite build && npm run build:mcp`.
- [ ] **Step 4:** Write `scripts/check-mcp-bundle.mjs`. It imports `server-dist/mcp.mjs`,
  calls `selftest()`, and exits 1 unless the count is > 200. Add the script
  `"check:mcp": "node scripts/check-mcp-bundle.mjs"`.
- [ ] **Step 5:** Write `vitest.server.config.ts`:
  - `environment: "node"`, `include: ["server/**/*.test.ts"]`
  - `setupFiles: ["./server/mcp/dom.ts"]`
  - `server.deps.inline: ["@excalidraw/excalidraw"]`

  Add `tsconfig.server.json` (include `server`, `api`; types `node`; lib `es2023`, `dom`)
  and reference it from `tsconfig.json`. Add the script
  `"test:server": "vitest run --config vitest.server.config.ts"`.
- [ ] **Step 6:** Run `npm run build:mcp && npm run check:mcp`.
  Expected: exits 0 and prints the element count.
- [ ] **Step 7:** Run `npm run check:bundle`.
  Expected: PASS, with no client chunk size change.
- [ ] **Step 8:** Commit: `Add Node bundle for the Claude connector`.

---

### Task 2: Chart auto layout

**Files:**
- Create: `src/features/connector/types.ts`, `src/features/connector/marks.ts`,
  `src/features/connector/layout.ts`, `src/features/connector/layout.test.ts`
- Modify: `src/features/editor/templates/templates.ts`: `Node` gains optional `w?: number;
  h?: number`, used by `sizeOf` when set. Export `Template`'s `Node`, `Link` and `Side` types.
- Modify: `package.json`: add `"@dagrejs/dagre": "3.1.1"`.

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type ChartKind = "flowchart" | "swimlanes" | "mindmap" | "orgchart" | "timeline" | "kanban";
  export type NodeRole = "step" | "decision" | "terminal" | "note";
  export interface ChartSpec {
    kind: ChartKind;
    direction?: "down" | "right";          // flowchart; default "down"
    title?: string;
    lanes?: string[];                      // swimlane rows, kanban columns, in order
    nodes: { id: string; label: string; role?: NodeRole; lane?: string }[];
    links: { from: string; to: string; label?: string; arrow?: boolean }[];
  }
  export class ConnectorError extends Error {}   // message is shown to Claude verbatim
  export const LIMITS = { nodes: 200, links: 400, label: 200, lanes: 20, rows: 100, cols: 26, items: 100 };
  ```
- Produces (`marks.ts`): `MEASURE_KEY = "udMeasure"`, `CONNECTOR_SESSION_PREFIX = "claude-"`,
  `markForMeasure(els: ExcalidrawElement[]): ExcalidrawElement[]` (sets the flag on text
  elements and their containers).
- Produces (`layout.ts`): `chartTemplate(spec: ChartSpec): Template`. It throws
  `ConnectorError` on unknown link ids, duplicate node ids, a lane not in `lanes`, or exceeded
  `LIMITS`.

- [ ] **Step 1: Write failing tests** in `layout.test.ts`:
  ```ts
  test("flowchart goes top-down, no overlaps", () => {
    const t = chartTemplate({ kind: "flowchart", nodes: [n("a"), n("b"), n("c", "decision")], links: [l("a","b"), l("b","c")] });
    expect(y(t,"a")).toBeLessThan(y(t,"b")); expect(y(t,"b")).toBeLessThan(y(t,"c"));
    expect(overlaps(t)).toEqual([]);
    expect(t.links.map((k) => [k.fromSide, k.toSide])).toEqual([["bottom","top"],["bottom","top"]]);
  });
  test("direction right lays out left to right with right/left sides", ...);
  test("roles map to kinds: terminal→terminal, decision→decision, note→note, default→step", ...);
  test("swimlanes: one row per lane in order, laneHead + lane nodes, steps inside their lane's row", ...);
  test("mindmap: root is idea, children branch, tree has no overlaps, links have head: false", ...);
  test("orgchart: person nodes, elbow links, children below parent", ...);
  test("kanban: colHead/column per lane, notes stacked in their column, no links", ...);
  test("timeline: nodes left to right in given order, milestone dots on one axis path", ...);
  test("long labels grow the node (w/h) so the label fits, at most 2x the default width", ...);
  test("throws ConnectorError for unknown link target / duplicate id / too many nodes", ...);
  test("unicode and emoji labels are kept verbatim", ...);
  ```
  `n`, `l`, `y` and `overlaps` are local helpers over `t.nodes` using `templateBounds`
  sizing.
- [ ] **Step 2:** Run `npx vitest run src/features/connector/layout.test.ts`.
  Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `chartTemplate`:
  - **Flowchart:** dagre does the ranking (`rankdir` `TB`/`LR`, `nodesep` 48,
    `ranksep` = `STEP_GAP` 64, node sizes from the kind's `SIZE`, grown for long labels at
    ≈ 0.6 × 20 px per char, wrapping up to 2× width). Read the node positions back as a
    `Template`.
  - **Swimlanes:** `x` comes from dagre's rank, and `y` from the lane row at 160 px per lane.
  - **Mind map and org chart:** a simple tidy-tree, centering parents over their children.
  - **Kanban:** reuse the `columns()` helper shape from templates.ts. Export it from there
    rather than copying.
  - **Timeline:** evenly spaced, with one `paths` axis.
  - **Link sides:** chosen from the relative positions of the two nodes.
  - **Title:** when `title` is set, add it as a `notes` entry above the chart.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm test`: still green.
- [ ] **Step 5:** Commit: `Lay out charts from nodes and links (AI-2)`.

---

### Task 3: Notes, tables and placement

**Files:**
- Create: `src/features/connector/blocks.ts`, `src/features/connector/place.ts`, and tests
  `blocks.test.ts`, `place.test.ts`

**Interfaces:**
- Consumes: `Template`, `buildTemplate`, `templateBounds`, `TemplateStyle` (templates.ts);
  `markForMeasure` (Task 2).
- Produces:
  ```ts
  // blocks.ts
  export function notesTemplate(title: string | undefined, items: string[]): Template; // one "note" node, label "Title\n• a\n• b", sized to fit
  export function tableTemplate(header: string[], rows: string[][]): Template;          // nodes: [], links: [], table: widths fit content (80–320 px)
  // place.ts
  export const DEFAULT_STYLE: TemplateStyle; // from HAND_DRAWN_DEFAULTS, fillStyle "solid", paper "#ffffff"
  export interface Change { elements: ExcalidrawElement[]; changed: ExcalidrawElement[]; createdIds: string[] }
  export function freeSpot(elements: readonly ExcalidrawElement[], size: { width: number; height: number }, gap?: number): { x: number; y: number };
  export function addTemplate(elements: readonly ExcalidrawElement[], t: Template, opts?: { area?: string }): Change;
  ```
  - `Change.elements`: the whole new scene, with valid fractional indices.
  - `Change.changed`: the elements to save and broadcast.
- Behavior of `addTemplate`:
  - **No `area`:** place at `freeSpot` (to the right of all live elements, top-aligned with
    them, `gap` 120; at (0, 0) on an empty board).
  - **Named `area`:** if a frame with that name exists, place below its contents inside it and
    grow the frame (bump its version). Otherwise create a new frame with that name at
    `freeSpot`, sized to the content plus 40 px padding, and set `frameId` on the children.
  - **Always:** run the result through `markForMeasure` and Excalidraw's `restoreElements`
    with `repairBindings: true`, so indices and bindings are valid.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("notesTemplate puts title and bullets in one note", () => expect(label(notesTemplate("Pricing", ["$12/mo?", "annual 20% off"]))).toBe("Pricing\n• $12/mo?\n• annual 20% off"));
  test("tableTemplate keeps cells verbatim and pads short rows", ...);   // rows of unequal length → padded with ""
  test("tableTemplate throws ConnectorError past LIMITS.rows/cols", ...);
  test("freeSpot on an empty board is 0,0", ...);
  test("freeSpot is right of existing content and never overlaps it", ...);
  test("addTemplate marks text and containers with udMeasure and gives every element an index", ...);
  test("addTemplate with a new area makes a named frame containing the elements", ...);
  test("addTemplate into an existing area grows that frame and bumps its version", ...);
  test("addTemplate never overlaps deleted elements' ghosts (ignores isDeleted)", ...);
  ```
- [ ] **Step 2:** Run `npx vitest run src/features/connector/blocks.test.ts src/features/connector/place.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement as specified. Frames are made with
  `convertToExcalidrawElements([{ type: "frame", children, name }])`, a path the spike proved.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Add notes, tables and free-space placement for the connector (AI-2)`.

---

### Task 4: Describing a board as units

**Files:**
- Create: `src/features/connector/units.ts`, `src/features/connector/units.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UnitKind = "chart" | "table" | "frame" | "text" | "shape" | "group" | "image";
  export interface Unit {
    id: string;                 // `${kind}:${smallest element id in the unit}` — stable while the unit is unchanged
    kind: UnitKind;
    elementIds: string[];
    bounds: { x: number; y: number; width: number; height: number };
    text: string;               // chart: "A → B (yes)" lines; table: header + rows as " | " lines; text: the text
    locked: boolean;
    frame?: string;             // name of the frame it sits in
  }
  export function describeUnits(elements: readonly ExcalidrawElement[]): Unit[];
  export function outline(units: Unit[], maxChars?: number): string; // default 100_000
  ```
- Grouping rules, applied in order:
  1. Skip deleted elements.
  2. **Frames:** each frame is a `frame` unit; its children are still described as their own
     units, with `frame` set.
  3. **Tables:** elements sharing a `tablePart` group → `table`, with the text read via
     `readPlan`.
  4. **Charts:** shapes connected by bound arrows, plus their bound labels → `chart`.
  5. **Groups:** other elements sharing an outermost `groupIds` entry → `group`.
  6. **Text:** a lone text with no container → `text`.
  7. **Images:** an image → `image`.
  8. **Everything else** → `shape`.
- `outline` output:
  - one block per unit: `[id] kind @x,y w×h (locked) in "Frame"` followed by the text,
    indented
  - if over `maxChars`: stops at the unit boundary and ends with
    `… N more units not shown. Ask for a smaller area.`

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("a template flowchart is one chart unit with its arrows and labels", ...);   // build with buildTemplate(TEMPLATES.process)
  test("chart text lists links as 'Start → Gather what you need'", ...);
  test("a template table is one table unit with header and rows", ...);
  test("loose text items are separate text units", ...);
  test("grouped elements are one group unit; locked flag carries through", ...);
  test("elements inside a frame report the frame name; the frame is its own unit", ...);
  test("unit ids are stable across calls and unaffected by element order", ...);
  test("outline of 5000 text units stays under maxChars and says how many were cut", ...);
  ```
- [ ] **Step 2:** Run `npx vitest run src/features/connector/units.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with union-find over element ids: arrows are joined to
  `startBinding`/`endBinding` elements, and labels to their `containerId`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Describe boards as units for Claude (AI-3)`.

---

### Task 5: Tidying

**Files:**
- Create: `src/features/connector/tidy.ts`, `src/features/connector/tidy.test.ts`

**Interfaces:**
- Consumes: `describeUnits` (Task 4); `notesTemplate`, `tableTemplate`, `Change`,
  `markForMeasure` (Tasks 2–3).
- Produces:
  ```ts
  export interface TidyTopic {
    name: string;
    units: string[];                                            // unit ids to move into this topic
    notes?: { replaces: string[]; title?: string; items: string[] };          // loose text → bullets
    table?: { replaces: string[]; header: string[]; rows: string[][] };       // loose text → table
  }
  export interface TidyPlan { topics: TidyTopic[] }
  export function applyTidy(elements: readonly ExcalidrawElement[], plan: TidyPlan): Change;
  ```
- **Validation:** any failure throws `ConnectorError`, and nothing is returned.
  - every id must exist in `describeUnits(elements)`
  - no unit may appear twice across `units` and `replaces`
  - `replaces` may only name `text` units
  - a `locked` unit may not be assigned
  - topic names must be unique and non-empty
  - the plan has at most 30 topics
- **Layout:**
  1. Unassigned, unlocked units (excluding existing frames whose children were all
     reassigned) go into a topic named `"Misc"`.
  2. Each topic becomes one frame named after it:
     - charts sit in a column on the left
     - the notes block goes to the right of the first chart
     - tables sit below the charts
     - other units go below those
     - the gap is 48 px, with 40 px of padding inside the frame
  3. Frames are laid out in rows, wrapping at 2400 px, with a 120 px gap.
  4. The row origin is the old content's top-left. Shift any row that would overlap a locked
     unit down past it.
  5. Units move as rigid blocks: every element is translated by the same delta, with versions
     bumped via `newElementWith`. Bound arrows move with their chart.
  6. Elements in `replaces` become tombstones (`isDeleted: true`, version bumped).
  7. Old frames emptied by the move are deleted.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("two overlapping charts end up in separate frames with no overlap", ...);
  test("loose text in notes.replaces becomes one notes block; originals are tombstoned", ...);
  test("text in table.replaces becomes a table with the given cells", ...);
  test("unassigned units land in a Misc frame", ...);
  test("a chart's arrows and labels move with it (same delta, bindings intact)", ...);
  test("grouped elements and images move together as rigid blocks", ...);
  test("locked units stay put and no frame overlaps them", ...);
  test.each([
    ["unknown unit", plan({ units: ["chart:nope"] })],
    ["unit in two topics", twoTopicsSameUnit],
    ["replaces a chart", replacesChart],
    ["assigns a locked unit", assignsLocked],
    ["duplicate topic names", dupNames],
  ])("rejects %s with ConnectorError and no change", (_, p) => expect(() => applyTidy(scene, p)).toThrow(ConnectorError));
  test("every frame is named after its topic", ...);
  ```
- [ ] **Step 2:** Run `npx vitest run src/features/connector/tidy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Tidy boards into topic frames (AI-4)`.

---

### Task 6: Deleting and restoring

**Files:**
- Create: `src/features/connector/history.ts`, `src/features/connector/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function deleteUnits(elements: readonly ExcalidrawElement[], unitIds: string[]): Change;   // tombstones every element of each unit; unknown id → ConnectorError
  export function restoreSnapshot(current: readonly ExcalidrawElement[], snapshot: readonly ExcalidrawElement[]): Change;
  ```
- `restoreSnapshot`:
  - Live elements of `current` that are missing from the snapshot (or deleted there) become
    tombstones.
  - Every snapshot element gets `version` set to `max(current version, snapshot version) + 1`
    and a fresh `versionNonce`.
  - `changed` lists all of them.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("deleteUnits tombstones the chart's shapes, arrows and labels", ...);
  test("restoreSnapshot result wins reconcileElements against the current scene", () => {
    const { changed } = restoreSnapshot(current, snapshot);
    const merged = reconcileElements(current, changed, appState);
    expect(live(merged).map(pos)).toEqual(live(snapshot).map(pos));
  });
  test("elements created after the snapshot are deleted by the restore", ...);
  ```
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Delete and restore for the connector (AI-5)`.

---

### Task 7: Snapshots table and local OAuth server

**Files:**
- Create: `supabase/migrations/20261028000000_board_snapshots.sql`,
  `supabase/tests/database/snapshots.test.sql`
- Modify: `supabase/config.toml`: in `[auth.oauth_server]`, set `enabled = true` and
  `allow_dynamic_registration = true`. Keep `authorization_url_path = "/oauth/consent"`.
- Modify: `src/lib/database.types.ts` (regenerate with `npm run gen:types`).

**Interfaces:**
- Produces:
  - Table `public.board_snapshots`:
    - `id uuid pk default gen_random_uuid()`
    - `board_id uuid not null references boards on delete cascade`
    - `created_by uuid not null default auth.uid()`
    - `reason text not null check (char_length(reason) <= 200)`
    - `scene jsonb not null`, `app_state jsonb not null default '{}'`
    - `created_at timestamptz not null default now()`
  - Index on `(board_id, created_at desc)`.
  - RLS:
    - select and insert when `public.can_edit_board(board_id)`
    - insert also requires `created_by = auth.uid()`
    - no update; delete only by the trim trigger
  - An after-insert trigger (security definer, `search_path = ''`) keeps the newest 20 rows per
    board.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - an owner can insert and select
  - an editor (board member) can insert and select
  - a stranger sees 0 rows and their insert fails
  - the 21st insert leaves 20 rows, with the oldest gone
  - `created_by` can't be spoofed
- [ ] **Step 2:** Run `npx supabase test db`. Expected: FAIL (relation does not exist).
  This needs Docker and `npx supabase start`.
- [ ] **Step 3:** Write the migration. Then run `npx supabase db reset` and
  `npm run gen:types`.
- [ ] **Step 4:** Run `npx supabase test db`. Expected: all files PASS.
- [ ] **Step 5:** Commit: `Add board snapshots and turn on the local OAuth server (AI-5)`.

---

### Task 8: Board store (Supabase as the user, with retry and broadcast)

**Files:**
- Create: `server/mcp/env.ts`, `server/mcp/boardStore.ts`,
  `server/mcp/boardStore.int.test.ts`

**Interfaces:**
- Consumes: `Change` (Task 3); `toDbPayload`, `restoreScene` (serialize.ts);
  `generateShareToken` (shares.api.ts); `SCENE_MAX_BYTES`, `COLLAB_CHUNK_BYTES`
  (constants.ts); `CONNECTOR_SESSION_PREFIX` (Task 2).
- Produces:
  ```ts
  // env.ts
  export const serverEnv: { supabaseUrl: string; anonKey: string; siteUrl: string }; // VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SITE_URL || https://$VERCEL_PROJECT_PRODUCTION_URL
  // boardStore.ts
  export interface BoardInfo { id: string; title: string; updatedAt: string; url: string }
  export interface SnapshotInfo { id: string; reason: string; createdAt: string }
  export interface BoardStore {
    list(query?: string): Promise<BoardInfo[]>;                       // newest first, max 50, excludes trashed
    create(title: string): Promise<BoardInfo>;
    read(boardId: string): Promise<{ info: BoardInfo; elements: ExcalidrawElement[] }>;
    mutate(boardId: string, fn: (elements: ExcalidrawElement[]) => Change, opts?: { snapshot?: string }): Promise<{ info: BoardInfo; change: Change }>;
    snapshots(boardId: string): Promise<SnapshotInfo[]>;
    snapshot(boardId: string, snapshotId: string): Promise<ExcalidrawElement[]>;
    shareLink(boardId: string, kind: "view" | "edit"): Promise<string>;
  }
  export function supabaseBoardStore(token: string, sessionId?: string): BoardStore; // sessionId defaults to `claude-${crypto.randomUUID()}`
  ```
- **`mutate`:**
  1. Read the row and run `restoreScene`.
  2. If `opts.snapshot` is set, insert a `board_snapshots` row (once, before the first
     attempt) with the scene as read.
  3. Run `fn`, then call `save_board(id, version, toDbPayload(change.elements, appState))`.
  4. On a `null` result (conflict), re-read and re-run `fn`, at most 3 attempts. Then throw
     `ConnectorError("The board kept changing; try again.")`.
  5. Payloads over `SCENE_MAX_BYTES` throw `ConnectorError`.
  6. After a successful save, send `change.changed` with
     `channel("board:" + id, { config: { private: true } }).httpSend("tick", { s: sessionId, e: chunk })`,
     chunked by `COLLAB_CHUNK_BYTES`.

  A broadcast failure is logged and swallowed: the save already happened.
- **Errors:** a missing, unshared or trashed board throws
  `ConnectorError("Board not found, or you don't have access to it.")`, the same message in
  every case.
- **`shareLink`:** returns the active view or edit link, or creates one with
  `generateShareToken()`. URLs are `${siteUrl}/s/${token}` (view) and
  `${siteUrl}/join/${token}` (edit).
- **Client:** `createClient(url, anonKey, { accessToken: async () => token, auth: { persistSession: false } })`.

- [ ] **Step 1: Write the failing integration tests.** They run on the local stack and skip
  unless `VITE_SUPABASE_URL` is set. Sign users in with `signInWithPassword` after creating
  them through the admin API in `beforeAll`, using `SUPABASE_SERVICE_ROLE_KEY` as the e2e
  setup does (test-only).
  ```ts
  test("create → read → mutate round trip bumps version and stores udMeasure elements", ...);
  test("concurrent editor save between read and save: retry keeps the editor's element and ours", async () => {
    // fn's first call saves a user edit through a second client before returning
    ...
    expect(ids(final)).toEqual(expect.arrayContaining([userElId, ...change.createdIds]));
  });
  test("another user's board, a trashed board and a random uuid all give the same not-found error", ...);
  test("opts.snapshot writes exactly one snapshot even when the save retries", ...);
  test("tick reaches a subscribed client on board:{id}", ...);   // subscribe with a second user client that can edit
  test("shareLink returns the same view link twice and an edit link under /join/", ...);
  ```
- [ ] **Step 2:** Run
  `export $(npx supabase status -o env | xargs) && npm run test:server -- boardStore`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Read and write boards as the signed-in user (AI-1)`.

---

### Task 9: OAuth bearer checks and discovery

**Files:**
- Create: `server/mcp/auth.ts`, `server/mcp/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function protectedResourceMetadata(origin: string): { resource: string; authorization_servers: string[]; bearer_methods_supported: ["header"]; resource_name: "Uncle Draw" };
  // resource = `${origin}/api/mcp`; authorization_servers = [`${serverEnv.supabaseUrl}/auth/v1`]
  export function unauthorized(origin: string, error?: "invalid_token"): Response;
  // 401, WWW-Authenticate: Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"[, error="invalid_token"]
  export async function authenticate(req: Request, verify?: (token: string) => Promise<string | null>): Promise<{ token: string; userId: string } | Response>;
  // default verify: createClient(...).auth.getClaims(token) → claims.sub, or null
  ```

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("no Authorization header → 401 with resource_metadata", ...);
  test("non-Bearer scheme → 401", ...);
  test("verify returns null (expired/forged) → 401 with error=\"invalid_token\"", ...);
  test("valid token → { token, userId }", ...);
  test("metadata points at <supabaseUrl>/auth/v1 and <origin>/api/mcp", ...);
  ```
- [ ] **Step 2:** Run `npm run test:server -- auth`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Check connector tokens against Supabase Auth (AI-1)`.

---

### Task 10: MCP tools and request handler

**Files:**
- Create: `server/mcp/tools.ts`, `server/mcp/tools.test.ts`
- Modify: `server/mcp/handler.ts` (the Task 1 stub)
- Modify: `package.json`: add `"@modelcontextprotocol/sdk": "1.32.1"`.

**Interfaces:**
- Consumes: `BoardStore` (Task 8); `chartTemplate`, `notesTemplate`, `tableTemplate`,
  `addTemplate`, `describeUnits`, `outline`, `applyTidy`, `deleteUnits`, `restoreSnapshot`
  (Tasks 2–6); `authenticate`, `protectedResourceMetadata` (Task 9).
- Produces:
  ```ts
  export function registerTools(server: McpServer, store: BoardStore): void;
  export async function handle(req: Request): Promise<Response>;
  // GET /.well-known/oauth-protected-resource[/api/mcp] → metadata JSON (no auth)
  // /api/mcp → authenticate → new McpServer per request (stateless Streamable HTTP, JSON responses) with supabaseBoardStore(token)
  ```
- **Tools.** Input schemas are zod. Every write returns the board link and the created or
  changed ids.

  | Tool | Input | Output | Annotations |
  |------|-------|--------|-------------|
  | `list_boards` | `{ query? }` | — | read-only |
  | `create_board` | `{ title }` | — | — |
  | `read_board` | `{ board_id }` | `outline(describeUnits(...))` | read-only |
  | `draw_chart` | `{ board_id, chart: ChartSpec, area? }` | — | — |
  | `add_table` | `{ board_id, header, rows, title?, area? }` | — | — |
  | `add_notes` | `{ board_id, title?, items, area? }` | — | — |
  | `apply_tidy` | `{ board_id, plan: TidyPlan }` | — | destructive; `mutate` with snapshot `"Before tidying"` |
  | `delete_elements` | `{ board_id, unit_ids }` | — | destructive; snapshot `"Before deleting"` |
  | `list_snapshots` | `{ board_id }` | — | read-only |
  | `restore_board` | `{ board_id, snapshot_id }` | — | destructive; snapshot `"Before restoring"` |
  | `get_share_link` | `{ board_id, kind: "view" \| "edit" }` | — | — |

  For `add_table`, a set `title` adds a notes line above the table.
- **`apply_tidy` description:** "Only call after you have shown the user the topics, which
  units go in each, and how loose text becomes notes or a table, and the user has agreed.
  Keep the user's wording in notes; never reword chart labels or table cells."
- **Server instructions:** a short `instructions` string tells Claude to call `read_board`
  before tidying, describes the tidy flow, and says charts are laid out automatically.
- **Errors:** a `ConnectorError` becomes `{ isError: true, content: [{ type: "text", text: message }] }`.
  Any other error is logged and returns "Something went wrong on Uncle Draw's side."

- [ ] **Step 1: Write failing tests.** They use the SDK's `Client` + `InMemoryTransport`
  with an in-memory fake `BoardStore`:
  ```ts
  test("lists all 11 tools with destructiveHint on apply_tidy, delete_elements, restore_board", ...);
  test("draw_chart adds elements to the board and returns the link and created ids", ...);
  test("read_board returns the outline text", ...);
  test("apply_tidy with a bad plan returns isError and leaves the store untouched", ...);
  test("apply_tidy asks the store for a 'Before tidying' snapshot", ...);
  test("restore_board writes the snapshot back", ...);
  test("handle: no token → 401; metadata path → 200 JSON without auth", ...);
  ```
- [ ] **Step 2:** Run `npm run test:server -- tools`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Use the SDK's web-standard Streamable HTTP server transport for `Request`/`Response` if
    1.32.1 exports one. Otherwise adapt to its Node transport inside `handle`.
  - Keep `selftest` exported from `handler.ts` for `check:mcp`.
- [ ] **Step 4:** Run `npm run test:server && npm run build:mcp && npm run check:mcp`.
  Expected: PASS.
- [ ] **Step 5:** Commit: `Add the Uncle Draw MCP tools (AI-1…5)`.

---

### Task 11: Consent page

**Files:**
- Create: `src/features/auth/OAuthConsentPage.tsx`,
  `src/features/auth/OAuthConsentPage.test.tsx`
- Modify: `src/app/router.tsx`: add `/oauth/consent` under `RequireAuth`, so signed-out users
  go through login with return-to.

**Interfaces:**
- Consumes: `supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization`.
- **Behavior:**
  - **Bad request:** no `authorization_id` shows "This sign-in link isn't complete."
  - **Already consented:** details without an `authorization_id` → `window.location.assign(redirect_url)`.
  - **Otherwise:** show "**{client name}** wants to use Uncle Draw as you", the redirect URI's
    host, and a plain-language line: "It can see, create and change boards you can edit."
    Then two buttons, **Allow** and **Cancel**. Each calls approve or deny, then
    `location.assign(redirect_url)`.
  - **Style:** use the sketch kit components and the copy tone of `JoinPage.tsx`.

- [ ] **Step 1: Write failing tests** with `supabase.auth.oauth` mocked:
  ```ts
  test("shows client name and redirect host", ...);
  test("Allow approves and redirects to the returned url", ...);
  test("Cancel denies and redirects", ...);
  test("already-consented details redirect immediately", ...);
  test("missing authorization_id shows the incomplete-link message", ...);
  ```
- [ ] **Step 2:** Run `npx vitest run src/features/auth/OAuthConsentPage.test.tsx`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `npm run check:bundle`: PASS (the page
  is small; lazy-load it if the check complains).
- [ ] **Step 5:** Commit: `Add the OAuth consent page for the Claude connector (AI-1)`.

---

### Task 12: Editor re-measures Claude's elements and shows a notice

**Files:**
- Create: `src/features/connector/remeasure.ts`, `src/features/connector/remeasure.test.ts`
- Modify: `src/features/editor/EditorSession.ts` (after the scene is first shown),
  `src/features/editor/collab/CollabSession.ts` (`applyElements`, `receive`),
  `src/features/editor/collab/CollabSession.test.ts`

**Interfaces:**
- Consumes: `MEASURE_KEY`, `CONNECTOR_SESSION_PREFIX` (Task 2).
- Produces:
  ```ts
  export function remeasure(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] | null;
  ```
  - Returns `null` when nothing is tagged.
  - Otherwise it returns the tagged text elements and their containers re-measured with
    `restoreElements(..., { refreshDimensions: true, repairBindings: true })`, with
    `MEASURE_KEY` removed and versions bumped via `newElementWith`.
- **Editor wiring:**
  - `EditorSession` runs `remeasure` once the API is attached, and `CollabSession.applyElements`
    runs it after each merge.
  - A non-null result is applied with `api.updateScene({ elements: merged-with-result,
    captureUpdate: NEVER })`, so the normal save picks it up.
  - In `CollabSession.receive`, a `tick` whose `s` starts with `CONNECTOR_SESSION_PREFIX`
    and carries elements calls `this.o.notify("Claude updated this board.")`. The existing
    `id: "live"` keeps it to one toast at a time.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test("remeasure returns null when no element is tagged", ...);
  test("remeasure clears the tag, bumps versions and recenters a label in its container", ...);
  test("CollabSession shows the Claude notice for a claude- tick and not for a normal one", ...); // in CollabSession.test.ts, using its existing fake transport
  ```
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Re-measure Claude's text in the editor and say when Claude edits (AI-6)`.

---

### Task 13: Vercel wiring, preview check and production rollout

**Files:**
- Create: `api/mcp.js`
- Modify: `vercel.json`, `README.md` (connector setup)

**Interfaces:**
- `api/mcp.js`:
  ```js
  export const config = { maxDuration: 60 };
  const load = () => import(new URL("../server-dist/mcp.mjs", import.meta.url).href);
  export async function GET(req) { return (await load()).handle(req); }
  export const POST = GET, DELETE = GET, OPTIONS = GET;
  ```
- `vercel.json`:
  - `functions: { "api/mcp.js": { includeFiles: "server-dist/**" } }`
  - before the SPA catch-all, rewrites from `/.well-known/oauth-protected-resource` and
    `/.well-known/oauth-protected-resource/api/mcp` to `/api/mcp`

- [ ] **Step 1:** Local check: `npm run build`, then `node -e` that imports `api/mcp.js` and
  calls `GET(new Request("http://x/.well-known/oauth-protected-resource"))`.
  Expected: 200 JSON.
- [ ] **Step 2: Ask the user before this step.**
  - Push the branch for a Vercel preview, after confirming which Supabase project the preview
    env uses.
  - On that project, enable the OAuth server (path `/oauth/consent`, dynamic registration on)
    in the dashboard, and push the snapshots migration.
- [ ] **Step 3:** On the preview:
  - `curl -i <preview>/api/mcp` → 401 with `WWW-Authenticate`.
  - `curl <preview>/.well-known/oauth-protected-resource` → metadata.
  - If `server-dist` isn't found at runtime, switch to the Build Output API, with
    `.vercel/output/functions/api/mcp.func` holding the bundle and `static/` copied from
    `dist`. Re-check.
- [ ] **Step 4:** With the user, add `<preview>/api/mcp` as a custom connector in claude.ai.
  Sign in through the consent page, then:
  1. ask Claude to create a board with a flowchart and a table,
  2. watch it appear live in an open editor,
  3. tidy a messy board (confirm Claude asks first),
  4. restore it.
- [ ] **Step 5: Production, only with the user's go-ahead.**
  - Check `supabase migration list` against prod for the collab migration. Push it and the
    snapshots migration.
  - Enable the OAuth server in the prod dashboard (Site URL `https://uncle-draw.vercel.app`,
    path `/oauth/consent`, dynamic registration on).
  - Merge to `main`.
- [ ] **Step 6:** Commit: `Serve the Claude connector from Vercel (AI-1)`.

---

### Task 14: Feature docs

**Files:**
- Modify: `docs/FEATURES.md`: a new section "Claude connector (AI)" with AI-1 Connect and sign
  in, AI-2 Draw charts/tables/notes, AI-3 Read a board, AI-4 Tidy, AI-5 Put it back,
  AI-6 Live and re-measure. Each entry gets acceptance checkboxes taken from the spec. Add
  `udMeasure` to the list of Excalidraw-adjacent exceptions if one exists.
- Modify: `docs/TECHNICAL_REQUIREMENTS.md`: add a short section covering the server bundle,
  OAuth and broadcast.

- [ ] **Step 1:** Write both sections, matching the existing entry format (`### AI-1 · … · v2 · P1`).
- [ ] **Step 2:** Run `npx prettier --check docs`. Expected: PASS.
- [ ] **Step 3:** Commit: `Document the Claude connector`.
