import { randomUUID } from "node:crypto";
import { auth, authModuleAgeMs, authModuleInitMs } from "@/lib/auth";
import { dbModuleAgeMs, dbModuleInitMs } from "@/lib/db";
import {
  buildServerTimingHeader,
  getRequestTimingSnapshot,
  logRequestTiming,
  withRequestTiming,
} from "@/lib/observability/request-timing";
import {
  ERP_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

const routeModuleLoadedAt = Date.now();
const handlers = toNextJsHandler(auth);

async function withAuthTiming(
  method: "GET" | "POST",
  request: Request
) {
  const pathname = new URL(request.url).pathname;
  const label = `${method} ${pathname}`;
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();

  return withRequestTiming(label, async () => {
    const startedAt = performance.now();
    const response = await handlers[method](request);
    const totalMs = performance.now() - startedAt;
    const snapshot = getRequestTimingSnapshot();
    const wrappedResponse = new Response(response.body, response);
    const routeModuleAgeMs = Date.now() - routeModuleLoadedAt;
    const processUptimeMs = process.uptime() * 1000;

    wrappedResponse.headers.set(REQUEST_ID_HEADER, requestId);
    wrappedResponse.headers.set(ERP_REQUEST_ID_HEADER, requestId);
    wrappedResponse.headers.set("x-erp-handler-ms", totalMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-query-ms", snapshot.dbQueryMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-query-count", String(snapshot.dbQueryCount));
    wrappedResponse.headers.set("x-erp-db-connect-ms", snapshot.dbConnectMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-connect-count", String(snapshot.dbConnectCount));
    wrappedResponse.headers.set("x-erp-process-uptime-ms", processUptimeMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-route-module-age-ms", routeModuleAgeMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-auth-module-init-ms", authModuleInitMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-auth-module-age-ms", authModuleAgeMs().toFixed(1));
    wrappedResponse.headers.set("x-erp-db-module-init-ms", dbModuleInitMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-module-age-ms", dbModuleAgeMs().toFixed(1));
    wrappedResponse.headers.append("Server-Timing", buildServerTimingHeader(totalMs));

    logRequestTiming(label, totalMs, wrappedResponse.status);

    return wrappedResponse;
  });
}

export async function GET(request: Request) {
  return withAuthTiming("GET", request);
}

export async function POST(request: Request) {
  return withAuthTiming("POST", request);
}
