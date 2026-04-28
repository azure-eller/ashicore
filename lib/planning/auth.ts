import "server-only";

import { redirect } from "next/navigation";
import {
  AuthorizationError,
  canReadPlanning,
  getDefaultDashboardPath,
} from "@/lib/authz";
import {
  getAuthedApiMemberContext,
  getAuthedMemberContext,
} from "@/lib/dal/auth";

export async function requirePlanningReadAccess() {
  const context = await getAuthedMemberContext();

  if (!canReadPlanning(context.assignedRoles)) {
    redirect(getDefaultDashboardPath(context.assignedRoles));
  }

  return context;
}

export async function assertPlanningReadAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!canReadPlanning(context.assignedRoles)) {
    throw new AuthorizationError("You do not have access to planning.", 403);
  }

  return context;
}
