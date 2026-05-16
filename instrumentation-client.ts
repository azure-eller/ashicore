import {
  sanitizeBrowserSentryEvent,
  sanitizeBrowserSentryLog,
  shouldInitializeBrowserSentry,
} from "@/lib/observability/browser-sentry";

const publicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const shouldInitialize = publicDsn && shouldInitializeBrowserSentry();

if (shouldInitialize) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: publicDsn,
      enabled: true,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      release:
        process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      sendDefaultPii: false,
      tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
      replaysSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
      replaysOnErrorSampleRate: 1.0,
      enableLogs: true,
      integrations: [
        Sentry.consoleLoggingIntegration({ levels: ["error", "warn"] }),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      beforeSend: sanitizeBrowserSentryEvent,
      beforeSendLog: sanitizeBrowserSentryLog,
    });
  });
}

export const onRouterTransitionStart = shouldInitialize
  ? (...args: unknown[]) => {
      void import("@sentry/nextjs").then((Sentry) => {
        const captureRouterTransitionStart =
          Sentry.captureRouterTransitionStart as (
            ...transitionArgs: unknown[]
          ) => void;
        captureRouterTransitionStart(...args);
      });
    }
  : undefined;
