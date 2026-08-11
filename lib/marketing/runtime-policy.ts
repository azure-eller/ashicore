import "server-only";

import { AuthorizationError } from "@/lib/authz";
import { env } from "@/lib/env";

export function assertMarketingOrg(orgId: string) {
  const configuredOrgId = env.MARKETING_AUTOMATION_ORG_ID?.trim();
  if (configuredOrgId && configuredOrgId !== orgId) {
    throw new AuthorizationError("Marketing automation is not enabled for this organization.", 403);
  }
  if (process.env.NODE_ENV === "production" && !configuredOrgId) {
    throw new AuthorizationError("Marketing automation organization is not configured.", 503);
  }
}
