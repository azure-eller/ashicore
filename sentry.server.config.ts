import * as Sentry from "@sentry/nextjs";
import {
  getSentryDsn,
  getSentryEnvironment,
  getSentryRelease,
  getSentryTracesSampleRate,
  isSentryLocalVariableCaptureEnabled,
  isSentryEnabled,
  sanitizeSentryEvent,
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
    beforeSend: sanitizeSentryEvent,
  });
}
