import * as Sentry from "@sentry/nextjs";
import {
  getSentryDsn,
  getSentryEnvironment,
  getSentryRelease,
  getSentryTracesSampleRate,
  isSentryLocalVariableCaptureEnabled,
  isSentryEnabled,
  sanitizeSentryEvent,
  sanitizeSentryLog,
} from "@/lib/observability/sentry";

if (isSentryEnabled()) {
  Sentry.init({
    dsn: getSentryDsn(),
    enabled: true,
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    tracesSampleRate: getSentryTracesSampleRate(),
    sendDefaultPii: false,
    includeLocalVariables: isSentryLocalVariableCaptureEnabled(),
    enableLogs: true,
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ["error", "warn"] }),
    ],
    beforeSend: sanitizeSentryEvent,
    beforeSendLog: sanitizeSentryLog,
  });
}
