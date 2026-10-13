// typescript-eslint parses with the TypeScript 6 JS API (the `typescript`
// devDependency). Type checking itself runs on TypeScript 7 (`npm run typecheck`).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "playwright-report",
      "test-results",
      "public/excalidraw-assets",
      "supabase/functions",
      "src/lib/database.types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          // Providers export their hooks and keys next to them.
          allowExportNames: ["useAuth", "useUser", "useTheme", "useToast", "shareKey", "THEME_STORAGE_KEY"],
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Use a stable seed (visual §5.2). Never Math.random() while rendering.",
        },
      ],
    },
  },
  {
    // Route table, not a component module.
    files: ["src/app/router.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
);
