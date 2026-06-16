import { z } from "zod";

/**
 * Server environment access. Every server-side process.env read in app/lib
 * goes through this module (lint-enforced) so the full set of runtime
 * variables is declared in one place.
 *
 * Reads are live and per-access — no caching — so late injection (dotenv in
 * scripts and tests) behaves exactly like raw process.env access. All fields
 * are optional strings on purpose: call sites own absence handling and value
 * parsing today; tighten individual fields here only with a deliberate
 * behavior change.
 *
 * Stays literal at call sites, by design:
 * - NODE_ENV — bundlers inline it for dead-code elimination
 * - NEXT_RUNTIME and NEXT_PUBLIC_* — inlined at build time by Next.js
 * - lib/observability/sentry.ts — bundled for the edge runtime via
 *   instrumentation.ts, where only statically analyzable access survives
 */
const schema = z.object({
  // Database
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_APP: z.string().optional(),
  DATABASE_URL_AGENT: z.string().optional(),

  // Auth
  BETTER_AUTH_URL: z.string().optional(),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  BETTER_AUTH_ALLOWED_HOSTS: z.string().optional(),
  BETTER_AUTH_RATE_LIMIT_DISABLED: z.string().optional(),
  AUTH_MFA_DISABLED: z.string().optional(),

  // Deployment (Vercel-provided)
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  PORT: z.string().optional(),

  // Internal job secrets (each falls back to CRON_SECRET at its call site)
  CRON_SECRET: z.string().optional(),
  INVENTORY_RECONCILIATION_SECRET: z.string().optional(),
  ONBOARDING_IMPORT_CRON_SECRET: z.string().optional(),
  XERO_RETRY_SECRET: z.string().optional(),
  XERO_SIGNUP_CLEANUP_SECRET: z.string().optional(),
  ACCOUNTING_PURCHASE_ORDER_SYNC_SECRET: z.string().optional(),
  BILLING_ADJUSTMENTS_SECRET: z.string().optional(),

  // Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CATALOG_READY: z.string().optional(),
  STRIPE_LIVE_MODE: z.string().optional(),
  BILLING_ENTITLEMENTS_ENFORCED: z.string().optional(),
  BILLING_ENFORCED_PLUGINS: z.string().optional(),
  BILLING_ENFORCEMENT_LAUNCH_AT: z.string().optional(),

  // File storage
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  LOCAL_ATTACHMENT_DIR: z.string().optional(),

  // Email + alerts
  RESEND_API_KEY: z.string().optional(),
  EMAIL_OUTBOX_ONLY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  APP_NAME: z.string().optional(),
  ASHICORE_ALERT_EMAILS: z.string().optional(),
  INTERNAL_ALERT_EMAILS: z.string().optional(),

  // Notifications
  FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),

  // Sentry autofix
  SENTRY_AUTOFIX_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_WEB_PROJECT: z.string().optional(),
  SENTRY_ANDROID_PROJECT: z.string().optional(),
  GITHUB_AUTOFIX_TOKEN: z.string().optional(),
  GITHUB_WEB_REPO: z.string().optional(),
  GITHUB_ANDROID_REPO: z.string().optional(),

  // Accounting integrations
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_REDIRECT_URI: z.string().optional(),
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
  QUICKBOOKS_REDIRECT_URI: z.string().optional(),
  XERO_TOKEN_ENCRYPTION_KEYS: z.string().optional(),
  XERO_TOKEN_ENCRYPTION_KEY_ID: z.string().optional(),
  XERO_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  XERO_TEST_ENDPOINTS_ENABLED: z.string().optional(),
  QUICKBOOKS_ENVIRONMENT: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_AGENT_MODEL: z.string().optional(),
  OPENAI_IMPORT_MODEL: z.string().optional(),

  // Onboarding import knobs
  IMPORT_EXTRACTION_FILES_PER_TICK: z.string().optional(),

  // Test/CI detection
  CI: z.string().optional(),
  PLAYWRIGHT_FAST_WORKERS: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

const shape = schema.shape;

export const env: Env = new Proxy({} as Env, {
  get(_target, key) {
    if (typeof key !== "string" || !(key in shape)) return undefined;
    return shape[key as keyof Env].parse(process.env[key]);
  },
});
