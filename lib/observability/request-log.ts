import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import {
  ERP_PROXY_STARTED_AT_HEADER,
  ERP_REQUEST_ID_HEADER,
  ERP_REQUEST_METHOD_HEADER,
  ERP_REQUEST_PATH_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";

type RequestLogContext = {
  requestId: string;
  pathname: string;
  method: string;
  accept: string | null;
  isPrefetch: boolean;
  proxyStartedAtMs: number | null;
};

function toHeaders(requestHeaders: HeadersInit | undefined) {
  return requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
}

function formatMs(value: number) {
  return Number(value.toFixed(1));
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

  console.info(
    "[perf]",
    JSON.stringify({
      event,
      requestId: context.requestId,
      path: context.pathname,
      method: context.method,
      accept: context.accept,
      isPrefetch: context.isPrefetch,
      sinceProxyMs,
      processUptimeMs: formatMs(process.uptime() * 1000),
      ...data,
    })
  );
}

export function logObservedDuration(
  event: string,
  context: RequestLogContext,
  startedAt: number,
  data: Record<string, unknown> = {}
) {
  logObservedEvent(event, context, {
    durationMs: formatMs(performance.now() - startedAt),
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
