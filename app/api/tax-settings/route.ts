import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  getTaxSettings,
  updateTaxSettings,
  updateTaxSettingsSchema,
} from "@/lib/dal/tax-settings";

function assertTaxSettingsAccess(
  assignedRoles: string[],
  level: "read" | "operate",
) {
  if (
    hasModuleAccess(assignedRoles, "sales", level) ||
    hasModuleAccess(assignedRoles, "purchasing", level)
  ) {
    return;
  }

  throw new AuthorizationError("You do not have permission to manage tax settings.", 403);
}

export const GET = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertTaxSettingsAccess(context.assignedRoles, "read");
  return NextResponse.json(await getTaxSettings());
});

export const PUT = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertTaxSettingsAccess(context.assignedRoles, "operate");
  const data = await parseJsonBody(request, updateTaxSettingsSchema);
  return NextResponse.json(await updateTaxSettings(data));
});
