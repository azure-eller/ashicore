import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleAccess } from "@/lib/dal/auth";
import {
  deleteManufacturingResource,
  updateManufacturingResource,
} from "@/lib/dal/manufacturing-resources";
import { updateManufacturingResourceSchema } from "@/lib/schemas/manufacturing-resources";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("manufacturing", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateManufacturingResourceSchema);
  const resource = await updateManufacturingResource(id, data);

  if (!resource) {
    return jsonNotFound("Resource not found");
  }

  return NextResponse.json(resource);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("manufacturing", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const resource = await deleteManufacturingResource(id);

  if (!resource) {
    return jsonNotFound("Resource not found");
  }

  return NextResponse.json(resource);
});
