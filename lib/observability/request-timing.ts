import { AsyncLocalStorage } from "node:async_hooks";

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

function formatMs(value: number) {
  return value.toFixed(1);
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
    `app;dur=${formatMs(totalMs)}`,
    `db_query;dur=${formatMs(snapshot.dbQueryMs)}`,
    `db_connect;dur=${formatMs(snapshot.dbConnectMs)}`,
    `db_query_max;dur=${formatMs(snapshot.maxDbQueryMs)}`,
    `db_connect_max;dur=${formatMs(snapshot.maxDbConnectMs)}`,
  ].join(", ");
}

export function logRequestTiming(
  label: string,
  totalMs: number,
  status: number
) {
  const snapshot = getRequestTimingSnapshot();

  console.info(
    `[perf] ${label} status=${status} total=${formatMs(totalMs)}ms ` +
      `dbQuery=${formatMs(snapshot.dbQueryMs)}ms dbQueryCount=${snapshot.dbQueryCount} ` +
      `dbConnect=${formatMs(snapshot.dbConnectMs)}ms dbConnectCount=${snapshot.dbConnectCount} ` +
      `dbQueryMax=${formatMs(snapshot.maxDbQueryMs)}ms dbConnectMax=${formatMs(snapshot.maxDbConnectMs)}ms`
  );
}
