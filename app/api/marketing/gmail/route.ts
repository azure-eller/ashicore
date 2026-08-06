import { apiHandler } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { disableMarketingMailbox } from "@/lib/marketing/gmail";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";

export const DELETE = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  if (context.role !== "owner") throw new AuthorizationError("Owner access required.", 403);
  assertMarketingOrg(context.orgId);
  await disableMarketingMailbox(context.orgId, context.userId);
  return jsonSuccess();
});
