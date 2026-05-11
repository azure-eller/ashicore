import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthorizationError } from "@/lib/authz";
import { DomainError } from "@/lib/errors/domain-error";
import { MissingIdempotencyKeyError } from "@/lib/inventory/kernel";
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

export type RouteContext = { params: Promise<{ id: string }> };

export function requireIdempotencyKey(
  request: Request,
  operationName: string
) {
  const idempotencyKey = request.headers.get("Idempotency-Key");

  if (!idempotencyKey) {
    throw new MissingIdempotencyKeyError(operationName);
  }

  return idempotencyKey;
}

function formatFieldErrors(errors: Record<string, string[]>) {
  return Object.values(errors).flat()[0] ?? "Invalid request.";
}

export function apiHandler<TArgs extends unknown[]>(
  fn: (request: Request, ...args: TArgs) => Promise<NextResponse>
) {
  return async (request: Request, ...args: TArgs) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
    const pathname = new URL(request.url).pathname;
    const label = `${request.method} ${pathname}`;

    return withRequestTiming(label, async () => {
      const startedAt = performance.now();

      const finalizeResponse = (response: NextResponse) => {
        const totalMs = performance.now() - startedAt;
        const snapshot = getRequestTimingSnapshot();

        response.headers.set(REQUEST_ID_HEADER, requestId);
        response.headers.set(ERP_REQUEST_ID_HEADER, requestId);
        response.headers.set("x-erp-handler-ms", totalMs.toFixed(1));
        response.headers.set("x-erp-db-query-ms", snapshot.dbQueryMs.toFixed(1));
        response.headers.set("x-erp-db-query-count", String(snapshot.dbQueryCount));
        response.headers.set("x-erp-db-connect-ms", snapshot.dbConnectMs.toFixed(1));
        response.headers.set("x-erp-db-connect-count", String(snapshot.dbConnectCount));
        response.headers.set(
          "x-erp-process-uptime-ms",
          (process.uptime() * 1000).toFixed(1)
        );
        response.headers.append("Server-Timing", buildServerTimingHeader(totalMs));

        logRequestTiming(label, totalMs, response.status);
        return response;
      };

      try {
        const response = await fn(request, ...args);
        return finalizeResponse(response);
      } catch (error) {
        // Let Next.js redirect() errors propagate — swallowing them returns a 500
        if (isRedirectError(error)) throw error;
        if (error instanceof AuthorizationError) {
          return finalizeResponse(
            NextResponse.json(
              { error: error.message, requestId },
              { status: error.status }
            )
          );
        }
        if (error instanceof DomainError) {
          const response = error.toResponse();
          return finalizeResponse(response);
        }
        if (error instanceof z.ZodError) {
          const errors = error.flatten().fieldErrors;
          return finalizeResponse(
            NextResponse.json(
              { error: formatFieldErrors(errors), errors, requestId },
              { status: 400 }
            )
          );
        }
        if (error instanceof SyntaxError) {
          return finalizeResponse(
            NextResponse.json(
              { error: "Invalid JSON", requestId },
              { status: 400 }
            )
          );
        }
        // Postgres unique constraint violation — surface as a 409 instead of 500
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "23505"
        ) {
          return finalizeResponse(
            NextResponse.json(
              { error: "A record with that value already exists.", requestId },
              { status: 409 }
            )
          );
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

        return finalizeResponse(
          NextResponse.json(
            { error: "Internal server error", requestId },
            { status: 500 }
          )
        );
      }
    });
  };
}
