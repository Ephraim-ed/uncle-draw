# Uncle Draw

A hand-drawn whiteboard: the open-source [Excalidraw](https://github.com/excalidraw/excalidraw) editor embedded in a React app, with accounts, a board dashboard, autosave and read-only share links on **Supabase**.

The specs live in [`docs/`](./docs):

- [FEATURES.md](./docs/FEATURES.md): what it does
- [TECHNICAL_REQUIREMENTS.md](./docs/TECHNICAL_REQUIREMENTS.md): how it works
- [VISUAL_DESIGN.md](./docs/VISUAL_DESIGN.md): how it looks

This repository implements **v1** (all P0 and P1 features).

## Stack

React 19 · Vite 8 · TypeScript 7 · `@excalidraw/excalidraw` 0.18.1 (exact pin) · Supabase (Auth, Postgres + RLS, Storage, one Edge Function) · React Router 8 · TanStack Query 5 · Tailwind 4 · Rough.js · Zod 4 · Vitest · Playwright.

## Getting started

You need Node 26 (see `.nvmrc`). The Supabase CLI runs through `npx supabase`. Docker is only needed for the local Supabase stack.

```bash
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev                  # http://localhost:5173
```

Without `.env.local`, every route shows a short setup page. The dev-only component kit at <http://localhost:5173/_kit> works either way.

### Option A: a hosted Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Put the project URL and anon (publishable) key into `.env.local`. They're under **Project Settings → API**.
3. Apply the schema and deploy the share function:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   npx supabase functions deploy get-shared-board --no-verify-jwt
   ```
4. In the Supabase dashboard, under **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:5173` for now (later, your production domain).
   - **Redirect URLs**: `http://localhost:5173/auth/callback`, plus your preview and production `…/auth/callback` URLs. Wildcards work for previews.
5. **Authentication → Providers**:
   - Email: keep magic links on.
   - GitHub (AUTH-2): create a GitHub OAuth app whose callback URL is `https://<project-ref>.supabase.co/auth/v1/callback`, then paste its client id and secret here.
6. Before launch, set up custom SMTP (e.g. Resend) under **Authentication → Emails**, because the built-in mailer is heavily rate-limited.

### Option B: local Supabase (Docker)

```bash
npx supabase start            # Postgres, Auth, Storage, Functions, Mailpit
npx supabase status -o env    # copy API_URL and ANON_KEY into .env.local
```

- Magic-link emails land in Mailpit at <http://127.0.0.1:54324>.
- GitHub sign-in is off locally. `supabase/config.toml` explains how to turn it on.

## Scripts

| Script                 | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Dev server on :5173                                             |
| `npm run build`        | Typecheck, then production build to `dist/`                     |
| `npm run preview`      | Serve `dist/` on :4173                                          |
| `npm run lint`         | ESLint                                                          |
| `npm run typecheck`    | TypeScript 7 (`tsc -b`)                                         |
| `npm test`             | Vitest unit and component tests                                 |
| `npm run test:e2e`     | Playwright against local Supabase (see below)                   |
| `npm run check:bundle` | Shell JS budget: ≤ 200 KB gzip, excluding the lazy editor chunk |
| `npm run gen:types`    | Regenerate `src/lib/database.types.ts` from the local database  |
| `npm run icons`        | Re-render the favicon set from the pencil mark                  |

## Testing

| Layer              | Command                             | Needs                                               |
| ------------------ | ----------------------------------- | --------------------------------------------------- |
| Unit and component | `npm test`                          | nothing                                             |
| Database (pgTAP)   | `npx supabase test db`              | local Supabase                                      |
| Edge Function      | `npx deno test supabase/functions/` | nothing (Deno via npm)                              |
| E2E                | `npm run test:e2e`                  | local Supabase plus the environment variables below |

Run the E2E suite against the local stack:

```bash
npx supabase start
eval "$(npx supabase status -o env | sed -E 's/^/export /')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run test:e2e
```

CI (`.github/workflows/ci.yml`) runs everything on each pull request: lint, typecheck, unit tests, `supabase test db`, a generated-types drift check, Deno tests, Playwright, build and the bundle check.

## Deploying

- **Frontend:** static hosting (Vercel, Netlify or Cloudflare Pages). Every route rewrites to `index.html`: `vercel.json` covers Vercel and `public/_redirects` covers Netlify and Cloudflare. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment.
- **Database and functions:** `.github/workflows/deploy-db.yml` runs `supabase db push` and deploys `get-shared-board` on merge to `main`. It needs these repository secrets:
  - `SUPABASE_ACCESS_TOKEN`
  - `SUPABASE_DB_PASSWORD`
  - `SUPABASE_PROJECT_REF`

## Project layout

```
src/
  app/          router, providers, theme
  brand/        wordmark and pencil mark
  components/   sketch/ (Rough.js kit), ui/ (avatar menu, dialogs, page layouts)
  features/
    auth/       login, magic-link callback, route guard, profile
    boards/     dashboard, cards, queries
    editor/     editor page (lazy), save queue, local backup, file sync, thumbnails
    share/      share dialog, read-only share page (lazy)
  lib/          Supabase client, Zod schemas, IndexedDB cache, helpers
  styles/       tokens, fonts, sketch kit, Excalidraw overrides
supabase/
  migrations/   schema, RLS, RPCs, storage buckets and policies
  functions/    get-shared-board (+ Deno tests)
  tests/        pgTAP tests
e2e/            Playwright specs
```

## Implementation notes

- **Two TypeScript versions.** Type checking uses TypeScript 7 (`typescript-native`, the native compiler). typescript-eslint doesn't support TypeScript 7 yet, so ESLint parses with TypeScript 6 (`typescript`).
- **No Tailwind preflight.** Its global resets would leak into Excalidraw's UI. A small reset scoped to `.ud-shell` replaces it.
- **Fonts are self-hosted.** Excalidraw's fonts are copied to `/excalidraw-assets/fonts/` at build time, with `OFL.txt`.
- **Illustrations are placeholders.** They are deterministic Rough.js drawings (`src/assets/illustrations/`) standing in for versions to be drawn in Uncle Draw itself (VISUAL_DESIGN.md §9.3).
- **Licensing.** See [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md). The About dialog (avatar menu) shows the same notices.
