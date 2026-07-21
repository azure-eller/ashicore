import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { duplicatePricingScenarioSchema } from "@/lib/schemas/pricing-scenarios";
import { duplicatePricingScenario } from "@/lib/dal/pricing-scenarios";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const idempotencyKey = requireIdempotencyKey(request, "duplicatePricingScenario");
  const data = await parseJsonBody(request, duplicatePricingScenarioSchema);
  const detail = await duplicatePricingScenario(id, {
    name: data.name,
    idempotencyKey,
  });
  if (!detail) {
    return jsonNotFound("Pricing scenario not found");
  }
  return NextResponse.json(detail, { status: 201 });
});
