import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import {
  createInventoryLocation,
  getInventoryLocations,
} from "@/lib/inventory/queries/locations";
import { insertLocationSchema } from "@/lib/schemas/locations";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess, assertModuleReadAccess } from "@/lib/dal/auth";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  return NextResponse.json(await getInventoryLocations());
});

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const data = await parseJsonBody(request, insertLocationSchema);
  const location = await createInventoryLocation(data);
  return jsonCreated(location);
});
