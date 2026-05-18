import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
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
  const data = insertManufacturingResourceSchema.parse(await request.json());
  const resource = await createManufacturingResource(data);
  return NextResponse.json(resource, { status: 201 });
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleAccess("manufacturing", "admin", request.headers);
  const data = bulkDeleteSchema.parse(await request.json());
  return NextResponse.json(await deleteManufacturingResources(data.ids));
});
