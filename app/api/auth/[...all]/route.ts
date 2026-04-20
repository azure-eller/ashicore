import { auth } from "@/lib/auth";
import {
  buildServerTimingHeader,
  getRequestTimingSnapshot,
  logRequestTiming,
  withRequestTiming,
} from "@/lib/observability/request-timing";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

async function withAuthTiming(
  method: "GET" | "POST",
  request: Request
) {
  const pathname = new URL(request.url).pathname;
  const label = `${method} ${pathname}`;

  return withRequestTiming(label, async () => {
    const startedAt = performance.now();
    const response = await handlers[method](request);
    const totalMs = performance.now() - startedAt;
    const snapshot = getRequestTimingSnapshot();
    const wrappedResponse = new Response(response.body, response);

    wrappedResponse.headers.set("x-erp-handler-ms", totalMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-query-ms", snapshot.dbQueryMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-query-count", String(snapshot.dbQueryCount));
    wrappedResponse.headers.set("x-erp-db-connect-ms", snapshot.dbConnectMs.toFixed(1));
    wrappedResponse.headers.set("x-erp-db-connect-count", String(snapshot.dbConnectCount));
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
