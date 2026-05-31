import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonOk } from "@/lib/api/responses";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";

const navigationMetricSchema = z.object({
  navId: z.string().uuid(),
  fromPath: z.string().min(1).max(300),
  toPath: z.string().min(1).max(300),
  optimisticShellMs: z.number().int().nonnegative().nullable(),
  routeCommitMs: z.number().int().nonnegative().nullable(),
  timedOut: z.boolean(),
  userAgentClass: z.enum(["desktop", "mobile"]),
});

export const POST = apiHandler(async (request) => {
  await getAuthedApiMemberContext(request.headers);
  const metric = await parseJsonBody(request, navigationMetricSchema);
  const context = await getRequestLogContext(request.headers);

  logObservedEvent("client.navigation", context, {
    navId: metric.navId,
    fromPath: metric.fromPath,
    toPath: metric.toPath,
    optimisticShellMs: metric.optimisticShellMs,
    routeCommitMs: metric.routeCommitMs,
    timedOut: metric.timedOut,
    userAgentClass: metric.userAgentClass,
  });

  return jsonOk();
});
