import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  createAddressEntry,
  getAddressEntries,
} from "@/lib/dal/addresses";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";

function assertAddressAccess(
  assignedRoles: string[],
  level: "read" | "operate"
) {
  if (
    hasModuleAccess(assignedRoles, "sales", level) ||
    hasModuleAccess(assignedRoles, "purchasing", level)
  ) {
    return;
  }

  throw new AuthorizationError("Forbidden.", 403);
}

export const GET = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertAddressAccess(context.assignedRoles, "read");
  const data = await getAddressEntries();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertAddressAccess(context.assignedRoles, "operate");
  const data = await parseJsonBody(request, createAddressEntrySchema);
  const entry = await createAddressEntry(data);
  return jsonCreated(entry);
});
