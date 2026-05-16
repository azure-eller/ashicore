"use client";

export type BrowserCaptureAppErrorContext = {
  requestId?: string;
  route?: string;
  method?: string;
  runtime?: string;
  module?: string;
  operation?: string;
  source?: string;
  digest?: string;
  appDebug?: Record<string, unknown>;
};

type BrowserSentryScope = {
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTag(name: string, value: string | number | boolean): void;
};

type BrowserSentryEvent = {
  request?: {
    data?: unknown;
    headers?: Record<string, unknown>;
    url?: string;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  user?: { id?: string | number; [key: string]: unknown };
};

type BrowserSentryLog = {
  message: unknown;
  attributes?: Record<string, unknown>;
};

const SENSITIVE_PATTERNS = [
  /address/i,
  /password/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /body/i,
  /notes?/i,
  /comments?/i,
  /customer/i,
  /sku/i,
  /quantity/i,
  /\bqty\b/i,
] as const;

function isBrowserSentryEnabled() {
  return Boolean(
    process.env.NEXT_PUBLIC_SENTRY_DSN &&
      (process.env.NODE_ENV !== "development" ||
        process.env.NEXT_PUBLIC_SENTRY_LOCAL === "1")
  );
}

function shouldRedact(key: string) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function stripQueryString(value: string) {
  const [path] = value.split("?");
  return path;
}

function sanitizePath(value: unknown) {
  if (typeof value !== "string") return value;

  try {
    const url = new URL(value);
    return url.origin === "null"
      ? stripQueryString(url.pathname)
      : `${url.origin}${url.pathname}`;
  } catch {
    return stripQueryString(value);
  }
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (value == null || depth > 3) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }

  if (typeof value === "string") {
    return sanitizePath(value);
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

function scrubLogMessage(message: unknown) {
  if (typeof message !== "string") return message;

  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [Filtered]")
    .replace(/(password|token|secret|authorization|cookie)=\S+/gi, "$1=[Filtered]");
}

export function sanitizeBrowserSentryEvent<T extends BrowserSentryEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    event.request.headers = scrubValue(event.request.headers) as Record<string, unknown>;
    if (event.request.url) {
      event.request.url = sanitizePath(event.request.url) as string;
    }
  }

  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.tags) event.tags = scrubValue(event.tags) as Record<string, unknown>;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      data: scrubValue(breadcrumb.data) as Record<string, unknown>,
    }));
  }
  if (event.user) {
    event.user = event.user.id == null ? {} : { id: event.user.id };
  }

  return event;
}

export function sanitizeBrowserSentryLog<T extends BrowserSentryLog>(log: T): T {
  log.message = scrubLogMessage(log.message);
  log.attributes = scrubValue(log.attributes) as Record<string, unknown> | undefined;
  return log;
}

export async function captureAppError(
  error: unknown,
  context: BrowserCaptureAppErrorContext = {}
) {
  if (!isBrowserSentryEnabled()) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.withScope((scope: BrowserSentryScope) => {
    if (context.runtime) scope.setTag("runtime", context.runtime);
    if (context.module) scope.setTag("module", context.module);
    if (context.operation) scope.setTag("operation", context.operation);

    scope.setContext("app_debug", {
      request_id: context.requestId,
      route: context.route ? sanitizePath(context.route) : undefined,
      method: context.method,
      module: context.module,
      operation: context.operation,
      source: context.source ?? "browser",
      digest: context.digest,
      ...context.appDebug,
    });

    Sentry.captureException(error);
  });
}

export function shouldInitializeBrowserSentry() {
  return isBrowserSentryEnabled();
}
