import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  ERP_PROXY_STARTED_AT_HEADER,
  ERP_REQUEST_ID_HEADER,
  ERP_REQUEST_METHOD_HEADER,
  ERP_REQUEST_PATH_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";

function isDevelopmentRoute(pathname: string) {
  return process.env.VERCEL_ENV !== "production" && pathname.startsWith("/dev/");
}

// Internal automation endpoints that bypass the session-cookie gate. The proxy
// does no auth for these — every route here MUST validate its own
// `Authorization: Bearer <secret>` in the handler. Never add a route without that.
const bearerProtectedInternalRoutes = new Set([
  "/api/internal/accounting-purchase-order-sync",
  "/api/internal/billing-adjustments",
  "/api/internal/inventory-reconciliation",
  "/api/internal/process-imports",
  "/api/internal/xero-retry",
  "/api/internal/xero-signup-cleanup",
]);

function isPublicRoute(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/monitoring") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/agent/production-planning/context" ||
    pathname === "/api/agent/mcp" ||
    pathname.startsWith("/api/agent/mcp/oauth/") ||
    pathname === "/api/xero/sign-up" ||
    pathname === "/api/xero/callback" ||
    pathname === "/api/reports/sparkline.png" ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/internal/sentry/autofix" ||
    bearerProtectedInternalRoutes.has(pathname) ||
    pathname === "/android" ||
    pathname.startsWith("/downloads/") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname.startsWith("/xero/sign-up") ||
    pathname === "/two-factor" ||
    pathname === "/accept-invitation" ||
    isDevelopmentRoute(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  if (
    !process.env.VERCEL_ENV &&
    (host === "0.0.0.0" || host.startsWith("0.0.0.0:"))
  ) {
    const url = request.nextUrl.clone();
    url.hostname = "localhost";
    return NextResponse.redirect(url);
  }

  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);

  forwardedHeaders.delete("x-forwarded-host");
  forwardedHeaders.delete("x-forwarded-proto");
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_PATH_HEADER, pathname);
  forwardedHeaders.set(ERP_REQUEST_METHOD_HEADER, request.method);
  forwardedHeaders.set(ERP_PROXY_STARTED_AT_HEADER, String(Date.now()));

  let response: NextResponse;

  if (isPublicRoute(pathname)) {
    response = NextResponse.next({
      request: {
        headers: forwardedHeaders,
      },
    });
  } else {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
      response = NextResponse.redirect(new URL("/sign-in", request.url));
    } else {
      response = NextResponse.next({
        request: {
          headers: forwardedHeaders,
        },
      });
    }
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set(ERP_REQUEST_ID_HEADER, requestId);
  response.headers.set(
    ERP_PROXY_STARTED_AT_HEADER,
    forwardedHeaders.get(ERP_PROXY_STARTED_AT_HEADER) ?? String(Date.now())
  );
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|downloads/|.*\\.(?:css|js|map|png|jpg|jpeg|gif|webp|svg|ico|txt|xml|json)$).*)",
  ],
};
