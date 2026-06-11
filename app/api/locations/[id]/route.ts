import { NextResponse } from "next/server";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import {
  deleteInventoryLocation,
  updateInventoryLocation,
} from "@/lib/inventory/queries/locations";
import { updateLocationSchema } from "@/lib/schemas/locations";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess } from "@/lib/dal/auth";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateLocationSchema);
  const location = await updateInventoryLocation(id, data);
  return NextResponse.json(location);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const deleted = await deleteInventoryLocation(id);

  if (!deleted) {
    return jsonNotFound("Location not found");
  }

  return jsonSuccess();
});
