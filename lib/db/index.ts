import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as Sentry from "@sentry/nextjs";
import { recordDbConnect, recordDbQuery } from "@/lib/observability/request-timing";
import * as schema from "./schema";
import { env } from "@/lib/env";

const dbModuleInitStartedAt = performance.now();
const dbModuleLoadedAt = Date.now();

// App role (RLS enforced, no DDL). Falls back to DATABASE_URL for migration scripts.
const connectionString =
  env.DATABASE_URL_APP || env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL_APP or DATABASE_URL is required. In a worktree, run `pnpm db:local:setup` first."
  );
}

// Neon serverless driver uses WebSocket — only works against Neon Postgres.
// Plain Postgres (CI, local) needs the standard pg driver over TCP.
const isNeon = connectionString.includes(".neon.tech");
const wrappedClientSymbol = Symbol("erpWrappedDbClient");
const poolErrorHandlerSymbol = Symbol("erpPoolErrorHandler");

type PoolErrorEmitter = {
  on?: (event: "error", listener: (error: unknown) => void) => unknown;
};

function getErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") {
    return {
      errorName: "UnknownError",
      errorCode: null,
    };
  }

  const record = error as { name?: unknown; code?: unknown };
  return {
    errorName: typeof record.name === "string" ? record.name : "Error",
    errorCode:
      typeof record.code === "string" || typeof record.code === "number"
        ? String(record.code)
        : null,
  };
}

function capturePoolError(error: unknown) {
  const metadata = getErrorMetadata(error);
  const safeError = new Error("Database pool connection error");
  safeError.name = metadata.errorName;

  Sentry.withScope((scope) => {
    scope.setTag("source", "db_pool");
    scope.setTag("error.domain", "db");
    scope.setTag("error.kind", "connection");
    scope.setContext("db", {
      operation: "pool.error",
      error_name: metadata.errorName,
      error_code: metadata.errorCode,
    });
    Sentry.captureException(safeError);
  });

  console.error("Database pool connection error:", metadata);
}

export function attachPoolErrorHandler<T extends PoolErrorEmitter>(pool: T): T {
  const instrumentedPool = pool as T & { [poolErrorHandlerSymbol]?: boolean };

  if (instrumentedPool[poolErrorHandlerSymbol]) {
    return pool;
  }

  if (typeof pool.on === "function") {
    pool.on("error", capturePoolError);
    instrumentedPool[poolErrorHandlerSymbol] = true;
  }

  return pool;
}

function wrapClient<T extends { query: (...args: unknown[]) => Promise<unknown> }>(
  client: T
): T {
  const wrappedClient = client as T & { [wrappedClientSymbol]?: boolean };

  if (wrappedClient[wrappedClientSymbol]) {
    return wrappedClient;
  }

  const originalQuery = client.query.bind(client);
  wrappedClient.query = (async (...args: unknown[]) => {
    const startedAt = performance.now();

    try {
      return await originalQuery(...args);
    } finally {
      recordDbQuery(performance.now() - startedAt);
    }
  }) as T["query"];
  wrappedClient[wrappedClientSymbol] = true;

  return wrappedClient;
}

function instrumentPool<
  T extends {
    query: (...args: unknown[]) => Promise<unknown>;
    connect?: (...args: unknown[]) => Promise<unknown>;
  } & PoolErrorEmitter,
>(pool: T): T {
  attachPoolErrorHandler(pool);

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (...args: unknown[]) => {
    const startedAt = performance.now();

    try {
      return await originalQuery(...args);
    } finally {
      recordDbQuery(performance.now() - startedAt);
    }
  }) as T["query"];

  if (pool.connect) {
    const originalConnect = pool.connect.bind(pool);

    pool.connect = (async (...args: unknown[]) => {
      const startedAt = performance.now();

      try {
        const client = await originalConnect(...args);
        recordDbConnect(performance.now() - startedAt);

        if (client && typeof client === "object" && "query" in client) {
          return wrapClient(client as { query: (...queryArgs: unknown[]) => Promise<unknown> });
        }

        return client;
      } catch (error) {
        recordDbConnect(performance.now() - startedAt);
        throw error;
      }
    }) as T["connect"];
  }

  return pool;
}

function createDb(): NeonDatabase<typeof schema> {
  if (isNeon) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    return drizzle({ client: instrumentPool(new Pool({ connectionString })), schema });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle({
    client: instrumentPool(new Pool({ connectionString })),
    schema,
  }) as unknown as NeonDatabase<typeof schema>;
}

export const db = createDb();
export const dbModuleInitMs = performance.now() - dbModuleInitStartedAt;
export const dbModuleAgeMs = () => Date.now() - dbModuleLoadedAt;
