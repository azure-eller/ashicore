import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchCustomerSchema, updateCustomerSchema } from "@/lib/schemas/customers";
import { deleteCustomer, getCustomerDetail, patchCustomer, updateCustomer } from "@/app/(dashboard)/sales/queries";

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
  const customer = await patchCustomer(id, data);

  if (!customer) {
    return jsonNotFound("Customer not found");
  }

  return NextResponse.json(customer);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateCustomerSchema);
  const customer = await updateCustomer(id, data);

  if (!customer) {
    return jsonNotFound("Customer not found");
  }

  return NextResponse.json(customer);
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
