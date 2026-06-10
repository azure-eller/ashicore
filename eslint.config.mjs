import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Isolated validation build output (see next.config distDir / pnpm review):
    ".next-validate/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Repo-generated test artifacts:
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    ".tmp/**",
    ".worktrees/**",
    "apps/**",
    "packages/**",
    "docs/design-system/reference/**",
    "docs/design-system/sales-order-detail/**",
    "docs/*-redesign/**",
  ]),
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message: "Use a DAL/domain helper instead of importing the runtime DB client from app or component code.",
            },
            {
              name: "@/lib/db/index",
              message: "Use a DAL/domain helper instead of importing the runtime DB client from app or component code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/api/auth/**/route.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*"],
              message: "lib/ must not depend on app/. Move shared code into lib/ instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
