import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { getVisibleErpAgentTools } from "@/lib/agent/erp/tools";

export async function assertAgentApiAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);
  const visibleTools = getVisibleErpAgentTools({
    assignedRoles: context.assignedRoles,
  });

  if (visibleTools.length === 0) {
    throw new AuthorizationError("You do not have access to the ERP agent.", 403);
  }

  return context;
}
