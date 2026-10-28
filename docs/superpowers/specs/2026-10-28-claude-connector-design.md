# Claude connector for Uncle Draw — design

Date: 2026-10-28. Status: agreed in conversation; the user asked to go straight to development.

## Why

Building tables and flowchart-style charts by hand in Uncle Draw is slow, and so is tidying a
board afterwards: text ends up scattered with no bullets or tables, charts overlap, nothing lines
up. The user wants to hand that work to Claude while chatting in **claude.ai in the browser**.

claude.ai reaches outside apps through *connectors* (remote MCP servers). Anthropic doesn't let
other apps run on a person's claude.ai subscription, so a connector is also the only way people
can use their own plan with Uncle Draw. An in-app chat (which would need each person's API key)
was discussed and **dropped for now**.

## Goals

1. Anyone with an Uncle Draw account can add the connector in claude.ai, sign in with their
   Uncle Draw account, and work only on boards they can already edit.
2. Claude can create boards, draw flowchart-style charts, and add editable tables and notes.
3. Claude can **tidy** a board (see "Tidying").
4. Changes appear **live** in a board the user has open in another tab.
5. Anything Claude makes is ordinary Uncle Draw content: editable shapes, real EDIT-7 tables,
   template-tagged chart shapes so the "+" growth buttons and lane tools keep working.
6. Claude can undo its own big changes ("put it back").

## Non-goals

- Bar, line or pie charts of numbers. "Charts" means flowchart-style diagrams.
- An in-app chat panel inside Uncle Draw.
- Claude showing up in the live bar / presence list (a serverless request can't hold a presence
  connection). *Changed from an earlier guess; see "Live".*
- Editing chart structure in place (add step after X, insert between, add/remove lanes) — the
  flow.ts helpers make this a natural next step, but not v1.
- Comments, images, sharing settings beyond getting a link.

## Anti-goals (fails even if it "works")

- **Grouping things into the wrong topic and moving them without asking.** Tidying must show its
  grouping in chat and wait for the user's OK before anything on the board moves.
- Rewording the user's content beyond light cleanup.
- Losing work: a tidy or delete that can't be reversed, or that clobbers edits made at the same
  time in an open editor.
- Reaching any board the user couldn't reach in the app.

## How it works (decided)

### Where it runs and how people sign in

- A remote MCP server (Streamable HTTP) hosted on **Vercel next to the app**, at
  `https://uncle-draw.vercel.app/api/mcp`. *My call.*
- Sign-in uses **Supabase Auth's OAuth 2.1 server** (beta, all plans):
  - Supabase is the authorization server, with dynamic client registration on, so claude.ai can
    register itself.
  - The app gets a new **consent page** at `/oauth/consent`. It uses
    `supabase.auth.oauth.getAuthorizationDetails/approveAuthorization/denyAuthorization`, and
    sends signed-out users through the normal login first, keeping `authorization_id`.
  - The MCP server serves `/.well-known/oauth-protected-resource`, pointing at the Supabase
    issuer. Requests without a valid token get a 401 with `WWW-Authenticate`.
- OAuth access tokens are ordinary Supabase user JWTs, so the server calls Supabase **as the
  user** and existing RLS (`can_edit_board`, etc.) decides access. No service-role key in the MCP
  path.
- Known limitation: Supabase doesn't support RFC 8707 resource indicators yet, so tokens aren't
  audience-bound to the MCP server. They grant exactly what the user can do in the app anyway.

### Building content on the server

- The server reuses the app's own code: `buildTemplate` (templates.ts), the table grid engine,
  `restoreElements`/`reconcileElements` from Excalidraw.
  - **Spike result (2026-10-28):** bundling with a Vite SSR build (`ssr.noExternal: true`) plus a
    jsdom window and a stub canvas runs `buildTemplate` for every template in Node in ~34 ms.
    Plain `import('@excalidraw/excalidraw')` in Node fails (`ERR_IMPORT_ATTRIBUTE_MISSING`), so
    the bundle is required.
- Text sizes on the server are estimates (stub `measureText`). Elements Claude creates carry
  `customData.udMeasure = true`. The **editor re-measures** those (Excalidraw's
  `restoreElements` with `refreshDimensions`, the same as `textEngine.rewrap`) when it loads a
  board or receives them live, clears the tag, and saves as usual.
- **Auto layout:** Claude gives nodes and links, never coordinates.
  - The server lays out flowcharts as layered graphs.
  - Mind maps and org charts are laid out as trees, swimlanes with one row per lane, kanban
    boards as columns and timelines left to right.
  - The result is a `Template` handed to `buildTemplate`.
  - *Library choice is the builder's call (e.g. `@dagrejs/dagre`).*
- **Placement:** new content goes into free space to the right of what's already there, or
  into a named topic area if Claude asks for one. It never overlaps existing content.

### Writing to a board

- Every write:
  1. reads the board,
  2. applies the change,
  3. saves through `save_board(id, expected_version, …)`.
- On a version conflict it re-reads, re-applies the change to the fresh scene and retries
  (at most 3 times).
- Respect `SCENE_MAX_BYTES` and the tombstone rules in `serialize.ts` (deleted elements are kept
  as tombstones with bumped versions, so open editors' merges honor them).

### Live

- After a successful save, the server broadcasts the changed elements as a `tick` on the board's
  private Realtime channel `board:{id}`, using Realtime's REST broadcast with the user's token
  (RLS on `realtime.messages` applies).
  - Open editors already apply ticks from any other session id through `reconcileElements`.
  - Their next save conflicts and merges via `EditorSession.rebase`, which already exists.
- The editor shows a small toast such as "Claude added a chart" when a tick comes from the
  connector's session id prefix. *My call.*
- Requires the collab migration (`20261013150000_collab.sql`) on the target Supabase project.

### Tidying (the two-step rule)

1. Claude calls `read_board`, which describes the board as **units**:
   - charts: connected shapes, arrows and labels, with their nodes and links as text
   - tables: header and rows
   - frames
   - loose text items
   - other shapes and groups

   Each unit has an id, bounds and its text.
2. Claude proposes topics **in chat**: which units go in each topic, and how loose text becomes
   bullets or a table. It then **waits for the user's OK**. This rule is written into the tool
   descriptions. `apply_tidy` is marked destructive, so claude.ai also asks before running it.
3. `apply_tidy` takes the topics. The server:
   1. saves a snapshot,
   2. creates one **Excalidraw frame per topic**, named after the topic,
   3. moves each chart, table and other unit in as a rigid block (arrows bound to shapes move
      with them),
   4. replaces the listed loose text with a notes block of bullets or a table,
   5. lays each frame out like mockup C: chart on the left, notes beside it, table below,
   6. arranges the frames in rows with even gaps, with nothing overlapping.

   Units Claude doesn't assign go into a **"Misc"** frame.
- Wording: notes keep the user's words, with light fixes only (making a line a bullet,
  trimming). Chart labels and table cells are never reworded. *My call.*

### Putting it back

- Before `apply_tidy` and `delete_elements`, the server saves a snapshot to a new
  `board_snapshots` table:
  - **Columns:** board id, author, scene, app_state, reason, created_at.
  - **Access:** RLS limits it to people who can edit the board.
  - **Retention:** the last 20 snapshots per board are kept.
- `restore_board` writes a snapshot back so the restore also wins in open editors:
  - elements the snapshot doesn't have become tombstones,
  - restored elements get versions above the current ones,
  - then the result is broadcast like any other write.

## Tools (v1)

| Tool | What it does |
|------|--------------|
| `list_boards` | Your boards and boards you edit: id, title, last updated, link. Optional title search. |
| `create_board` | New board with a title; returns id and link. |
| `read_board` | The board as units (see Tidying), capped well under claude.ai's ~150k-char result limit. |
| `draw_chart` | Kind (flowchart, swimlanes, mind map, org chart, timeline, kanban), direction, nodes (label, role such as step/decision/terminal, lane), links (label, arrowhead or not), optional title and topic area. Auto-laid-out, placed in free space. |
| `add_table` | Header + rows, optional title and topic area; a real EDIT-7 table. |
| `add_notes` | Title + bullet items, optional topic area. |
| `apply_tidy` | See Tidying. Destructive; snapshot first. |
| `delete_elements` | Remove units or elements Claude made by mistake. Destructive; snapshot first. |
| `list_snapshots` / `restore_board` | See "Putting it back". |
| `get_share_link` | The board's view link or edit link, creating one if none is active (existing `board_shares` / `board_edit_links` RPCs). |

Every write returns the board link and the ids it created or changed.

## Constraints

- Keep Excalidraw unforked; the editor changes are the re-measure step, the toast and the consent
  route (see FEATURES.md exceptions).
- Server bundle stays out of the client bundle (`npm run check:bundle` must still pass).
- Production Supabase changes go through the dashboard or a narrow `config push` — never the
  repo's `config.toml` (it has localhost URLs). Ask before any prod change.
- Node ≥ 24, existing lint/typecheck/test setup.

## Left to the builder

- The MCP SDK and how it's wired into a Vercel function (stateless Streamable HTTP is enough).
- How the server bundle is produced and deployed: Vite SSR build into a Vercel function, or the
  Build Output API. Verify on a preview deploy.
- The layout library, and spacing constants (match `STEP_GAP` and the template look).
- How charts are detected for `read_board` (bound arrows plus template tags) and the exact unit
  format.
- Testing: unit tests for layout, units, tidy and restore against fixture scenes; integration
  tests on the local Supabase stack with a password-signed-in user token (RLS, conflicts,
  snapshots). Test the full OAuth round trip on a Vercel preview against the dev project.
