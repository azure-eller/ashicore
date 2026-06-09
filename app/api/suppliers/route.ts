import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { createSupplier, deleteSuppliers, getSuppliers } from "@/app/(dashboard)/purchasing/queries";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const data = await getSuppliers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const data = await parseJsonBody(request, insertSupplierSchema);
  const supplier = await createSupplier(data);
  return jsonCreated(supplier);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deleteSuppliers(data.ids);
  return NextResponse.json(result);
});
