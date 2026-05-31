import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { headers } from "next/headers";
import {
  ERP_PROXY_STARTED_AT_HEADER,
  ERP_REQUEST_ID_HEADER,
  ERP_REQUEST_METHOD_HEADER,
  ERP_REQUEST_PATH_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";
import { formatDurationMsNumber } from "@/lib/observability/timing-format";

type RequestLogContext = {
  requestId: string;
  pathname: string;
  method: string;
  accept: string | null;
  isPrefetch: boolean;
  proxyStartedAtMs: number | null;
};

export type ObservedOperationEvent = {
  event: string;
  requestId: string;
  path: string;
  method: string;
  accept: string | null;
  isPrefetch: boolean;
  sinceProxyMs: number | null;
  processUptimeMs: number;
  [key: string]: unknown;
};

const observedOperationEvents = new AsyncLocalStorage<ObservedOperationEvent[]>();

function toHeaders(requestHeaders: HeadersInit | undefined) {
  return requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function readRequestLogContext(requestHeaders: Headers): RequestLogContext {
  const proxyStartedAtValue = requestHeaders.get(ERP_PROXY_STARTED_AT_HEADER);
  const proxyStartedAtMs =
    proxyStartedAtValue == null ? Number.NaN : Number.parseInt(proxyStartedAtValue, 10);

  return {
    requestId:
      requestHeaders.get(REQUEST_ID_HEADER) ??
      requestHeaders.get(ERP_REQUEST_ID_HEADER) ??
      crypto.randomUUID(),
    pathname: requestHeaders.get(ERP_REQUEST_PATH_HEADER) ?? "unknown",
    method: requestHeaders.get(ERP_REQUEST_METHOD_HEADER) ?? "GET",
    accept: requestHeaders.get("accept"),
    isPrefetch:
      requestHeaders.has("next-router-prefetch") ||
      requestHeaders.get("purpose") === "prefetch",
    proxyStartedAtMs: Number.isNaN(proxyStartedAtMs) ? null : proxyStartedAtMs,
  };
}

const getCachedRequestLogContext = cache(async () => {
  return readRequestLogContext(await headers());
});

export async function getRequestLogContext(requestHeaders?: HeadersInit) {
  if (requestHeaders) {
    return readRequestLogContext(toHeaders(requestHeaders));
  }

  return getCachedRequestLogContext();
}

export function logObservedEvent(
  event: string,
  context: RequestLogContext,
  data: Record<string, unknown> = {}
) {
  const sinceProxyMs =
    context.proxyStartedAtMs == null ? null : Math.max(0, Date.now() - context.proxyStartedAtMs);
  const payload: ObservedOperationEvent = {
    event,
    requestId: context.requestId,
    path: context.pathname,
    method: context.method,
    accept: context.accept,
    isPrefetch: context.isPrefetch,
    sinceProxyMs,
    processUptimeMs: formatDurationMsNumber(process.uptime() * 1000),
    ...data,
  };

  observedOperationEvents.getStore()?.push(payload);

  console.info(
    "[perf]",
    JSON.stringify(payload)
  );
}

export function logObservedDuration(
  event: string,
  context: RequestLogContext,
  startedAt: number,
  data: Record<string, unknown> = {}
) {
  logObservedEvent(event, context, {
    durationMs: formatDurationMsNumber(performance.now() - startedAt),
    ...data,
  });
}

export async function measureObservedOperation<T>(
  event: string,
  fn: () => Promise<T>,
  options?: {
    headers?: HeadersInit;
    extra?: Record<string, unknown>;
    successData?: (result: T) => Record<string, unknown>;
  }
): Promise<T> {
  const context = await getRequestLogContext(options?.headers);
  const startedAt = performance.now();

  try {
    const result = await fn();
    logObservedDuration(event, context, startedAt, {
      status: "ok",
      ...options?.extra,
      ...options?.successData?.(result),
    });
    return result;
  } catch (error) {
    logObservedDuration(event, context, startedAt, {
      status: "error",
      errorName: getErrorName(error),
      ...options?.extra,
    });
    throw error;
  }
}

export async function collectObservedOperations<T>(fn: () => Promise<T>): Promise<{
  result: T;
  events: ObservedOperationEvent[];
  durationMs: number;
}> {
  const events: ObservedOperationEvent[] = [];
  const startedAt = performance.now();
  const result = await observedOperationEvents.run(events, fn);

  return {
    result,
    events,
    durationMs: formatDurationMsNumber(performance.now() - startedAt),
  };
}
