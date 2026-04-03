type SentryEvent = {
  extra?: Record<string, unknown>;
  request?: {
    data?: unknown;
    headers?: Record<string, unknown>;
  };
  user?: {
    id?: string | number;
  };
};

const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /^body$/i,
  /notes?/i,
  /comments?/i,
] as const;

function shouldRedact(key: string) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (value == null || depth > 3) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        shouldRedact(key) ? "[Filtered]" : scrubValue(nestedValue, depth + 1),
      ])
    );
  }

  return value;
}

export function isSentryEnabled() {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export function getPublicSentryDsn() {
  return process.env.NEXT_PUBLIC_SENTRY_DSN;
}

export function getSentryDsn() {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

export function getSentryEnvironment() {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV;
}

export function getSentryRelease() {
  return process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;
}

export function getSentryTracesSampleRate() {
  return process.env.NODE_ENV === "development" ? 1.0 : 0.1;
}

export function getSentryReplaySessionSampleRate() {
  return process.env.NODE_ENV === "development" ? 1.0 : 0.1;
}

export function getSentryReplayErrorSampleRate() {
  return 1.0;
}

export function sanitizeSentryEvent<T extends SentryEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    event.request.headers = scrubValue(event.request.headers) as Record<string, unknown>;
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  return event;
}
