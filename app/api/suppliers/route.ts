import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createSupplier,
  deleteSuppliers,
  getSuppliers,
  PurchasingError,
} from "@/app/(dashboard)/purchasing/queries";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const data = await getSuppliers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const body = await request.json();
  const data = insertSupplierSchema.parse(body);
  const supplier = await createSupplier(data);
  return NextResponse.json(supplier, { status: 201 });
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);

  try {
    const result = await deleteSuppliers(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
