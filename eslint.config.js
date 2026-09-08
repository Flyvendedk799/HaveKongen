import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/scene/scene-original.js"] },

  // ── Browser application code ──────────────────────────────────────────────
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",

      // Warning rather than error, deliberately. The pre-v2 codebase carries
      // ~85 of these, mostly around Supabase JSON payloads and the Three.js
      // scene. Turning them into build failures would either block every PR or
      // force a mass rewrite of files this work does not otherwise touch. They
      // stay visible in the lint output so the number can come down over time;
      // new code should not add to it.
      "@typescript-eslint/no-explicit-any": "warn",

      // `try { … } catch {}` around localStorage and JSON.parse is deliberate:
      // a private-mode browser or a corrupt cache entry should degrade, not
      // throw. An empty block anywhere else is still an error.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Supabase edge functions ───────────────────────────────────────────────
  // These run on Deno, not in a browser: no window, no DOM, and remote URL
  // imports. Linting them with browser globals reported failures that were
  // really just the wrong environment.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        Deno: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      // Edge functions parse third-party JSON (OpenAI, Stripe, Dataforsyningen)
      // whose shapes we do not control and should not pretend to.
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Request bodies are destructured in one statement where some fields are
      // then clamped and others are not. Only complain when the whole pattern
      // could be const.
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },

  // ── Build configuration ───────────────────────────────────────────────────
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["*.{ts,js}", "scripts/**/*.{ts,js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      // tailwind.config.ts legitimately require()s its plugins.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
