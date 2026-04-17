import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthorizationError } from "@/lib/authz";

export type RouteContext = { params: Promise<{ id: string }> };

export function apiHandler<TArgs extends unknown[]>(
  fn: (request: Request, ...args: TArgs) => Promise<NextResponse>
) {
  return async (request: Request, ...args: TArgs) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    const pathname = new URL(request.url).pathname;

    try {
      const response = await fn(request, ...args);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      // Let Next.js redirect() errors propagate — swallowing them returns a 500
      if (isRedirectError(error)) throw error;
      if (error instanceof AuthorizationError) {
        const response = NextResponse.json(
          { error: error.message, requestId },
          { status: error.status }
        );
        response.headers.set("x-request-id", requestId);
        return response;
      }
      if (error instanceof z.ZodError) {
        const response = NextResponse.json(
          { errors: error.flatten().fieldErrors, requestId },
          { status: 400 }
        );
        response.headers.set("x-request-id", requestId);
        return response;
      }
      if (error instanceof SyntaxError) {
        const response = NextResponse.json(
          { error: "Invalid JSON", requestId },
          { status: 400 }
        );
        response.headers.set("x-request-id", requestId);
        return response;
      }
      // Postgres unique constraint violation — surface as a 409 instead of 500
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "23505"
      ) {
        const response = NextResponse.json(
          { error: "A record with that value already exists.", requestId },
          { status: 409 }
        );
        response.headers.set("x-request-id", requestId);
        return response;
      }

      Sentry.withScope((scope) => {
        scope.setTag("request_id", requestId);
        scope.setTag("route", pathname);
        scope.setTag("method", request.method);
        scope.setContext("request", {
          method: request.method,
          path: pathname,
        });
        Sentry.captureException(error);
      });

      console.error("API error:", {
        error,
        method: request.method,
        path: pathname,
        requestId,
      });

      const response = NextResponse.json(
        { error: "Internal server error", requestId },
        { status: 500 }
      );
      response.headers.set("x-request-id", requestId);
      return response;
    }
  };
}
