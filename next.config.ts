import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

const nextConfig: NextConfig = {
  /* config options here */
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
