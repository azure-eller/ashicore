import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonCreated } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  createMarketingExperiment,
  listMarketingExperiments,
} from "@/lib/marketing/experiments";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";
import { marketingExperimentCreateSchema } from "@/lib/schemas/marketing";

function assertOwner(role: string) {
  if (role !== "owner") throw new AuthorizationError("Owner access required.", 403);
}

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertOwner(context.role);
  assertMarketingOrg(context.orgId);
  return NextResponse.json({
    experiments: await listMarketingExperiments(context.orgId, context.userId),
  });
});

export const POST = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertOwner(context.role);
  assertMarketingOrg(context.orgId);
  const config = await parseJsonBody(request, marketingExperimentCreateSchema);
  const experiment = await createMarketingExperiment({
    orgId: context.orgId,
    userId: context.userId,
    config,
  });
  return jsonCreated(experiment);
});
