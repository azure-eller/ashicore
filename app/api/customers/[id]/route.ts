import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonConflict, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchCustomerSchema, updateCustomerSchema } from "@/lib/schemas/customers";
import { getCustomerDetail } from "@/lib/sales/queries/customers-read";
import { deleteCustomer, patchCustomer, updateCustomer } from "@/lib/sales/queries/customers-write";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const customer = await getCustomerDetail(id, { includeDeleted: true });

  if (!customer) {
    return jsonNotFound("Customer not found");
  }

  return NextResponse.json(customer);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, patchCustomerSchema);
  const patched = await patchCustomer(id, data);

  if (!patched) {
    return jsonNotFound("Customer not found");
  }

  return NextResponse.json(await getCustomerDetail(id));
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateCustomerSchema);
  const result = await updateCustomer(id, data);

  if (result.kind === "not-found") {
    return jsonNotFound("Customer not found");
  }
  if (result.kind === "conflict") {
    const current = await getCustomerDetail(id, { includeDeleted: true });
    if (!current) {
      return jsonNotFound("Customer not found");
    }
    return jsonConflict(
      "This customer was changed elsewhere.",
      current,
    );
  }

  return NextResponse.json(await getCustomerDetail(id));
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  const result = await deleteCustomer(id);

  if (!result.deleted) {
    return jsonNotFound("Customer not found");
  }

  await deletePrivateBlobsIfConfigured(result.blobUrls);

  return jsonSuccess();
});
