import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { activateMarketingExperiment } from "@/lib/marketing/experiments";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  if (context.role !== "owner") throw new AuthorizationError("Owner access required.", 403);
  assertMarketingOrg(context.orgId);
  const { id } = await (ctx as RouteContext).params;
  return NextResponse.json(
    await activateMarketingExperiment(context.orgId, context.userId, id),
  );
});
