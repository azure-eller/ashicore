import * as Sentry from "@sentry/nextjs";
import { enrichSentryScope } from "@/lib/observability/sentry";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

type NextRequestErrorContext = {
  digest?: string;
  renderSource?: string;
  routeType: string;
  routerKind: string;
  routePath: string;
};

type NextRequestLike = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

export function onRequestError(
  error: unknown,
  request: NextRequestLike,
  context: NextRequestErrorContext
) {
  const route = context.routePath ?? request.path;
  const erpRequestId = request.headers["x-erp-request-id"];
  const requestIdHeader = request.headers["x-request-id"];
  const requestId =
    (Array.isArray(erpRequestId) ? erpRequestId[0] : erpRequestId) ??
    (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader);

  Sentry.withScope((scope) => {
    enrichSentryScope(scope, error, {
      requestId,
      route,
      method: request.method,
      runtime: process.env.NEXT_RUNTIME,
      source: "next.on_request_error",
      digest: context.digest,
      nextRender: {
        route_path: route,
        route_type: context.routeType,
        router_kind: context.routerKind,
        render_source: context.renderSource,
        digest: context.digest,
      },
    });
    Sentry.captureRequestError(error, request, context);
  });
}
