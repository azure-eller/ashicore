import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateSupplierSchema } from "@/lib/schemas/suppliers";
import {
  deleteSupplier,
  getSupplier,
  PurchasingError,
  updateSupplier,
} from "@/app/(dashboard)/purchasing/queries";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const supplier = await getSupplier(id);

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  return NextResponse.json(supplier);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateSupplierSchema.parse(body);
  const supplier = await updateSupplier(id, data);

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  return NextResponse.json(supplier);
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  try {
    const result = await deleteSupplier(id);

    if (!result.deleted) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
