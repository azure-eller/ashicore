import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonConflict, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchSupplierSchema, updateSupplierSchema } from "@/lib/schemas/suppliers";
import { deleteSupplier, getSupplier, patchSupplier, updateSupplier } from "@/lib/purchasing/queries/suppliers";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const supplier = await getSupplier(id);

  if (!supplier) {
    return jsonNotFound("Supplier not found");
  }

  return NextResponse.json(supplier);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateSupplierSchema);
  const result = await updateSupplier(id, data);

  if (result.kind === "not-found") {
    return jsonNotFound("Supplier not found");
  }
  if (result.kind === "conflict") {
    return jsonConflict("This supplier was changed elsewhere.", result.current);
  }

  return NextResponse.json(result.supplier);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, patchSupplierSchema);
  const supplier = await patchSupplier(id, data);

  if (!supplier) {
    return jsonNotFound("Supplier not found");
  }

  return NextResponse.json(supplier);
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  const result = await deleteSupplier(id);

  if (!result.deleted) {
    return jsonNotFound("Supplier not found");
  }

  return jsonSuccess();
});
