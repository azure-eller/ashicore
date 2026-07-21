import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { commitPricingScenarioRevisionSchema } from "@/lib/schemas/pricing-scenarios";
import { commitPricingScenarioRevision } from "@/lib/dal/pricing-scenarios";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const idempotencyKey = requireIdempotencyKey(request, "commitPricingScenarioRevision");
  const data = await parseJsonBody(request, commitPricingScenarioRevisionSchema);
  const revision = await commitPricingScenarioRevision(id, data, { idempotencyKey });
  if (!revision) {
    return jsonNotFound("Pricing scenario not found");
  }
  return NextResponse.json({ revision }, { status: 201 });
});
