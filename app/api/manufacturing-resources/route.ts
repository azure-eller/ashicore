import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess, assertModuleReadAccess } from "@/lib/dal/auth";
import {
  createManufacturingResource,
  deleteManufacturingResources,
  getManufacturingResources,
} from "@/lib/dal/manufacturing-resources";
import { insertManufacturingResourceSchema } from "@/lib/schemas/manufacturing-resources";
import { bulkDeleteSchema } from "@/lib/schemas/shared";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  return NextResponse.json(await getManufacturingResources());
});

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("manufacturing", "admin", request.headers);
  const data = await parseJsonBody(request, insertManufacturingResourceSchema);
  const resource = await createManufacturingResource(data);
  return jsonCreated(resource);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleAccess("manufacturing", "admin", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);
  return NextResponse.json(await deleteManufacturingResources(data.ids));
});
