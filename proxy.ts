import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  ERP_PROXY_STARTED_AT_HEADER,
  ERP_REQUEST_ID_HEADER,
  ERP_REQUEST_METHOD_HEADER,
  ERP_REQUEST_PATH_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-headers";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);

  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(ERP_REQUEST_PATH_HEADER, pathname);
  forwardedHeaders.set(ERP_REQUEST_METHOD_HEADER, request.method);
  forwardedHeaders.set(ERP_PROXY_STARTED_AT_HEADER, String(Date.now()));

  let response: NextResponse;

  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/monitoring") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/accept-invitation"
  ) {
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
