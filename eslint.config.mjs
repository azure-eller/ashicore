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
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='queryKey'] > ArrayExpression",
          message: "Use queryKeys from lib/client/query-keys.ts instead of inline query key arrays.",
        },
        {
          selector: "JSXAttribute[name.name='queryKey'] > JSXExpressionContainer > ArrayExpression",
          message: "Use queryKeys from lib/client/query-keys.ts instead of inline query key arrays.",
        },
        {
          selector: "Property[key.name='invalidateQueryKeys'] > ArrayExpression > ArrayExpression",
          message: "Use queryKeys from lib/client/query-keys.ts instead of inline invalidateQueryKeys arrays.",
        },
        {
          selector: "JSXAttribute[name.name='invalidateQueryKeys'] > JSXExpressionContainer > ArrayExpression > ArrayExpression",
          message: "Use queryKeys from lib/client/query-keys.ts instead of inline invalidateQueryKeys arrays.",
        },
        {
          selector: "CallExpression[callee.property.name='setQueryData'] > ArrayExpression",
          message: "Use queryKeys from lib/client/query-keys.ts instead of inline setQueryData arrays.",
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
