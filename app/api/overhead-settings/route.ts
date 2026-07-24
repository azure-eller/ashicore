import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  getOverheadSettings,
  refreshOverheadRate,
  saveOverheadSettings,
  overheadRefreshSchema,
} from "@/lib/dal/overhead-settings";

export const dynamic = "force-dynamic";

function assertOverheadAccess(assignedRoles: string[], level: "read" | "operate") {
  if (hasModuleAccess(assignedRoles, "sales", level)) return;
  throw new AuthorizationError(
    "You do not have permission to manage overhead settings.",
    403
  );
}

export const GET = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertOverheadAccess(context.assignedRoles, "read");
  return NextResponse.json(await getOverheadSettings());
});

// Preview: recompute the overhead rate from Xero for the given period/overrides
// without persisting, so the user can review the derivation before saving.
export const POST = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertOverheadAccess(context.assignedRoles, "operate");
  const data = await parseJsonBody(request, overheadRefreshSchema);
  return NextResponse.json(await refreshOverheadRate(data));
});

// Save: recompute server-side and persist as the org's pricing overhead default.
export const PUT = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertOverheadAccess(context.assignedRoles, "operate");
  const data = await parseJsonBody(request, overheadRefreshSchema);
  return NextResponse.json(await saveOverheadSettings(data));
});
