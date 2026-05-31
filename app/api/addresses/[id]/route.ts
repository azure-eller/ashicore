import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  deleteAddressEntry,
  updateAddressEntry,
} from "@/lib/dal/addresses";
import { updateAddressEntrySchema } from "@/lib/schemas/addresses";

function assertAddressWriteAccess(assignedRoles: string[]) {
  if (
    hasModuleAccess(assignedRoles, "sales", "operate") ||
    hasModuleAccess(assignedRoles, "purchasing", "operate")
  ) {
    return;
  }

  throw new AuthorizationError("Forbidden.", 403);
}

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertAddressWriteAccess(context.assignedRoles);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateAddressEntrySchema);
  const entry = await updateAddressEntry(id, data);

  if (!entry) {
    return jsonNotFound("Address not found");
  }

  return NextResponse.json(entry);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  assertAddressWriteAccess(context.assignedRoles);
  const { id } = await (ctx as RouteContext).params;
  const deleted = await deleteAddressEntry(id);

  if (!deleted) {
    return jsonNotFound("Address not found");
  }

  return jsonSuccess();
});
