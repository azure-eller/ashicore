import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { findPostgresError } from "@/lib/errors/postgres-error";

type SentryEvent = {
  breadcrumbs?: Array<{
    data?: Record<string, unknown>;
  }>;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  request?: {
    data?: unknown;
    headers?: Record<string, unknown>;
    url?: string;
  };
  user?: {
    id?: string | number;
    [key: string]: unknown;
  };
  transaction?: string;
};

type SentryLog = {
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

const POSTGRES_SAFE_MESSAGES: Record<string, string> = {
  "23505": "Unique constraint violation.",
  "23503": "Foreign key constraint violation.",
  "23502": "Not-null constraint violation.",
  "42703": "Undefined column.",
  "42P01": "Undefined table.",
};

const DEFAULT_SOURCE = "api_handler";

export type SafeErrorClassification = {
  kind: string;
  domain: string;
  message?: string;
  contexts?: Record<string, Record<string, unknown>>;
};

export type CaptureAppErrorContext = {
  requestId?: string;
  route?: string;
  method?: string;
  runtime?: string;
  module?: string;
  operation?: string;
  source?: string;
  digest?: string;
  vercelEnv?: string;
  nextRender?: Record<string, unknown>;
  appDebug?: Record<string, unknown>;
};

type SentryScopeLike = {
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTag(name: string, value: string | number | boolean): void;
};

function shouldRedact(key: string) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripQueryString(value: string) {
  const [path] = value.split("?");
  return path;
}

function sanitizePath(value: unknown) {
  if (typeof value !== "string") return value;

  try {
    const url = new URL(value);
    return url.origin === "null" ? stripQueryString(url.pathname) : `${url.origin}${url.pathname}`;
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

function getErrorRecord(error: unknown): Record<string, unknown> {
  return isPlainObject(error) ? error : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function classifyPostgresError(error: unknown): SafeErrorClassification | null {
  // Same wrapper problem as the API handler: drizzle hides the driver error
  // behind `cause`, so the top-level object has no `code` to classify.
  const record = findPostgresError(error) ?? getErrorRecord(error);
  const code = asString(record.code);
  if (!code || !(code in POSTGRES_SAFE_MESSAGES || code.startsWith("23") || code.startsWith("42"))) {
    return null;
  }

  const db: Record<string, unknown> = {
    code,
  };
  const safeMessage = POSTGRES_SAFE_MESSAGES[code];
  if (safeMessage) db.safe_message = safeMessage;

  for (const key of ["schema", "table", "column", "constraint", "query_kind"]) {
    const value = asString(record[key]);
    if (value) db[key] = value;
  }

  return {
    kind: code === "23505" ? "unique_violation" : "postgres",
    domain: "db",
    message: safeMessage,
    contexts: { db },
  };
}

function classifyZodError(error: unknown): SafeErrorClassification | null {
  if (!(error instanceof z.ZodError)) return null;

  const fields = Array.from(
    new Set(
      error.issues
        .map((issue) => issue.path.join("."))
        .filter((field) => field.length > 0)
    )
  );

  return {
    kind: "validation",
    domain: "validation",
    message: "Zod validation failed.",
    contexts: {
      validation: {
        fields,
      },
    },
  };
}

function classifyExternalError(error: unknown): SafeErrorClassification | null {
  const record = getErrorRecord(error);
  const name = error instanceof Error ? error.name : asString(record.name);
  const status = asNumber(record.status) ?? asNumber(record.statusCode);
  const service = name === "XeroError" || /xero/i.test(String(name ?? "")) ? "xero" : undefined;
  if (!service) return null;

  return {
    kind: status ? `http_${status}` : "external_service",
    domain: "external_service",
    message: "External service request failed.",
    contexts: {
      external_service: {
        service,
        status,
      },
    },
  };
}

function classifyFetchError(error: unknown): SafeErrorClassification | null {
  if (!(error instanceof Error)) return null;
  const message = error.message.toLowerCase();
  const isNetwork =
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound");

  if (!isNetwork) return null;

  const connection_class =
    error.name === "AbortError" || message.includes("timeout")
      ? "timeout"
      : message.includes("econnrefused") || message.includes("enotfound")
        ? "connection"
        : "network";

  return {
    kind: connection_class,
    domain: "network",
    message: "Network request failed.",
    contexts: {
      network: {
        connection_class,
      },
    },
  };
}

export function classifyError(error: unknown): SafeErrorClassification {
  return (
    classifyPostgresError(error) ??
    classifyZodError(error) ??
    classifyExternalError(error) ??
    classifyFetchError(error) ?? {
      kind: "unknown",
      domain: "unknown",
      message: "Unknown error.",
    }
  );
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

export function isSentryLocalVariableCaptureEnabled() {
  return process.env.NODE_ENV === "development" && process.env.SENTRY_INCLUDE_LOCAL_VARIABLES === "1";
}

export function enrichSentryScope(
  scope: SentryScopeLike,
  error: unknown,
  context: CaptureAppErrorContext = {}
) {
  const classification = classifyError(error);
  const source = context.source ?? DEFAULT_SOURCE;

  scope.setTag("error.kind", classification.kind);
  scope.setTag("error.domain", classification.domain);
  scope.setTag("source", source);
  scope.setTag("environment", getSentryEnvironment() ?? "unknown");

  const releaseSha = getSentryRelease();
  if (releaseSha) scope.setTag("release_sha", releaseSha);
  if (context.requestId) scope.setTag("request_id", context.requestId);
  if (context.route) scope.setTag("route", sanitizePath(context.route) as string);
  if (context.method) scope.setTag("method", context.method);
  if (context.runtime) scope.setTag("runtime", context.runtime);
  if (context.module) scope.setTag("module", context.module);
  if (context.operation) scope.setTag("operation", context.operation);
  if (context.vercelEnv ?? process.env.VERCEL_ENV) {
    scope.setTag("vercel_env", context.vercelEnv ?? process.env.VERCEL_ENV!);
  }

  scope.setContext("app_debug", {
    request_id: context.requestId,
    route: context.route ? sanitizePath(context.route) : undefined,
    method: context.method,
    module: context.module,
    operation: context.operation,
    source,
    digest: context.digest,
    ...context.appDebug,
  });

  for (const [name, value] of Object.entries(classification.contexts ?? {})) {
    scope.setContext(name, scrubValue(value) as Record<string, unknown>);
  }

  if (context.nextRender) {
    scope.setContext("next_render", scrubValue(context.nextRender) as Record<string, unknown>);
  }
}

export function captureAppError(error: unknown, context: CaptureAppErrorContext = {}) {
  Sentry.withScope((scope) => {
    enrichSentryScope(scope, error, context);
    Sentry.captureException(error);
  });
}

export function sanitizeSentryEvent<T extends SentryEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    event.request.headers = scrubValue(event.request.headers) as Record<string, unknown>;
    if (event.request.url) {
      event.request.url = sanitizePath(event.request.url) as string;
    }
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  }

  if (event.tags) {
    event.tags = scrubValue(event.tags) as Record<string, unknown>;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      data: scrubValue(breadcrumb.data) as Record<string, unknown>,
    }));
  }

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  if (event.transaction) {
    event.transaction = sanitizePath(event.transaction) as string;
  }

  return event;
}

export function sanitizeSentryLog<T extends SentryLog>(log: T): T {
  log.message = scrubLogMessage(log.message);
  log.attributes = scrubValue(log.attributes) as Record<string, unknown> | undefined;
  return log;
}
