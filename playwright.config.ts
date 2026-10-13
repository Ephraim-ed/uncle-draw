import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a local Supabase stack (`npx supabase start`), tech §14.
 * The app is built and served by `vite preview` on :4173 with the local
 * project's URL and anon key (see .github/workflows/ci.yml, or export them
 * from `npx supabase status -o env`).
 */
const port = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 860 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.ANON_KEY ?? "",
    },
  },
});
