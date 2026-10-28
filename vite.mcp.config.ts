import { defineConfig } from "vite";

/**
 * The Claude connector's server (AI-1): one self-contained Node file with
 * Excalidraw bundled in, since Node can't load the package directly.
 */
export default defineConfig({
  define: {
    // Excalidraw checks this at runtime, same as in vite.config.ts.
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  ssr: { noExternal: true },
  build: {
    ssr: "server/mcp/handler.ts",
    outDir: "server-dist",
    emptyOutDir: true,
    target: "node24",
    copyPublicDir: false,
    rolldownOptions: {
      output: { format: "es", entryFileNames: "mcp.mjs", codeSplitting: false },
    },
  },
});
