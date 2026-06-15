import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { createSupplier, deleteSuppliers, getSuppliers } from "@/lib/purchasing/queries/suppliers";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const data = await getSuppliers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createSupplier");
  const data = await parseJsonBody(request, insertSupplierSchema);
  const supplier = await createSupplier(data, { idempotencyKey });
  return jsonCreated(supplier);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deleteSuppliers(data.ids);
  return NextResponse.json(result);
});
