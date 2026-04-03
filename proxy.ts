import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
