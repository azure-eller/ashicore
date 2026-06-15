import { NextResponse } from "next/server";
import { jsonCreated, jsonError } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { getCustomerDetail, getCustomers } from "@/lib/sales/queries/customers-read";
import { createCustomer, deleteCustomers } from "@/lib/sales/queries/customers-write";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getCustomers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createCustomer");
  const data = await parseJsonBody(request, insertCustomerSchema);
  const created = await createCustomer(data, { idempotencyKey });
  const customer = created ? await getCustomerDetail(created.id) : null;
  if (!customer) {
    return jsonError("Customer id is already in use.", 409);
  }
  return jsonCreated(customer);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deleteCustomers(data.ids);
  await deletePrivateBlobsIfConfigured(result.blobUrls);

  return NextResponse.json(result);
});
