import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { hasErpAgentAccess } from "@/lib/agent/erp/access-rules";

export async function assertAgentApiAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!hasErpAgentAccess(context.assignedRoles)) {
    throw new AuthorizationError("You do not have access to the ERP agent.", 403);
  }

  return context;
}
