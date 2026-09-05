import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    // Security lint rules (§59, §63).
    rules: {
      /**
       * console.* is how financial data ends up in browser devtools and in
       * production log drains. Use src/lib/security/logger.ts on the server,
       * which redacts. console.warn/error remain allowed for genuine
       * client-side failures that carry no data.
       */
      "no-console": ["error", { allow: ["warn", "error"] }],

      // eval and Function-from-string are never needed here and are the
      // primitives that turn an injection into code execution (§63).
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // Prototype pollution via unvalidated object keys.
      "no-proto": "error",
    },
  },

  {
    // The logger is the one place allowed to call console — it is the
    // implementation of the rule above.
    files: ["src/lib/security/logger.ts"],
    rules: { "no-console": "off" },
  },

  {
    // Scripts and the dev seed are operator tools, not shipped code. They are
    // CommonJS by design: they run under plain node during a build, before any
    // bundler is involved.
    files: ["scripts/**/*.{js,ts}", "prisma/seed.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    /**
     * Presentation components (§78 — design handoff).
     *
     * These files carry inherited patterns that the current React compiler
     * lint flags: assigning an icon component from a lookup during render, and
     * a couple of setState-in-effect data loads. They are real code-quality
     * notes, not security issues — no authorization or business logic lives in
     * these files — and the visual layer is being replaced by a separate
     * design pass, so rewriting them now would be churn.
     *
     * Downgraded to warnings so CI still fails on genuine errors while these
     * stay visible. Tracked in SECURITY_REVIEW.md under "Known unresolved
     * (non-security) issues".
     */
    files: ["src/components/**/*.tsx", "src/app/**/page.tsx", "src/lib/client.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/incompatible-library": "warn",
      /**
       * `static-components` fires on `const Icon = getIcon(name)` followed by
       * `<Icon />`. That is a false positive here: getIcon selects from a
       * module-level map of lucide components (src/lib/icons.ts), so the
       * reference is stable across renders and no component is created. The
       * rule cannot see through the lookup.
       */
      "react-hooks/static-components": "warn",
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
