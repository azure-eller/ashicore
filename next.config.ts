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

const nextConfig: NextConfig = {
  assetPrefix:
    process.env.NODE_ENV === "production" && erpAssetOrigin
      ? erpAssetOrigin
      : undefined,
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
