import * as Sentry from "@sentry/nextjs";
import {
  getPublicSentryDsn,
  getSentryEnvironment,
  getSentryRelease,
  getSentryReplayErrorSampleRate,
  getSentryReplaySessionSampleRate,
  getSentryTracesSampleRate,
  sanitizeSentryEvent,
} from "@/lib/observability/sentry";

const publicDsn = getPublicSentryDsn();

if (publicDsn) {
  Sentry.init({
    dsn: publicDsn,
    enabled: true,
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    tracesSampleRate: getSentryTracesSampleRate(),
    replaysSessionSampleRate: getSentryReplaySessionSampleRate(),
    replaysOnErrorSampleRate: getSentryReplayErrorSampleRate(),
    enableLogs: true,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    beforeSend: sanitizeSentryEvent,
  });
}

export const onRouterTransitionStart = publicDsn
  ? Sentry.captureRouterTransitionStart
  : undefined;
