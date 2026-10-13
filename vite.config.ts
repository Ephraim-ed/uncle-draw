/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Self-host Excalidraw's fonts instead of loading them from esm.sh (tech §4.1).
    // Served at /excalidraw-assets/fonts/* in dev and copied into dist/ on build.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*",
          dest: "excalidraw-assets/fonts",
          // Drop node_modules/@excalidraw/excalidraw/dist/prod/fonts, keep the per-font folders.
          rename: { stripBase: 6 },
        },
        // OFL: keep the license next to the fonts (tech §16).
        { src: "src/assets/fonts/OFL.txt", dest: "excalidraw-assets/fonts", rename: { stripBase: true } },
      ],
    }),
  ],
  define: {
    // Excalidraw checks this at runtime; Vite doesn't define `process`.
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  build: {
    manifest: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    server: {
      deps: {
        inline: ["@excalidraw/excalidraw"],
      },
    },
  },
});
