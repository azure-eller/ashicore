import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonConflict, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updatePricingScenarioSchema } from "@/lib/schemas/pricing-scenarios";
import {
  getPricingScenarioDetail,
  softDeletePricingScenario,
  updatePricingScenario,
} from "@/lib/dal/pricing-scenarios";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const detail = await getPricingScenarioDetail(id);
  if (!detail) {
    return jsonNotFound("Pricing scenario not found");
  }
  return NextResponse.json(detail);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updatePricingScenarioSchema);
  const result = await updatePricingScenario(id, data);

  if (result.kind === "not-found") {
    return jsonNotFound("Pricing scenario not found");
  }
  if (result.kind === "conflict") {
    return jsonConflict("This scenario was changed elsewhere.", result.current);
  }
  return NextResponse.json(result.detail);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const deleted = await softDeletePricingScenario(id);
  if (!deleted) {
    return jsonNotFound("Pricing scenario not found");
  }
  return jsonSuccess();
});
