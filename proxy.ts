import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { APP_URL } from "@/lib/app-brand";
import {
  ERP_PROXY_STARTED_AT_HEADER,
  ERP_REQUEST_ID_HEADER,
  ERP_REQUEST_METHOD_HEADER,
  ERP_REQUEST_PATH_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;
}

function getCanonicalProductionOrigin() {
  if (process.env.VERCEL_ENV !== "production") {
    return null;
  }

  const canonicalUrl =
    normalizeUrl(process.env.BETTER_AUTH_URL) ??
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    APP_URL;

  if (!canonicalUrl) {
    return null;
  }

  try {
    return new URL(canonicalUrl).origin;
  } catch {
    return null;
  }
}

function isDevelopmentRoute(pathname: string) {
  return process.env.VERCEL_ENV !== "production" && pathname.startsWith("/dev/");
}

function isPublicRoute(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/monitoring") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/reports/sparkline.png" ||
    pathname === "/api/internal/sentry/autofix" ||
    pathname === "/android" ||
    pathname.startsWith("/downloads/") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/accept-invitation" ||
    isDevelopmentRoute(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);

  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_PATH_HEADER, pathname);
  forwardedHeaders.set(ERP_REQUEST_METHOD_HEADER, request.method);
  forwardedHeaders.set(ERP_PROXY_STARTED_AT_HEADER, String(Date.now()));

  const canonicalOrigin = getCanonicalProductionOrigin();

  if (
    canonicalOrigin &&
    request.nextUrl.origin !== canonicalOrigin &&
    (request.method === "GET" || request.method === "HEAD") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/monitoring")
  ) {
    const redirectUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      canonicalOrigin
    );
    const response = NextResponse.redirect(redirectUrl);

    response.headers.set(REQUEST_ID_HEADER, requestId);
    response.headers.set(ERP_REQUEST_ID_HEADER, requestId);
    response.headers.set(
      ERP_PROXY_STARTED_AT_HEADER,
      forwardedHeaders.get(ERP_PROXY_STARTED_AT_HEADER) ?? String(Date.now())
    );
    return response;
  }

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
  matcher: ["/:path*"],
};
