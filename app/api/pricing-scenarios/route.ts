import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertPricingScenarioSchema } from "@/lib/schemas/pricing-scenarios";
import {
  createPricingScenario,
  listPricingScenarios,
} from "@/lib/dal/pricing-scenarios";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("sales", request.headers);
  const scenarios = await listPricingScenarios();
  return NextResponse.json({ scenarios });
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createPricingScenario");
  const data = await parseJsonBody(request, insertPricingScenarioSchema);
  const detail = await createPricingScenario(data, { idempotencyKey });
  return NextResponse.json(detail, { status: 201 });
});
