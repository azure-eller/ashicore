import { AsyncLocalStorage } from "node:async_hooks";
import {
  ERP_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";
import { formatDurationMs } from "@/lib/observability/timing-format";

type RequestTimingStore = {
  label: string;
  dbQueryMs: number;
  dbQueryCount: number;
  dbConnectMs: number;
  dbConnectCount: number;
  maxDbQueryMs: number;
  maxDbConnectMs: number;
};

type RequestTimingSnapshot = Omit<RequestTimingStore, "label">;

const requestTimingStorage = new AsyncLocalStorage<RequestTimingStore>();

function createStore(label: string): RequestTimingStore {
  return {
    label,
    dbQueryMs: 0,
    dbQueryCount: 0,
    dbConnectMs: 0,
    dbConnectCount: 0,
    maxDbQueryMs: 0,
    maxDbConnectMs: 0,
  };
}

export async function withRequestTiming<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  return requestTimingStorage.run(createStore(label), fn);
}

export function recordDbQuery(durationMs: number) {
  const store = requestTimingStorage.getStore();

  if (!store) {
    return;
  }

  store.dbQueryMs += durationMs;
  store.dbQueryCount += 1;
  store.maxDbQueryMs = Math.max(store.maxDbQueryMs, durationMs);
}

export function recordDbConnect(durationMs: number) {
  const store = requestTimingStorage.getStore();

  if (!store) {
    return;
  }

  store.dbConnectMs += durationMs;
  store.dbConnectCount += 1;
  store.maxDbConnectMs = Math.max(store.maxDbConnectMs, durationMs);
}

export function getRequestTimingSnapshot(): RequestTimingSnapshot {
  const store = requestTimingStorage.getStore();

  if (!store) {
    return {
      dbQueryMs: 0,
      dbQueryCount: 0,
      dbConnectMs: 0,
      dbConnectCount: 0,
      maxDbQueryMs: 0,
      maxDbConnectMs: 0,
    };
  }

  return {
    dbQueryMs: store.dbQueryMs,
    dbQueryCount: store.dbQueryCount,
    dbConnectMs: store.dbConnectMs,
    dbConnectCount: store.dbConnectCount,
    maxDbQueryMs: store.maxDbQueryMs,
    maxDbConnectMs: store.maxDbConnectMs,
  };
}

export function buildServerTimingHeader(totalMs: number) {
  const snapshot = getRequestTimingSnapshot();
  return [
    `app;dur=${formatDurationMs(totalMs)}`,
    `db_query;dur=${formatDurationMs(snapshot.dbQueryMs)}`,
    `db_connect;dur=${formatDurationMs(snapshot.dbConnectMs)}`,
    `db_query_max;dur=${formatDurationMs(snapshot.maxDbQueryMs)}`,
    `db_connect_max;dur=${formatDurationMs(snapshot.maxDbConnectMs)}`,
  ].join(", ");
}

export function applyRequestTimingHeaders(
  headers: Headers,
  {
    requestId,
    totalMs,
    extraTimings,
  }: {
    requestId: string;
    totalMs: number;
    extraTimings?: Record<string, number>;
  },
) {
  const snapshot = getRequestTimingSnapshot();

  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(ERP_REQUEST_ID_HEADER, requestId);
  headers.set("x-erp-handler-ms", formatDurationMs(totalMs));
  headers.set("x-erp-db-query-ms", formatDurationMs(snapshot.dbQueryMs));
  headers.set("x-erp-db-query-count", String(snapshot.dbQueryCount));
  headers.set("x-erp-db-connect-ms", formatDurationMs(snapshot.dbConnectMs));
  headers.set("x-erp-db-connect-count", String(snapshot.dbConnectCount));
  headers.set("x-erp-process-uptime-ms", formatDurationMs(process.uptime() * 1000));

  for (const [name, value] of Object.entries(extraTimings ?? {})) {
    headers.set(name, formatDurationMs(value));
  }

  headers.append("Server-Timing", buildServerTimingHeader(totalMs));
}

export function logRequestTiming(
  label: string,
  totalMs: number,
  status: number
) {
  const snapshot = getRequestTimingSnapshot();

  console.info(
    `[perf] ${label} status=${status} total=${formatDurationMs(totalMs)}ms ` +
      `dbQuery=${formatDurationMs(snapshot.dbQueryMs)}ms dbQueryCount=${snapshot.dbQueryCount} ` +
      `dbConnect=${formatDurationMs(snapshot.dbConnectMs)}ms dbConnectCount=${snapshot.dbConnectCount} ` +
      `dbQueryMax=${formatDurationMs(snapshot.maxDbQueryMs)}ms dbConnectMax=${formatDurationMs(snapshot.maxDbConnectMs)}ms`
  );
}
