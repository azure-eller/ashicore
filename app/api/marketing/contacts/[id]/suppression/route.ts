import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { setMarketingContactSuppression } from "@/lib/marketing/experiments";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";
import { marketingContactSuppressionSchema } from "@/lib/schemas/marketing";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  if (context.role !== "owner") throw new AuthorizationError("Owner access required.", 403);
  assertMarketingOrg(context.orgId);
  const { id } = await (ctx as RouteContext).params;
  const input = await parseJsonBody(request, marketingContactSuppressionSchema);
  return NextResponse.json(await setMarketingContactSuppression({
    orgId: context.orgId,
    userId: context.userId,
    contactId: id,
    ...input,
  }));
});
