import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getPricingScenarioRevision } from "@/lib/dal/pricing-scenarios";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);
  const { id, revisionId } = await (
    ctx as { params: Promise<{ id: string; revisionId: string }> }
  ).params;
  const revision = await getPricingScenarioRevision(id, revisionId);
  if (!revision) {
    return jsonNotFound("Revision not found");
  }
  return NextResponse.json({ revision });
});
