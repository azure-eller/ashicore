import { randomUUID } from "node:crypto";
import { auth, authModuleAgeMs, authModuleInitMs } from "@/lib/auth";
import { dbModuleAgeMs, dbModuleInitMs } from "@/lib/db";
import {
  applyRequestTimingHeaders,
  logRequestTiming,
  withRequestTiming,
} from "@/lib/observability/request-timing";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-headers";
import { requestUrl } from "@/lib/routing/search-params";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

const routeModuleLoadedAt = Date.now();
const handlers = toNextJsHandler(auth);

async function withAuthTiming(
  method: "GET" | "POST",
  request: Request
) {
  const pathname = requestUrl(request).pathname;
  const label = `${method} ${pathname}`;
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();

  return withRequestTiming(label, async () => {
    const startedAt = performance.now();
    const response = await handlers[method](request);
    const totalMs = performance.now() - startedAt;
    const wrappedResponse = new Response(response.body, response);
    const routeModuleAgeMs = Date.now() - routeModuleLoadedAt;

    applyRequestTimingHeaders(wrappedResponse.headers, {
      requestId,
      totalMs,
      extraTimings: {
        "x-erp-route-module-age-ms": routeModuleAgeMs,
        "x-erp-auth-module-init-ms": authModuleInitMs,
        "x-erp-auth-module-age-ms": authModuleAgeMs(),
        "x-erp-db-module-init-ms": dbModuleInitMs,
        "x-erp-db-module-age-ms": dbModuleAgeMs(),
      },
    });

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
