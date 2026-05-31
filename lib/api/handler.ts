import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { jsonError } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { DomainError } from "@/lib/errors/domain-error";
import { MissingIdempotencyKeyError } from "@/lib/inventory/kernel";
import {
  applyRequestTimingHeaders,
  logRequestTiming,
  withRequestTiming,
} from "@/lib/observability/request-timing";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-headers";
import { captureAppError } from "@/lib/observability/sentry";
import {
  fieldErrorsFromIssues,
  firstFieldErrorMessage,
} from "@/lib/api/field-errors";
import { requestUrl } from "@/lib/routing/search-params";

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

export function apiHandler<TArgs extends unknown[]>(
  fn: (request: Request, ...args: TArgs) => Promise<NextResponse>
) {
  return async (request: Request, ...args: TArgs) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
    const pathname = requestUrl(request).pathname;
    const label = `${request.method} ${pathname}`;

    return withRequestTiming(label, async () => {
      const startedAt = performance.now();

      const finalizeResponse = (response: NextResponse) => {
        const totalMs = performance.now() - startedAt;
        applyRequestTimingHeaders(response.headers, { requestId, totalMs });

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
          return finalizeResponse(jsonError(error.message, error.status, { requestId }));
        }
        if (error instanceof DomainError) {
          const response = error.toResponse();
          return finalizeResponse(response);
        }
        if (error instanceof z.ZodError) {
          const errors = fieldErrorsFromIssues(error.issues);
          return finalizeResponse(
            NextResponse.json(
              { error: firstFieldErrorMessage(errors), errors, requestId },
              { status: 400 }
            )
          );
        }
        if (error instanceof SyntaxError) {
          return finalizeResponse(jsonError("Invalid JSON", 400, { requestId }));
        }
        // Postgres unique constraint violation — surface as a 409 instead of 500
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "23505"
        ) {
          return finalizeResponse(
            jsonError("A record with that value already exists.", 409, { requestId })
          );
        }

        captureAppError(error, {
          requestId,
          route: pathname,
          method: request.method,
          runtime: process.env.NEXT_RUNTIME ?? "nodejs",
          source: "api_handler",
        });

        console.error("API error:", {
          error,
          method: request.method,
          path: pathname,
          requestId,
        });

        return finalizeResponse(jsonError("Internal server error", 500, { requestId }));
      }
    });
  };
}
