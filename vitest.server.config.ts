import { defineConfig } from "vitest/config";

/** The connector's server tests (AI-1): Node, with the same browser stand-in the bundle uses. */
export default defineConfig({
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    setupFiles: ["./server/mcp/dom.ts"],
    server: {
      deps: {
        inline: ["@excalidraw/excalidraw"],
      },
    },
  },
});
