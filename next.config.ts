import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  return url.replace(/\/$/, "");
}

const erpAssetOrigin =
  normalizeUrl(process.env.NEXT_PUBLIC_ERP_ASSET_ORIGIN) ??
  normalizeUrl(process.env.ERP_ASSET_ORIGIN) ??
  normalizeUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
const shouldUseErpAssetOrigin =
  process.env.NODE_ENV === "production" &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production");

const nextConfig: NextConfig = {
  // Allow a separate build output dir (e.g. `pnpm review`'s validation build) so it
  // doesn't clobber a running dev server's default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  assetPrefix: shouldUseErpAssetOrigin && erpAssetOrigin ? erpAssetOrigin : undefined,
  turbopack: {
    root: process.cwd(),
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  release:
    process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA
      ? {
          name: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
        }
      : undefined,
  sourcemaps: {
    disable: !(
      process.env.SENTRY_AUTH_TOKEN &&
      process.env.SENTRY_ORG &&
      process.env.SENTRY_PROJECT
    ),
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
