import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// NODE_ENV, NEXT_RUNTIME, and NEXT_PUBLIC_* must stay literal — bundlers
// inline them at build time. Everything else goes through lib/env.ts.
const restrictedProcessEnv = [
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env']:not([property.name=/^(NODE_ENV|NEXT_RUNTIME|NEXT_PUBLIC_)/])",
    message: "Use env from lib/env.ts instead of raw process.env access.",
  },
  {
    // Bare process.env (aliased, destructured, spread, or passed along)
    // would bypass the member-access restriction above.
    selector:
      "MemberExpression[object.name='process'][property.name='env'][parent.type!='MemberExpression']",
    message:
      "Do not alias or pass process.env — read named values through env from lib/env.ts.",
  },
];

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
        ...restrictedProcessEnv,
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
      "no-restricted-syntax": ["error", ...restrictedProcessEnv],
    },
  },
  {
    files: [
      // The env module itself reads process.env dynamically.
      "lib/env.ts",
      // Edge-bundled via instrumentation.ts and client-bundled respectively —
      // both need statically analyzable process.env access.
      "lib/observability/sentry.ts",
      "lib/observability/browser-sentry.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;
