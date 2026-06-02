import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";

export async function assertOnboardingImportAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);
  const roles = context.assignedRoles;

  const allowed =
    hasModuleAccess(roles, "inventory", "admin") &&
    hasModuleAccess(roles, "sales", "admin") &&
    hasModuleAccess(roles, "purchasing", "admin");

  if (!allowed) {
    throw new AuthorizationError("You do not have permission to import onboarding data.", 403);
  }

  return context;
}
